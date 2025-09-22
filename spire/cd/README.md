# Continuous Deployment

## Goals

In order to support the practices of continuous delivery and continuous deployment for a large number of the apps and services we build, including all of our customer-facing services, we have built a platform to easily and reliably launch and maintain many servers and applications. Most of these applications are dependent on each other, and have distinct infrastructure needs, such as with autoscaling. This system is designed to be highly flexible to support any and all applications that we build.

The high-level goals of the system are:

- Allow for multiple, varied environments to be maintained (e.g., staging, and production)
- Offer atomic deployments in production, with good support for rapid rollbacks
- Provide excellent visibility into the processes of the system, and provide developers with organized, useful information in Slack
- Ensure that production deploys are inherently a high-confidence operation
- Adding CD support to a new app or service should be easy, especially when it is similar to existing apps
- First-class support for Docker- and AWS Lambda-based applications
- Create environments that can persist even if the CD system itself goes away

## Project Architecture

As with [CI](https://github.com/PRX/Infrastructure/tree/main/ci), the CD system itself is built using native AWS resources that are managed through a CloudFormation template. Launching a stack from the `cd/template.yml` template is fairly straightforward, but this CD project is part of a larger, more comprehensive [DevOps project](https://github.com/PRX/Infrastructure), and relies on some resources created by other component stacks.

At the core of the CD system is an [AWS CodePipeline](https://aws.amazon.com/codepipeline/) pipeline that moves code and configuration through a deployment path. That includes things like staging and production deploys, acceptance testing, notification messaging, and state capture. The pipeline is triggered automatically by code and configuration changes.

Currently the CD stack is designed to be launched in any region where the environments are needed to run. For multi-region deployments, the CD stack can be run in multiple regions simultaneously, though there is currently no coordination between deployments of different regions. This is an area that may be improved in the future.

### Pipeline Overview

The following describes many aspects of the CD pipeline in the order that they usually come into play during an execution.

#### Inputs & Triggers

The CodePipeline pipeline has three triggers:

- pushes to the `main` branch of the [Infrastructure](https://github.com/PRX/Infrastructure) GitHub repository
- pushes to the `main` branch of the [acceptance-tests](https://github.com/PRX/acceptance-tests) GitHub repository
- changes to certain parameters in Parameter Store via [EventBridge](https://github.com/PRX/Infrastructure/blob/main/spire/cd/src/parameter-store-listener/index.js)

These triggers are defined as `source` actions in the first stage of the pipeline.

##### GitHub triggers

Relevant changes in the Infrastructure repository result in pipeline executions through [GitHub Actions](https://github.com/PRX/Infrastructure/blob/main/.github/workflows/deploy-devops-spire-cd-pipeline-stack.yml) that look for specific changes in that repository. This is to prevent unnecessary pipeline executions for unrelated changes in the repository.

#### Staging Deploy

The staging enviroment is launched and updated first using an AWS Lambda [function](https://github.com/PRX/Infrastructure/blob/main/spire/cd/src/create-nested-change-set/index.js) to create a nested change set. Becase our deployment utilizes [_nested stacks_](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-nested-stacks.html), nested change sets allow us to inspect changes to the infrastructure at all levels, which improve our confidence in rapid deployment and helps prevent unforseen issues.

The change set and subsequent deploy use template files that are [copied](https://github.com/PRX/Infrastructure/blob/main/spire/cd/src/template-copy/lambda_function.py) into S3 at the start of a pipeline execution. Many dynamic values, such as code artifact version numbers (Docker image tags, etc), are sourced from [Parameter Store](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html) and use native CloudFormation features to resolve those values just-in-time.

The Git commit hash of the Infrastructure repo is used as a prefix in S3 for the copy. That value is passed to the root stack as a parameter (using `ParameterOverrides`) via a CodePipleine [variable](https://docs.aws.amazon.com/codepipeline/latest/userguide/reference-variables.html) that is provided by GitHub pipeline actions (`CommitId`).

> **Example:** The storage stack created a bucket called `acme-us-west-2-source`. This is the bucket where the contents of the Infrastructure Git repository pipeline artifact are copied to every time the pipeline runs. The Git commit hash for the repo (for whichever commit was sourced at the top of the pipeline execution) is used as the prefix for those copies. For instance, this readme file might be found at `s3://acme-us-west-2-source/004a99d31b98a82c55dc46a49f3658a6b70405a4/cd/README.md`.

> The `root.yml` files in this bucket are **not** the ones used to deploy a stack. The deploy action is able to pull a file directly out of pipeline artifact, so `root.yml` comes from that. The nested stack tempates that are referenced _within_ `root.yml` are sourced from the bucket. Their paths are construced from the various known-value. For instance, to deploy a nested stack using a template that lives at `apps/backend.yml`, the stack resource in `root.yml` would have a `TemplateURL` like _(pseudo)_ `"http://{source-bucket-name}.s3.{region}.amazonaws.com", {commit-hash}/apps/backend.yml"`.

Staging does **not** have a confirmation before the deploy happens. Staging is, essentially, continuously deployed. The pipeline creates both the changeset and deploy actions in order to easily report what changes the deploy will make.

Most deploys are a result of application code changes – for example, an updated version of an app that has been pushed to a new Docker image. Code changes do not directly trigger the pipeline. Instead, identifiers for deployable code are maintained within Parameter Store. In the case of a Docker app, an image tag is used. When a paremeter is updated, the change is detected by EventBridge and, when necessary, triggers the pipeline to run.

At the start of this process (after the `source` actions) and after the staging deploy completes, notifications are sent to Slack.

### Testing

After staging has been deployed, a series of acceptance tests are run. These are maintained in the [acceptance-tests](https://github.com/prx/acceptance-tests) project, and run in [AWS CodeBuild](https://aws.amazon.com/codebuild/). If the CodeBuild run failures, the pipeline stops.

### Production Deploy

In order to deploy a set of changes that have passed testing in staging, the updated application code references (Docker tags, etc) need to be promoted to the production-specific parameters in Parameter Store. For example, staging deploys may use a parameter called `/prx/stag/Spire/Dovetail-Feeder/pkg/docker-image-tag`, and once the version referenced in that parameter has been deployed and tested in staging, the value is copied to `/prx/prod/Spire/Dovetail-Feeder/pkg/docker-image-tag` so that it is available for production deploys.

Like staging, production deploys makes use of [change sets](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-updating-stacks-changesets.html). Unlike staging, an `approval` action is required to execute the change set and complete the deploy. There is an [Lambda function](hhttps://github.com/PRX/Infrastructure/tree/main/spire/cd/src/pipeline-events-listener) that exists outside of the pipeline that handles messages from the `approval` action, and allows the approvals to be dealt with in Slack.

Once the deploy has been approved, the change set executes. If it is successful, a notification is sent, and the metadata that represents that specific deploy is captured (by a [Lambda function](https://github.com/PRX/Infrastructure/tree/main/spire/cd/src/parameter-capture)).

## Permissions

The CD stack includes several IAM roles, used by Lambda, CodePipeline, CodeBuild, and CloudFormation. The Lambda and CodeBuild roles and policies are pretty simple and straightforward.

The CodePipeline role is a bit more particular. A few things to note:

- CodePipeline needs `PutObject` for `arn:aws:s3:::codepipeline*`, even though that bucket is never used explicitly by the pipeline or any defined actions.
- The role needs to allow `iam:PassRole` on the CloudFormation IAM role; this allows CodePipeline to pass the separate CloudFormation role that's defined to the CloudFormation service, which is used when managing the stacks that get launched as a result of continuous deployment.
- The CodePipeline role itself only needs to deal with CloudFormation to the extent that it can launch and manage the root stacks (staging and production). It only needs `cloudformation:xyx` actions, and only on those root stack resources; **not** any of the resources that are created by the root stacks.

The CloudFormation role has some serious implications that are worth being aware of:

- This role gets passed to the CloudFormation service by CodePipeline deploy actions.
- It's the role that's used by CloudFormation to create all the resources defined in the root stacks, and any stacks nested within the root stacks. That would include VPC, ECS, and application-specific resources.
- The nested stacks are launched from templates stored in S3, so this role needs access to that location. Any Lambda functions are also created with code found in S3, so this role also needs access to that location.
- Because of the nested stacks, CloudFormation will itself be touching the CloudFormation API to create and manage those nested stacks, and therefore needs some `cloudformation:xyz` permissions.
- Because this role is used for creating all the resources found in nested stacks, it needs permissions for all the services used by those stacks. That includes ECS, EC2, API Gateway, Lambda, IAM, SNS, etc. It's impractical to micromanage all these permissions and the resources they interact with, so generally for any AWS service that's used, this role is given a wildcard permission. That makes it extremely powerful, so it should never be used for anything else.
- In cases where this role needs very limited access to a certain API, don't use a wildcard; be explicit. One example is S3; CloudFormation will never delete an S3 bucket, even if one that it created is removed from a template. This role really only needs permission to `CreateBucket` and `PutLifecycleConfiguration`, so those are defined explicitly, rather than giving the role an `s3:*` policy. This may be true of other data resources (Redis, databases, file systems, etc), and similar care should be taken when granting access to those services.

### Notes

- Currently, it's not possible to configure certain aspects of a CloudFormation stack that is launched by CodePipeline when the pipeline is defined in CloudFormation. These include tags and notification ARN's. Once the staging and production root stacks are launched, these should be added manually. Stack launched *by* the root stacks (e.g., the VPC stack, or the CMS stack) will have notifications and tagging automatically.
- Resources associated with load balancers (e.g., target groups, listeners) can have a hard time being reallocated on the fly. If you need to move a target group to a different ALB or similar, you should create a new resource. This could be done simply by giving an existing resource a new logical ID (CloudFormation will treat that as a new resource – tear down the old resource, and create a new one), or adding a new resource in one deploy and removing the old unused resource in a later deploy.

## On-boardings applications and services

In order for an application, service, or any AWS resource to be deployed and manage, it must be present at some level in the [root stack](https://github.com/PRX/Infrastructure/blob/main/spire/templates/root.yml). `root.yml` is a the template that any deploy actions in the CD pipeline deploys, updates, or creates change sets against. For an AWS resource to be directly managed by CD, it must exist in `root.yml` or in a nested stack that exists in `root.yml`. In most cases, resources will be created in groups related to a specific application, and that application will have its own nested stack.

As an example, the [Exchange](https://github.com/prx/exchange.prx.org) app is managed through CD. It has its own [template](https://github.com/PRX/Infrastructure/blob/main/spire/templates/exchange.yml), which creates a number AWS resources necessary for deploying the app: log groups, ALB listener rules, ECS task definition and service, etc. The publish template is used with a nested stack resource in `root.yml`, so any time the root stack is updated, any changes that have been made to the publish template or its parameters will also be deployed.

**NOTE** As of now, CloudFormation templates deployed through CodePipeline are limited by the 51,200 byte limit on CloudFormation body requests. There is a higher limit when templates are deployed directly from a location in S3, but that's not currently possible with CodePipeline. In order to avoid this limit, several layers of nesting should be used, to keep the number of resources in the top-level root stack at a minimum.

When creating to managing an application or set of resources, there are few hard-and-fast rules about how that should be done. But you should keep in mind the following as you work on templates that CD uses.

- **Security first**: While it can be a bit of extra work and makes templates somewhat longer, CloudFormation makes it very easy to create IAM roles and permissions for exactly what you need. If you are used to reusing IAM roles or users for many different purposes that are similar, because managing dozens or hundreds of roles through the console can be cumbersome, try to get used to making more roles. Additionally, always use the most limited set of permissions necessary to get a specific resource working. In policy statements, only add the `Action` and `Resource` values that are needed.

- **Understand CloudFormation fundamentals**: Many parts of CloudFormation will be very familiar if you've used the console, SDK, or command line to interact with AWS resources. There are certain unique aspects of how resources can and will be managed, though, within the world of CloudFormation. The [resource type reference](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-template-resource-type-ref.html) will make it very clear when there are caveats associated with a specific resource type or even a given property within a resource. Sometimes changing the value of a single property will necessitate creating a new AWS resource (rather than the existing resource simply being updated). As you build out templates, pay close attention to these types of details within CloudFormation.

- **Do everything in CloudFormation**: It can very easy to create all the primary resources for an application in CloudFormation, and then find yourself creating additional, supporting resource in other ways. You may go into the console to create a CloudWatch Alarm, or update an ALB setting. Avoid doing this at all costs. When it's unavoidable that an application relies on a resource that is not managed through the root stack, be sure to use a stack reference when possible, or a stack parameter as a last resort.

- **Create similar resources when necessary**: There are a number of resources that the root stack creates which provide common functionality that many things will need: a VPC, or a load balancer, for example. Feel free to make new, similar, resources in cases where you have specific needs that the provided resources don't meet.

- **Use good names**: There are generally two places where things get names in CloudFormation resources: the logical ID of the resource definition, and the name of the resource itself. The latter is often the `name` tag associated with the AWS resource, but not always. The logical ID is the JSON or YAML key in the template file for the resource definition. CloudFormation uses this value to keep track of the resource; if it changes, to Cloudformation that will look like one resource was removed and another was created. It's common for AWS to create ID's and names for resources that incorporate the logical ID, so it can be beneficial to use good naming conventions.

- **Tag everything**: Whenever possible (not all AWS services support tagging, and CloudFormation does not support tags for all services that do), include tags on resources created through templates. Common tags that should pretty much always be included are: `Project`, `Environment`, `prx:cloudformation:stack-name`, and `prx:cloudformation:stack-id`. Be sure to use consistent values—these tags are often used to help track billing.

- **Use environment flags**: CloudFormation conditionals can be very helpful. You may want to create a CloudWatch Alarm that only exists in production. Or you may want to spin up a new application that only gets deployed to staging until you do some testing.

- **Comments**: YAML supports commenting. Use it.

- **Pay attention to property types**: There are many cases where a property value for a resource type will look like it takes one type, but actually takes another. Number values and booleans can be strings. It's very unusual for CloudFormation to incorrectly handle mismatches, but do your best to have the template match what's expected and documented. `"1234"`, `"true"`, etc. But also the documentation is wrong some times. Linting can help with this.

- **Keep templates organized**: It's helpful to treat each template itself as a product that other, unknown people will be using. Think critically about how to design and build each template so it is obvious and easy for someone to look at a template for the first time and have a good understanding of what is happening and how. Comments can help greatly with this, but the way that resources within each template are organized can also help. In some cases it may make more sense to group similar resources together (e.g., all the SNS topics in one place), and in others different-but-releated resources (e.g., the role, api, function, permission, and alarms for a serverless app). If you are reviewing a template and it doesn't make much sense, say something!

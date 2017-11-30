# Infrastructure
Templates and assets used to launch and manage many aspects of PRX's applications and services

This is a fairly comprehensive system that is intended to utilize an "infrastructure as code" philosophy. The goal is to describe the various AWS resources (and their associated configurations) needed to run a multitude of applications, servers, and services using code and templates.

This system is designed to provide CI and CD for applications as well as the infrastructure. This means that standard practices like code reviews and Git merges can be applied to infrastructure code, and the deployment of changes to the AWS resources that run applications can be managed much more explicitly.

#### Useful Resources

- [AWS CloudFormation Resource Types Reference](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-template-resource-type-ref.html)
- [AWS CloudFormation Template Anatomy](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/template-anatomy.html)
- [AWS CloudFormation Pseudo Parameters](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/pseudo-parameter-reference.html)
- [AWS CloudFormation Intrinsic Functions](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/intrinsic-function-reference.html)
- [AWS CloudFormation Template Configuration File Reference](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/continuous-delivery-codepipeline-cfn-artifacts.html#d0e10050)
- [AWS CloudFormation Parameter Override Functions with AWS CodePipeline Pipelines](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/continuous-delivery-codepipeline-parameter-override-functions.html)
- [AWS CodePipeline Pipeline Structure Reference](https://docs.aws.amazon.com/codepipeline/latest/userguide/pipeline-structure.html)
- [AWS CodePipeline CloudFormation Action Reference](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/continuous-delivery-codepipeline-action-reference.html)
- [AWS CodeBuild Build Specification Reference](https://docs.aws.amazon.com/codebuild/latest/userguide/build-spec-ref.html)
- [AWS CodeBuild Build Phase Transitions](https://docs.aws.amazon.com/codebuild/latest/userguide/view-build-details.html#view-build-details-phases)
- [AWS CodeBuild Build Environment Reference](https://docs.aws.amazon.com/codebuild/latest/userguide/build-env-ref.html)
- [AWS CodeBuild Environment Variables in Build Environments ](https://docs.aws.amazon.com/codebuild/latest/userguide/build-env-ref-env-vars.html)

There is a draw.io file (`System Diagram.xml`) that gives a good overview of how many of the main pieces of the CI and CD systems fit together.

## Components

There are three main components to the infrastructure system as a whole: **Notifications**, **CI**, and **CD**. Each is defined as its own CloudFormation template. Launching either the CI or CD stack require a preexisting Notifications stacks, but otherwise are entirely independent. They generally will be launched together, and their operations do overlap in some ways, but there are not hard dependencies between the two.

There is also a very lightweight **Storge** stack that creates a few necessary, shared S3 buckets.

### Notifications

The **Notifications** stack is largely responsible for messaging both within the system, and to and from external sources. Messages are passed around using API Gateways and SNS topics. Lambda functions either back the API Gateway methods or subscribe to the SNS topics in order to act on the Messages.

### Continuous Integration

The **CI** stack launches a set of resources that handle code commit related events coming from the GitHub webhook API, and prepare that code to be deployed. The CI setup handles master branch commits, as well as code changes for pull requests. Only master branch code changes will package code to be deployable (for instance, pushing a Docker image to ECR).

At a high level, the system involves: an organization-level webhook configuration on GitHub sending events for activity on all PRX repositories; whose events are handled (via API Gateway) by a Lambda function; which triggers a CodeBuild project that is builds, tests, and packages the applications.

When a new packaged version of an app is pushed out (eg., to ECR), the CI process also updates the staging environment's template configuration file to reference the new version.

### Continuous Delivery

The **CD** stack takes care of launching and updating applications. A pipeline is created in CodePipeline, which watches for changes to either the infrastructure code (which includes templates for each individual app) or staging infrastructure configuration.

When either the infrastructure code or the staging infrastructure configuration is updated, the pipeline deploys the changes to a staging environment. Acceptance tests then run against staging. If they pass, the updates can then be deployed to the production environment, and the relevant values that should be updated in the production environment template configuration file (currently, only keys that match `"(EcrImageTag|S3ObjectVersion)"`) will be updated from the staging configuration file.

Whenever an environment is successfully deployed, the CD pipeline also captures the state of the infrastructure and configuration, so that known good states can be rolled back to if necessary.

## Template Configuration Files

When the CD pipeline deploys to an environment, it is actually launching (or updating) a root stack. The deployment process must provide values for all of the parameters the root stack template expects. These values are provided by a _template configuration file_. This config file contains some general purpose values that are used by the CD process itself, as well as versioning information that indicates which version (eg, Docker image) and which configuration should be used to deploy each app nested within the root stack.

As part of the **CI** process, whenever a new version on an application is available, such as when a new Docker image is pushed to ECR, the staging template configuration file is updated. Because the CD pipeline watches that file for changes, a loose link between the two processes exists. In most cases, a change app code (eg, a merge or commit to the master branch of some app repo), will trigger CI and CD automatically.

## Root Stack

Root stacks are launched by the CD process. A root stack represents a specific environment type (eg staging, production, etc). The root stack is responsible for launching additional stacks for specific platforms, services, and applications.

By using the root stack model, the CD process only needs to be directly aware of a single template, and can generate CloudFormation change sets around a single stack which can subsequently update many other stacks.

The values from the template configuration files stored securely in S3 get passed to the root stack. It's the up to the root stack template to pass individual values to the nested stacks that need them.

The root stack also handles shuttling values and resources between its nested stacks. For example, many application stacks that the root stack launch will require a VPC or Subnets. The root stack can pull those values out of the VPC stack and pass them back into the other stacks that require them. This keeps individual stacks from needing to be tightly coupled to any other specific stack, even if it depends on resources provided by that stack.

Once a root stack has been launched, it is not tied directly to the CD stack, but the IAM role that is associated with any nested stacks does come from the CD stack. If you remove the CD stack, and thus that IAM role, tearing down the root stack's nested stacks and be difficult.

### Application, Service, and Resource Stacks

Within the root stack template (`root.yml`), `AWS::CloudFormation::Stack` resources are used to define the stacks that should be launched by the root stack. The templates for those nested stacks will end up on S3 as a result of the bootstrapping process; they will remain synced with the GitHub code as long as the bootstrapping stack continues to exist.

Each stack resource defines which parameters from the root template configuration file should be passed down the chain. Other values, such as those from other application/service stacks or those intrinsic to the root stack itself, can also be passed in when necessary.

Some stacks launched by the root stack are entirely comprised of additional AWS resources. For example, one stack is only responsible for creating a VPC and the various resources need to support the VPC. These resources are intended to be used by other stacks.

Most stack launched by the root stack will be applications or groups of applications (platforms). For example, one stack may create a Node.js application that runs inside a Docker container, using ECS/EC2 resources defined by a resource stack.

#### Platforms

In cases where several applications or services are tightly coupled, it may make more sense to manage them with an additional layer of abstraction. Rather than adding each application directly to the root stack template, a template for the whole constellation of apps could be created and added to the root stack template.

The root stack would then be responsible for launching the platform stack, which in turn would launch a number of other app-specific stacks. This can be useful if the apps share resources that are specific to that platform, or that have specific testing needs.

## Applications

Several things are necessary for applications to work within this system.

The first is a template the defines the infrastructure needed to host the app. For a Docker application this may include things like: an ECS service and task definition, and ALB, various IAM roles, CloudWatch alarms, and Route53 DNS records. This template would look very similar to the template that would be created if the application were to be launched through CloudFormation outside of this CI/CD system.

For most applications, an additional template will be built to support the CI/CD aspects of that particular app. For a Docker app, that may be a CodePipeline which includes CodeBuild projects that build and test the Docker image, and other actions to push the image to ECR and update infrastructure config files to reflect the new app code.

## Setup

First, launch a storage stack. This exports a number of S3 bucket names, which will be used throughout the remaining components of the system. The exports are in the format `{stack name}-{identifier}`. Passing the storage stack name as a parameter to the other stacks will allow them to find the exports.

Once the storage buckets have been created, use the `setup.sh` shell script to zip and upload Lambda function code needed by the remaining Infrastructure stacks to the _support_ bucket. **Make sure the `s3 sync` command is pointing at the correct bucket.**

Create zip archives for staging and production template configurations in the _config_ bucket. Each of these should contain a single file (`staging.json` and `production.json`, respectively). They should both contain exactly the same keys, which must match the parameters in `root.yml` (other than those flagged as _parameter overrides_).

> _Note: there is a root level `Parameters` key in all template configuration files_

- `EnvironmentType` must be `Staging` or `Production`
- `ASGKeyPairName` must be an **existing** key pair name
- `ECRRegion` is where all ECS task definitions will look for images, regardless of their region
- `{AppName}ECRImageTag` will exist for each Docker app
- See the secrets Readme for info about all `Secrets` values

Both the CI and CD stacks rely on an existing Notifications stack. Create a Notifications stack before trying to launch either the CI or CD stacks. The parameters required for the Notifications stack are mainly webhooks for third party services that notifications are sent to.

Launching a CI stack will require the name of the previously created Notifications stack, as well as a GitHub access token and webhook secret for getting data into and out of GitHub API's. Because the CI process is triggered by GitHub `push` and `pull_request` events, and the end result is either tests passing, or a deployable package being push to, for example, ECR, there is no reason for CI to be launched in multiple regions. If it were, each instance of CI stack would be trying to accomplish the same thing.

Unlike the CI stack, the CD stack must be launched in any region where applications need to be deployed. Deployments made by any given CD stack can only ever impact the region where the CD stack itself is located.

If the goal is to have apps replicated in both us-east-1 and us-west-2, there should be a CD stack in both. A CI stack would only exist in, say, us-east-1. When CI updates a template configuration in us-east-1, some other process (S3 replication, etc) could update the template config in us-west-2, which would trigger CD in the west region.

Once these four stacks are launched, the system should be operational. It's a good idea to: manually set a `Notification ARN` for each of these stacks (you can use an SNS topic created by the Notification stack itself); tag each stack with `Project:Infrastructure`; set the CloudWatch log retention period on log groups that get created; set the Insufficient Data handling on CloudWatch alarms to _ok_.

There may be some external services (Slack, etc) that need to be updated with API endpoint URL's that get created through launching these stacks.

### Multi-region support

_Coming soon..._

## Destruction

If you want to remove everything created by Infrastructure, do so in this order:

- Delete CI stack
- Delete production root stack
- Delete staging root stack
- Delete CD stack
- Delete Notifications stack
- Delete Storage stack
- Delete CD pipeline artifacts store bucket (`cd-artifactstore-...`)
- Delete CI CodeBuild source bucket (`ci-cicodebuildsourcearchivebucket-...`)
- Delete the five buckets created by the Storage stack

### S3 Buckets

There are many S3 buckets used as part of the CI/CD that are defined within CloudFormation templates, and don't need to be managed separately. A few buckets, though, must exist prior to launching any parts of this system, and must be configured correctly. The following describe each of those buckets:

#### Support

Holds miscellaneous resources that are needed at various points of the setup and deployment process, such as zip files for Lambda function code used by the Notifications, CI, and CD stacks themselves.

- Exported as: `${AWS::StackName}-InfrastructureSupportBucket`
- Named: `${BucketNamePrefix}-${AWS::Region}-support`, eg `prx-infrastructure-us-east-1-support`

#### Source

Holds copies of the Infrastructure repository, prefixed with the Git commit hash from when the copy was made. The root stack template points to files in this bucket for nested templates. It does not need S3 versioning.

- Exported as: `${AWS::StackName}-InfrastructureSourceBucket`
- Named: `${BucketNamePrefix}-${AWS::Region}-source`, eg `prx-infrastructure-us-east-1-source`

#### Config

Holds one zip file per environment, each which holds a single JSON file. Eg. `template-config-production.zip` and `template-config-staging.zip`. Versioning is required; these files are updated in place whenever the configuration changes. Versioning is used to rollback to good states.

- Exported as: `${AWS::StackName}-InfrastructureConfigBucket`
- Named: `${BucketNamePrefix}-${AWS::Region}-config`, eg `prx-infrastructure-us-east-1-config`

#### Snapshots

Holds JSON files used to capture code and configuration states when deploys occur. Eg. `staging/1389173987.json`, `production/1276476413.json`. Versioning is not required.

- Exported as: `${AWS::StackName}-InfrastructureSnapshotsBucket`
- Named: `${BucketNamePrefix}-${AWS::Region}-snapshots`, eg `prx-infrastructure-us-east-1-snapshots`

#### Application Code

Stores application code that will be deployed from an application stack. This is primarily used for AWS Lambda functions. Each application is given a single key, and S3 versions are used to deploy specific versions of the code by the CloudFormation application stacks. Versioning is required.

- Exported as: `${AWS::StackName}-InfrastructureApplicationCodeBucket`
- Named: `${BucketNamePrefix}-${AWS::Region}-application-code`, eg `prx-infrastructure-us-east-1-application-code`

## Miscellaneous

### Load Balancers

Resources associated with load balancers (eg, target groups, listeners) can have a hard time being reallocated on the fly. If you need to move a target group to a different ALB or similar, you should create a new resource. This could be done simply by giving an existing resource a new logical ID (CloudFormation will treat that as a new resource – tear down the old resource, and create a new one), or adding a new resource in one deploy and removing the old unused resource in a later deploy.

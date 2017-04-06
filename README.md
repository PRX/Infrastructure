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
- [AWS CodeBuild Build Phase Transitions ](https://docs.aws.amazon.com/codebuild/latest/userguide/view-build-details.html#view-build-details-phases)
- [AWS CodeBuild Environment Variables in Build Environments ](https://docs.aws.amazon.com/codebuild/latest/userguide/build-env-ref.html#build-env-ref-env-vars)

## Bootstrap

The bootstrapping part of the system is a CodePipeline that has two main roles.

First is to pull in infrastructure source code (from GitHub and S3), and ensure that it is available to other parts of the system (either as CodePipeline artifacts, or files on S3).

Second is the orchestrate deployments of **root stacks** using the infrastructure code for various environments. Deployments are generally protected by manual approval actions.

The bootstrap process is itself defined as a CloudFormation template, but generally a bootstrap stack will be launched manually. Once a bootstrap stack has been launched in a region, all the standard environments (staging, production, etc) will be handled mainly by automated processes, including changes to both infrastructure and app code.

Launching a bootstrap stack can be done via the command line, using a command such as:

```
aws cloudformation create-stack --stack-name Bootstrap --template-body file:///path/to/the/bootstrap.yml --parameters ParameterKey=GitHubOAuthToken,ParameterValue=123456789abcdef ParameterKey=RootStackName,ParameterValue=Root ParameterKey=RootStackTemplateConfigArchive,ParameterValue=us-east-1.zip ParameterKey=RootStackTemplateConfigBucket,ParameterValue=infrastructure-template-config-archives

```

All parameters are required to launch a bootstrap stack, and descriptions of each can be found in `bootstrap.yml`.

### Template Configuration Files

When the bootstrapping process launches a root stack, it must provide values for all of the parameters the root stack template expects. These values are provided by a _template configuration file_, and can include values that are used by the root stack, stacks nested in the root stack, or images or applications that those stacks launch (eg environment variables).

The location of the config files is set when launching a stack from the `bootstrap.yml` template. The location points to a .zip archive which contains individual config files. The bootstrap CodePipeline will select the appropriate file when launching stacks for different environments. (Eg, the `staging.json` file in the archive will be used when launching a root stack for staging). This allows you to, for example, configure an ASG to use micro instances in staging, and medium instances for production.

## Root Stack

Root stacks are launched by the bootstrapping process. A root stack represents a specific environment type (eg staging, production, etc). The root stack is responsible for launching additional stacks for specific platforms, services, and applications.

By using the root stack model, the bootstrapping process only needs to be directly aware of a single template, and can generate CloudFormation change sets around a single stack which can subsequently update many other stacks.

The values from the template configuration files stored securely in S3 get passed to the root stack. It's the up to the root stack template to pass individual values to the nested stacks that need them.

The root stack also handles shuttling values and resources between its nested stacks. For example, many application stacks that the root stack launch will require a VPC or Subnets. The root stack can pull those values out of the VPC stack and pass them back into the other stacks that require them. This keeps individual stacks from needing to be tightly coupled to any other specific stack, even if it depends on resources provided by that stack.

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

## Miscellaneous

### Load Balancers

Resources associated with load balancers (eg, target groups, listeners) can have a hard time being reallocated on the fly. If you need to move a target group to a different ALB or similar, you should create a new resource. This could be done simply by giving an existing resource a new logical ID (CloudFormation will treat that as a new resource – tear down the old resource, and create a new one), or adding a new resource in one deploy and removing the old unused resource in a later deploy.

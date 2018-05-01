# Infrastructure
Templates and assets used to launch and manage many aspects of PRX's applications and services.

The Infrastructure project itself contains many independent or related-by-separate projects and assets. It is the home for all work that helps PRX adhere to an "infrastructure as code" philosophy. The goal is to describe the various AWS resources (and their associated configurations) needed to run a multitude of applications, servers, and services using code and templates.

All aspects of Infrastructure largely rely on [AWS CloudFormation](https://aws.amazon.com/cloudformation/).

Applications, as well as the systems designed to test and deploy those applications, are described using CloudFormation templates. Collectively the systems used to facilitate application deployment and the infrastructure necessary to support them are referred to as **CI/CD**. There are a number of other aspects of our AWS architecture that do not fall under that umbrella but are also maintained as part of the Infrastructure project. This includes things like DNS records for hosted zones.

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

## CI/CD Setup

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

If you want to remove things created by Infrastructure for CI/CD, do so in this order:

- Delete CI stack
- Delete production root stack
- Delete staging root stack
- Delete CD stack
- Delete Notifications stack
- Delete Storage stack
- Delete CD pipeline artifacts store bucket (`cd-artifactstore-...`)
- Delete CD pipeline CloudTrail storage bucket (`cd-CdPipelineS3TriggerTrailStore-...`)
- Delete CI CodeBuild source bucket (`ci-cicodebuildsourcearchivebucket-...`)
- Delete the five buckets created by the Storage stack

# Continuous Deployment

#### Useful Resources

- [AWS CloudFormation Resource Types Reference](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-template-resource-type-ref.html)
- [AWS CloudFormation Template Anatomy](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/template-anatomy.html)
- [AWS CloudFormation Pseudo Parameters](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/pseudo-parameter-reference.html)
- [AWS CloudFormation Intrinsic Functions](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/intrinsic-function-reference.html)
- [AWS CloudFormation Template Configuration File Reference](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/continuous-delivery-codepipeline-cfn-artifacts.html#d0e10050)
- [AWS CodePipeline Pipeline Structure Reference](https://docs.aws.amazon.com/codepipeline/latest/userguide/pipeline-structure.html)
- [AWS CodePipeline CloudFormation Action Reference](https://docs.aws.amazon.com/codepipeline/latest/userguide/action-reference-CloudFormation.html)
- [AWS CodeBuild Build Specification Reference](https://docs.aws.amazon.com/codebuild/latest/userguide/build-spec-ref.html)
- [AWS CodeBuild Build Phase Transitions](https://docs.aws.amazon.com/codebuild/latest/userguide/view-build-details.html#view-build-details-phases)
- [AWS CodeBuild Build Environment Reference](https://docs.aws.amazon.com/codebuild/latest/userguide/build-env-ref.html)
- [AWS CodeBuild Environment Variables in Build Environments ](https://docs.aws.amazon.com/codebuild/latest/userguide/build-env-ref-env-vars.html)

## Deployment

The continuous deployment platform is intended to be managed and launched through [AWS CloudFormation](https://aws.amazon.com/cloudformation/), so any AWS resources that are necessary for the system to operate should be added to the `cd/template.yml` template that already exists. CloudFormation stacks should always be designed to work in any AWS region, and allow for multiple stacks to be launched without conflicting, even in the same region (though doing so is unexpected and not recommended).

**Never make changes to AWS resources that were created through CloudFormation other than through CloudFormation, and do not create any resources outside of the CloudFormation template**. The CD system is entirely self-contained and should remain that way.

Sensitive information, such as API keys, should be managed through [Parameter Store](http://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-paramstore.html) when possible. In cases where that's not possible, the values can be passed in to the CloudFormation stack as normal [stack parameters](http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/parameters-section-structure.html).

When there are external dependencies, such as the configuration of GitHub Webhooks, the [README](https://github.com/PRX/Infrastructure/blob/main/cd/README.md) should include information to help with getting those dependencies set up.

There is no automated process for deploying changes to the CD stack. If the CloudFormation template changes, the stack must be updated manually (through the AWS Console or command line). You should always be sure to carefully review the resources that are changing before executing the stack update (The CloudFormation console will enumerate any resources that will change as a result of the update).

The code for AWS Lambda functions likewise will not deploy automatically, even if you deploy stack changes manually. If you push updated Lambda code to S3 prior to executing a stack update, CloudFormation likely will not notice the change and won't update the deployed function code. For now, the easiest and most reliable way to deploy Lambda code changes is copy-and-paste through the console. (This is not true of other properties of Lambda functions defined in the template, such as the timeout; those will update as expected during a stack update.) Other than when launching a new CD stack, pushing Lambda function code to S3 has no real purpose at the moment.

## Code Review

At this time, there is no native support for testing the CD system. That is to say, it can be hard to test changes outside of the primary deployment. Even though the CD system and the environment stacks that it creates or updates are not dependent on each other, it's very possible to make changes to CD that could negatively impact a previously-launched stack, or the processes that we use to manage production stacks.

As such, it is a good idea to have code reviewed, even if the changes have already been deployed and appear to be working. If you're working on feature branches and deploying code that isn't yet committed to `main`, there is the potential that others are also deploying changes that don't include your changes. Good communication is the best method for handling this.

## Code Standards

Be sure to follow any coding standards outlined in the [CONTRIBUTING](https://github.com/PRX/Infrastructure/blob/main/CONTRIBUTING.md) file in the root of this repository.

## Documentation

The [README](https://github.com/PRX/Infrastructure/blob/main/cd/README.md) should always be kept up to date. As you make changes to parts of the system, make sure you are simultaneously updating or adding to the README. In some cases, like with AWS Lambda functions, there may be some duplication of documentation. You may find that you are updating docs in the README, in the Lambda code file, and inline in the CloudFormation template. If you are reviewing changes, it's helpful to check any places that documentation may need to be updated to ensure that the repository stays in good shape.

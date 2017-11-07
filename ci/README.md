# PRX CI

Provides an API to accept GitHub events via a webhook endpoint. The events we
care about are pushes to master branches, and code changes to pull requests. A
Lambda function handles those webhook requests, and forwards relevant events to
another Lambda that handles the beginning of the CI process. That includes
checking to make sure the code that triggered the event is set up for PRX CI,
getting the code to S3, starting a run in CodeBuild, and handling status
messages to GitHub and other places (Slack, email, etc).

There is a third Lambda function that CodeBuild runs trigger to close out the
process. That mainly entails updating the GitHub status, and sending more
notifications to Slack/etc.

## Setup

Most of the setup is done by launching a stack using the `ci.yml` CloudFormation
template. There is a prerequisite that code for the Lambda functions has been
copied to S3. There's a basic deploy script that will do that for you. This
stack also requires an Infrastructure/notifications stack; you must pass in the
name of an already-launched notifications stack.

When launching the stack, you will need to provide a GitHub access token, the
secret that was set for the GitHub webhook, the name of the S3 bucket where
the Lambda function code can be found, and the URL of the shell script that
CodeBuild will use to bootstrap the build process.

For now the expectation is that this stack will only be launched once, and the
GitHub webhook will be setup at the organization level, for all repositories.

## Build Process

The build process is trigged by the second-stage Lambda function by calling
`startBuild` against the CodeBuild API. All builds, regardless of project or
repository, are build using a single, shared CodeBuild project. Parameters are
passed to `startBuild` to tell the project where to find the code for a given
build. The `buildspec.yml` from the repository being built is also passed to
`startBuild`.

Additionally, a number of environment variables are passed to the build
environment. The variables are set in several different places, and are critical
to the function of the CI process, so it's important to have a good
understanding of how they work.

- `PRX_SNS_CALLBACK` The CodeBuild Callback Lambda function is subscribed to this topic. When the build completes a message should be sent there to complete the CI process. This value is set on the CodeBuild project resource definition in the CloudFormation template.
- `PRX_AWS_ACCOUNT_ID` The AWS account ID where building and publishing takes place. This value is set on the CodeBuild project resource definition in the CloudFormation template.
- `PRX_APPLICATION_CODE_BUCKET` The name of the S3 bucket where zipped Lambda code should be sent. This value is set on the CodeBuild project resource definition in the CloudFormation template.
- `PRX_REPO` The name of the GitHub repository that initially triggered the webhook request. It's used for status notifications before and after the build. The value is determined by the Lambda and set during the call to `startBuild`.
- `PRX_COMMIT` The commit hash of the event that triggered the webhook request. It's used for status notifications before and after the build. The value is determined by the Lambda and set during the call to `startBuild`.
- `PRX_GITHUB_PR` The GitHub pull request number for the triggering event. It's used for status notifications before and after the build. The value is only present for pull request events and set during the call to `startBuild`.
- `PRX_CI_PUBLISH` Used as a flag to tell the the CI process that the code should be published if it passes testing. This is generally only set to true for push events to a `master` branch, and is set during the call to `startBuild`.
- `PRX_ECR_REGION` For code that is pushed to ECR, indicates the region the repository is in. The value is set in each project's `buildspec.yml`.
- `PRX_ECR_REPOSITORY` For code that is pushed to ECR, indicates the name of the repository to push to. The value is set in each project's `buildspec.yml`.
- `PRX_ECR_TAG`
- `PRX_LAMBDA_CODE_S3_VERSION_ID`

To reduce duplication of code for tasks common to most builds, such as publishing code or the SNS callback messages, a utility script is available. Generally the script will be downloaded and executed as the final command in the `post_build` phase of each `buildspec.yml` file.

#### Output

When the build completes, regardless of success, it sends a message to the CodeBuild Callback SNS topic. Many of the above envionment variables are included in that message (eg `prxRepo`, `prxCommit`). Additionally, `success`, `reason`, and `buildArn` are included in the message.

The callback handler will update the GitHub branch status to reflect the result of the build, and send a message to Slack. Additionally, if a new version of code was pushed, such as to ECR or S3, the callback handler will update the template configuration file used by the staging environment with the identifier of the new version (eg, ECR tag or S3 version ID).



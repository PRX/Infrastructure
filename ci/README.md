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
repository, are built using a single, shared CodeBuild project. Parameters are
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
- `PRX_ECR_TAG` Seven character Docker tag
- `PRX_ECR_IMAGE` Full Docker image name
- `PRX_LAMBDA_CODE_S3_VERSION_ID` The S3 version ID of the zipped Lambda code

To reduce duplication of code for tasks common to most builds, such as publishing code or the SNS callback messages, a utility script is available. Generally the script will be downloaded and executed as the final command in the `post_build` phase of each `buildspec.yml` file.

#### Output

When the build completes, regardless of success, it sends a message to the CodeBuild Callback SNS topic (when the utility script is in use). Many of the above envionment variables are included in that message (eg `prxRepo`, `prxCommit`). Additionally, `success`, `reason`, and `buildArn` are included in the message.

The callback handler will update the GitHub branch status to reflect the result of the build, and send a message to Slack. Additionally, if a new version of code was pushed, such as to ECR or S3, the callback handler will update the template configuration file used by the staging environment with the identifier of the new version (eg, ECR tag or S3 version ID).

### CI Support

Adding CI support to an app is rather simple, but the process differs depending on which deployment targets the app ultimately needs to support. There are some common elements though.

CI will attempt to run if the following conditions are met:

- The repository is in the PRX GitHub organization
- A commit is made to a master branch or a change is made to a pull request
- The repository contains a `buildspec.yml` file

Beyond this, there are no technical requirements necessary to be compatible with the CI system. It will happily run any buildspec that it sees, making it possible to write an entirely custom build process for a project.

In general, though, most projects will want to handle parts of the build process in similar ways. By adhering to certain conventions and including shared code libraries, much of the work needed to get an app to play nicely with the continuous deployment system will be much easier. This primarily impacts the end of the build process, where any built code or code artifacts are published somewhere that CD can deploy from.

If you opt in to using the common CI support code, you must ensure that docker-compose is available in the build environment. By default this is not installed in the CodeBuild environment; a good place to install it would be the `install` phase of the project's `buildspec.yml`.

Additionally, the project to execute the `post_build.sh` script that is maintained in the Infrastructure repo. This is the code responsible for handling the common tasks associated with prepping apps for CD. If you choose to have this script publish the code resulting from the build process (which generally will be the case), the `PRX_CI_PUBLISH` environment variable must be set to the string value `true` by the time the post_build script runs. The `post_build` script also sends a message to an SNS topic, including information about the build process and any published code. There is a callback Lambda function that also runs as part of the CI process that can take these messages, and trigger updates to the CD system.

### ECS Targets

For apps that run on Docker through ECS, the `post_build` script can push build docker images to a repository in ECR. In such cases, the callback Lambda function will update metadata used by CD to keep the deployed applications in sync with the new images in ECR.

In order for `post_build` to handle ECS-based apps, the following environment variables must be set:

- `PRX_ECR_REPOSITORY` – The name of the ECR repository that built Docker images will get pushed to
- `PRX_ECR_REGION` – The AWS region that the repository defined by `PRX_ECR_REPOSITORY` was created in
- `PRX_ECR_CONFIG_PARAMETERS` – A comma-separated list of CloudFormation template config parameter names, whose values will be updated to match the tag of the Docker image that was pushed to ECR (eg `AcmeAppEcrImageTag` or `AcmeAppEcrImageTag,DuplicateAcmeAppEcrImageTag`)

Additionally, the `post_build` script will only push one image to ECR, and only if it contains a `LABEL` of `org.prx.app`, as set in the image's `Dockerfile`. This allows for the build process to create any number of extra Docker images for testing purposes beyond the applications own image.

### Lambda Targets

For apps and services that run as AWS Lambda functions, the `post_build` script can push zipped code archives to S3, so they are available to be launched by Lambda. The callback function will track the S3 version ID of the objects for those archives, and will update the metadata used by CD to keep them in sync.

In order for `post_build` to handle Lambda-based apps, the following environment variables must be set:

- `PRX_LAMBDA_CODE_S3_KEY` – The S3 object key to use for the zipped code archive file. This object will always be placed in a bucket based on the `PRX_APPLICATION_CODE_BUCKET` environment variable, which has a default value provided by the CI base system, and generally should not be changed.
- `PRX_LAMBDA_CODE_CONFIG_PARAMETERS` – A comma-separated list of CloudFormation template config parameter names, whose values will be updated to match the S3 object version ID of the zip file containing the Lambda code (eg `AcmeAppLambdaVersionId` or `AcmeAppLambdaVersionId,DuplicateAcmeAppLambdaVersionId`)

Additionally, the `post_build` script will always expect to find the zipped code archive that it will push to S3 at the path defined by the `PRX_LAMBDA_ARCHIVE_BUILD_PATH` environment variable, which by default is `/.prxci/build.zip`. It will look for this file in a container created from a Docker image that has a `LABEL` of `org.prx.lambda`, which allows for the build process to involve any number of different Docker images.

How the Lambda code gets tested and zipped is in no way controlled or defined by the CI process. As the creator of a project, you need to make sure that the code is being tested appropriately during the execution of the `buildspec`, and that some Docker image exists at the end of the process that is labeled and contains the zip. The implementation details of those steps are left up to you. You can reference existing projects for guidance, but it's important to remember that Lambda apps can look very different—some are single file and some are many megabytes with included libraries and static data sets. Build a process that works for your project.

# Continuous Integration

## Goals

In order to support the [practice](https://en.wikipedia.org/wiki/Continuous_integration) [of](https://aws.amazon.com/devops/continuous-integration/) **[continuous](https://www.visualstudio.com/learn/what-is-continuous-integration/) [integration](https://www.thoughtworks.com/continuous-integration)** for a large number of the apps and services we build, including all of our customer-facing services, we have built a platform to automate the test and build processes for each project.

The high-level goals of the system are:

- Watch for important code changes that are pushed to GitHub repositories, including all commits to `master` branches, as well as to open [pull requests](https://help.github.com/articles/about-pull-requests/)
- Run build, test, or other processes defined by the applications any time there are such code changes
- Notify developers of the status of those processes in Slack, and ensure that the [build status](https://github.com/blog/1227-commit-status-api) in GitHub is accurate
- Allow for code that passes build and test process to be packaged and pushed to destinations from which it can be deployed
- Create small amounts of lightweight, reusable code to [DRY](https://en.wikipedia.org/wiki/Don%27t_repeat_yourself) up the amount of boilerplate needed for getting a project to support this type of continuous integration

## Project architecture

In order to build a system to accomplish all that, we spin up a number of AWS resources (using a CloudFormation template). Launching a stack from the `ci.yml` template is fairly straightforward, but this CI project is part of a larger, more comprehensive [DevOps project](https://github.com/PRX/Infrastructure), and relies on some resources created by other component stacks.

While the CI stack is designed to be launched in any AWS region, regardless of where the applications running through it are hosted or deployed, it is the case that only one instance of the stack should be running at a time. There is likely nothing terrible that would happen if multiple instances were running, but the same tests would be running against the same code multiple times with no added benefit, and artifacts would be published several times for each set of code changes. It's unlikely this would break a deployment system, but it should be avoided.

### System Components

The following describes each aspect of the CI system in the order that they usually come into play during an execution.

#### GitHub Webhook

For an organization in GitHub (e.g. [PRX](https://github.com/prx/)) a [webhook](https://developer.github.com/webhooks/) is configured which will be sent **pull request** and **push** events. This will cause GitHub to notify an HTTP endpoint every time either of those events takes place on *any* repository in the organization.

An HTTP REST API is constructed using [Amazon API Gateway](https://aws.amazon.com/api-gateway/) for the webhook to target. An [AWS Lambda](https://aws.amazon.com/lambda/) function is provided to handle any requests sent to the webhook endpoint. The function ensures that the requests are valid and authentic, and filters out some noise that is expected, and passes relevant events to an [Amazon SNS](https://aws.amazon.com/sns/) topic for further processing.

#### GitHub Event Handling

Event data that are published to SNS by the GitHub webhook request handler function get handled immediately by another Lambda function. This function includes much more business logic about which events should pass through the CI process and how. This logic includes things like: checking to make sure the event originated from a project that is meant for CI, and filtering out feature branch code pushes that are not part of pull requests.

If it's determined that an event represents code that should be built and tested, this function will:

- Request a zipball archive of the code from GitHub for the commit in question
- Push that archive to [Amazon S3](https://aws.amazon.com/s3/) (so that it is available later in the process)
- Configure and trigger a build for the code in [AWS CodeBuild](https://aws.amazon.com/codebuild/)
- Update the GitHub commit status for the code being tested
- Send a notification to developers through channels like [Slack](https://slack.com/) so the process is highly visible

#### CodeBuild

When the previous step triggers a build, it does so by calling `startBuild` on a CodeBuild project that was setup by the `ci.yml` template specifically for running CI builds. All builds, regardless of which project or GitHub repository triggered them, are run through this one CodeBuild project.

CodeBuild runs all builds in a Docker environment. Often it's the case that the code being built and tested is itself an application that runs on Docker. In such cases, those Docker containers are dealt with _inside_ of CodeBuild's native Docker build environment container (ie, Docker running inside a Docker container).

The configuration for each build is determined by the event Lambda function. This includes properties such as:

- The [build specification](http://docs.aws.amazon.com/codebuild/latest/userguide/build-spec-ref.html) used to run the build
- The location, in S3, of the code to be tested
- Various environment variables that help with the rest of the CI process

#### Build Callback

Once a build run has completed, a third Lambda function is generally invoked to complete the CI process. Information about the original GitHub event, as well information about the results of the build run, are published to SNS, and the callback function handles those messages.

Though the function handles some housekeeping tasks, such as updating the GitHub commit status and sending developer notifications, its most important function is to publish information about deployable code artifacts that result from the builds. This only happens when such an artifact exists (i.e., not when building feature branches). Specifically, the function updates a [template configuration file](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/continuous-delivery-codepipeline-cfn-artifacts.html#w2ab2c13c15c15) that can be used by the [continuous deployment](https://github.com/PRX/Infrastructure/tree/master/cd) system to manage app deployments.

### Auxiliary Components

In addition to the primary stages of the CI process, there are several components that are used to assist. There is another Lambda function that is used to process notifications that get generated throughout the system. Also a utility shell script called `post_build.sh` is maintained and can be executed as part of build spec at the end of a build run. This script can handle many aspects of the build run process that are common to most projects.

## Continuous Integration Support

Adding CI support to an app is rather simple, but the process differs depending on which deployment targets the app ultimately needs to support. There are some common elements though.

CI will attempt to run if the following conditions are met:

- The repository is in the PRX GitHub organization (public or private)
- A commit is made to a master branch or a change is made to a pull request
- The repository contains a `buildspec.yml` file
- The `buildspec.yml` contains the string `PRX_`

Beyond this, there are no technical requirements necessary to be compatible with the CI system. It will happily run any buildspec that it sees, making it possible to write entirely custom build processes project-by-project.

In general, though, most projects will want to handle some parts of the build process in similar ways. By adhering to certain conventions and including shared code libraries, much of the work needed to get an app to play nicely with the continuous deployment system will be much easier. This primarily impacts the end of the build process, where any built code or code artifacts are published somewhere that CD can deploy from.

If you opt in to using the common CI support code, the project must execute the `post_build.sh` script that is maintained in the Infrastructure repo. This is the code responsible for handling the common tasks associated with prepping apps for CD. The script will only attempt to publish code if the `PRX_CI_PUBLISH` variable is set to the string value of `true`. The GitHub event handler Lambda will set that by default for `master` branch events. The `post_build` script also sends a message to an SNS topic, including information about the build process and any published code. There is a callback Lambda function that also runs as part of the CI process that can take these messages, and trigger updates to the CD system.

### ECS Targets

For apps that run on Docker through ECS, the `post_build` script can push build docker images to a repository in ECR. In such cases, the callback Lambda function will update metadata used by CD to keep the deployed applications in sync with the new images in ECR.

In order for `post_build` to handle ECS-based apps, the following environment variables must be set:

- `PRX_ECR_REPOSITORY` – The name of the ECR repository that built Docker images will get pushed to
- `PRX_ECR_REGION` – The AWS region that the repository defined by `PRX_ECR_REPOSITORY` was created in
- `PRX_ECR_CONFIG_PARAMETERS` – A comma-separated list of CloudFormation template config parameter names, whose values will be updated to match the tag of the Docker image that was pushed to ECR (e.g., `AcmeAppEcrImageTag` or `AcmeAppEcrImageTag,DuplicateAcmeAppEcrImageTag`). The CD process requires that these parameter names include the string `EcrImageTag` in order to work properly.

Additionally, the `post_build` script will only push one image to ECR, and only if it contains a `LABEL` of `org.prx.app`, as set in the image's `Dockerfile`. This allows for the build process to create any number of extra Docker images for testing purposes beyond the application's own image.

### Lambda Targets

For apps and services that run as AWS Lambda functions, the `post_build` script can push zipped code archives to S3, so they are available to be launched by Lambda. The callback function will track the S3 version ID of the objects for those archives, and will update the metadata used by CD to keep them in sync.

In order for `post_build` to handle Lambda-based apps, the following environment variables must be set:

- `PRX_LAMBDA_CODE_CONFIG_PARAMETERS` – A comma-separated list of CloudFormation template config parameter names, whose values will be updated to match the S3 object key of the zip file containing the Lambda code (e.g., `AcmeAppLambdaObjectKey` or `AcmeAppLambdaObjectKey,DuplicateAcmeAppLambdaObjectKey`). The CD process requires that these parameter names include the string `S3ObjectKey` in order to work properly.

Additionally, the `post_build` script will always expect to find the zipped code archive that it will push to S3 at the path defined by the `PRX_LAMBDA_ARCHIVE_BUILD_PATH` environment variable, which by default is `/.prxci/build.zip`. It will look for this file in a container created from a Docker image that has a `LABEL` of `org.prx.lambda`, which allows for the build process to involve any number of different Docker images.

How the Lambda code gets tested and zipped is in no way controlled or defined by the CI process. As the creator of a project, you need to make sure that the code is being tested appropriately during the execution of the `buildspec`, and that some Docker image exists at the end of the process that is labeled and contains the zip. The implementation details of those steps are left up to you. You can reference existing projects for guidance, but it's important to remember that Lambda apps can look very different—some are single file and some are many megabytes with included libraries and static data sets. Build a process that works well for your project.

### S3 Static Site Targets

For websites and apps that can be run entirely as static files out of an S3 bucket, the `post_build` script can push zipped code archives to S3. It's important to note that the code resulting from the CI process is pushed to an S3 bucket **different** than the bucket the site will ultimately be served from. The archive is pushed to a bucket from which it can be deployed to the static site bucket during the CD process. You should not attempt to have CI push the code directly to the bucket configured for S3 static site hosting.

The callback function will track the S3 version ID of the zip archive object, and update the metadata used by CD so it is available during a deploy.

In order for `post_build` to handle S3 static sites, the following environment variables must be set:

- `PRX_S3_STATIC_CONFIG_PARAMETERS` – A comma-separated list of CloudFormation template config parameter names, whose values will be updated to match the S3 object key of the zip file containing the Lambda code (e.g., `AcmeAppStaticS3ObjectKey`). The CD process requires that these parameter names include the string `S3ObjectKey` in order to work properly.

Additionally, the `post_build` script will always expect to find the zipped code archive that it will push to S3 at the path defined by the `PRX_S3_STATIC_ARCHIVE_BUILD_PATH` environment variable, which by default is `/.prxci/build.zip`. It will look for this file in a container created from a Docker image that has a `LABEL` of `org.prx.s3static`, which allows for the build process to involve any number of different Docker images.

How the static code gets tested and zipped is in no way controlled or defined by the CI process. As the creator of a project, you need to make sure that the code is being tested appropriately during the execution of the `buildspec`, and that some Docker image exists at the end of the process that is labeled and contains the zip. The implementation details of those steps are left up to you. You can reference existing projects for guidance, but it's important to remember that static site apps can look very different—some are single file and some are many megabytes with included libraries and static data sets. Build a process that works for your project.

# Continuous Integration

## Goals

In order to support the [practice](https://en.wikipedia.org/wiki/Continuous_integration) [of](https://aws.amazon.com/devops/continuous-integration/) **[continuous](https://www.visualstudio.com/learn/what-is-continuous-integration/) [integration](https://www.thoughtworks.com/continuous-integration)** for a large number of the apps and services we build, including all of our customer-facing services, we have built a platform to automate the test and build processes for each project.

The high-level goals of the system are:

- Watch for important code changes that are pushed to GitHub repositories, including all commits to default (`master`, `main`, etc) branches, as well as to open [pull requests](https://help.github.com/articles/about-pull-requests/)
- Run any build, test, or other processes defined by the applications any time there are such code changes
- Notify developers of the status of those processes in Slack, and ensure that the [build status](https://github.com/blog/1227-commit-status-api) in GitHub is accurate
- Allow for code that passes build and test process to be packaged and pushed to destinations from which it can be deployed
- Create small amounts of lightweight, reusable code to [DRY](https://en.wikipedia.org/wiki/Don%27t_repeat_yourself) up the amount of boilerplate needed for getting a project to support this type of continuous integration

> [!IMPORTANT]
> **Known Limitations:**
>
> - Out-of-order builds: If multiple builds for different commits of a single branch or pull request run concurrently, it is possible that the last (newest) commit does not complete after all other builds. In these cases, the newest commit's build may finish and publish an artifact as expected, but then an older commit's build will finish later and also publish an artifact. Because of how CI and Spire CD are integrated, the most-recently created artifact will be deployed even if it is not the most recent commit.

## Project architecture

In order to build a system to accomplish all that, we spin up a number of AWS resources (using a CloudFormation template). Launching a stack from the `ci/template.yml` template is fairly straightforward, but this CI project is part of a larger, more comprehensive [DevOps project](https://github.com/PRX/Infrastructure), and relies on some resources created by other component stacks.

A CI stack should be launched in any AWS region where the arficats it creates are being deployed and hosted. This ensures that the build system is resilient to regional interruptions, and that all regions, including secondary regions, have up-to-date application artifacts. This is strictly necessary for [active-active](https://aws.amazon.com/blogs/architecture/disaster-recovery-dr-architecture-on-aws-part-iv-multi-site-active-active/) multi-region applications, and also ensures that application code is current during a failover for active-passive applications.

> [!NOTE]
> Running CI stacks in multiple regions increases costs associated linearly, and is not the only approach to a fault-tolerant system. Moving to a setup where CI builds happen in only a single region, but the resulting artifacts are pushed to multiple regions, may be explored in the future, so this aspect of the CI system is subject to change.

### System Components

The following describes each aspect of the CI system in the order that they usually come into play during an execution.

#### GitHub Webhook

For an organization in GitHub (e.g. [PRX](https://github.com/prx/)) a [webhook](https://developer.github.com/webhooks/) is configured which will be send **pull request** and **push** events. This will cause GitHub to notify an HTTP endpoint every time either of those events takes place on *any* repository in the organization. A separate webhook should be created in GitHub for every region where CI is deployed.

An HTTP API is constructed using [Lambda function URLs](https://docs.aws.amazon.com/lambda/latest/dg/lambda-urls.html) for the webhook to target. An [AWS Lambda](https://aws.amazon.com/lambda/) function is provided to handle any requests sent to the webhook endpoint. The function ensures that the requests are valid and authentic, filters out some noise that is expected, and sends relevant events to an [Amazon EventBridge](https://aws.amazon.com/eventbridge/) for further processing.

The URL of the API to use for the webhook configuration in GitHub is an output of the CloudFormation stack.

#### Starting a Build

Event data that are published to EventBridge by the GitHub webhook request handler function get processed immediately by another Lambda function: the build handler function. This function includes much more business logic about which events should pass through the CI process and how. This logic includes things like: checking to make sure the event originated from a project that is meant for CI, and filtering out feature branch code pushes that are not part of pull requests.

If it's determined that an event represents code that should be built and tested, this function will configure and trigger a build for the code in [AWS CodeBuild](https://aws.amazon.com/codebuild/) for the GitHub repository and commit or pull request that caused the webhook.

#### CodeBuild

When the previous step triggers a build, it does so by calling [`startBuild`](https://docs.aws.amazon.com/codebuild/latest/APIReference/API_StartBuild.html) on a CodeBuild project that was setup by the `ci/template.yml` template specifically for running CI builds. All builds, regardless of which project or GitHub repository triggered them, are run through this one CodeBuild project.

CodeBuild runs all builds in a Docker environment. Often it's the case that the code being built and tested is itself an application that runs on Docker. In such cases, those Docker containers are dealt with _inside_ of CodeBuild's native Docker build environment container (i.e., Docker running inside a Docker container).

The configuration for each build is determined by the event Lambda function. This includes properties such as:

- The [build specification](http://docs.aws.amazon.com/codebuild/latest/userguide/build-spec-ref.html) used to run the build
- The location, in GitHub, of the code to be tested
- Various environment variables that help with the rest of the CI process

CodeBuild natively supports updating the code's build status in GitHub.

#### Build Events

Several additional Lambda functions are configured as targets for EventBridge rules that watch for state changes on the CodeBuild project. These functions are responsible for handling some or all of the various stages of a build (start, success, fail, etc). The purpose of these functions are things like sending a notification to developers through channels like [Slack](https://slack.com/) so the process is highly visible.

Additionally, one of the build event Lambda functions is responsible for handling successful builds that generated new versions of deployable code artifacts. When a new version results from a build (such as a new Docker image that has been pushed to [Amazon ECR](https://aws.amazon.com/ecr/)), this Lambda function will update values in [Parameter Store](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html), which can be used by the [continuous deployment](https://github.com/PRX/Infrastructure/tree/main/spire/cd) system to manage app deployments.

### Auxiliary Components

A utility shell script called `post_build.sh` is maintained and can be executed as part of a build spec at the end of a build run. This script can handle many aspects of the build run process that are common to most projects.

## Continuous Integration Support

Adding CI support to an app is rather simple, but the process differs depending on which deployment targets the app ultimately needs to support. There are some common elements though.

CI will attempt to run if the following conditions are met:

- The repository is in the PRX GitHub organization (public or private)
- A commit is made to a default branch or a code change is made to a pull request
- The repository contains a `buildspec.yml` file
- The `buildspec.yml` contains the string `PRX_`

Beyond this, there are no technical requirements to be compatible with the CI system. It will happily run any `buildspec` that it sees, making it possible to write bespoke build processes on a project-by-project basis.

All builds take place within Linux environments where a fairly modern version of Docker is available. Aside from that, the specifics of the environment are not guaranteed. It's strongly recommended that the application's build and test processes happen in Docker, rather than directly in the Linux environment, to avoid issues if the build environment changes over time.

In general, most projects will want to handle some parts of the build process in similar ways. By adhering to certain conventions and including shared code libraries, much of the work needed to get an app to play nicely with the continuous deployment system will be much easier. This primarily impacts the end of the build process, where any built code or code artifacts are published somewhere that Spire CD can deploy from.

If you opt in to using the common CI support code, the project must execute the `post_build.sh` script that is maintained in the Infrastructure repo. This is the code responsible for handling the common tasks associated with prepping apps for Spire CD. The script will only attempt to publish and deploy code if the `PRX_CI_PUBLISH` variable is set to the string value of `true`. The build handler Lambda will set that by default for events from a default branch (`main`, `master`, etc).

A Lambda function that watches for successful builds in CodeBuild extracts information from the details of the build, and updates the staging environemnt's configuration values used within the Spire CD system as necessary (e.g., updates the ECR image version to deploy for the app code that was built).

Setting `PRX_CI_PUBLISH` to `true` will result in code being published and the staging environment being updated. It should only be set to `true` if both of those actions are desired. If you need code to be published _without_ the environment being updated, like from a feature branch, you should set `PRX_CI_PRERELEASE` to the string value of `true`.

### ECS Targets

#### Publishing Docker images

At the end of a build, if the `post_build` script is invoked, Docker images resulting from the build will be pushed to ECR if they include the label `org.prx.spire.publish.ecr`. The value is irrelevent in the context of the images being pushed to ECR. For example, a `Dockerfile` might contain:

    LABEL org.prx.spire.publish.ecr="MY_APP"

The images will be pushed to ECR repositories that correspond to their source GitHub repository. For example, a project in the GitHub repository `PRX/my-app` will be pushed to an ECR repository named `github/prx/my-app`. The ECR repository will be in the same region that CI is running in.

#### Updating Spire CD Metadata

In addition to pushing an image to ECR, CI can also update metadata used by Spire CD for deciding which application code to deploy. When CI builds are configured to update these metadata, Spire CD pipeline deploys will begin automatically, resulting in the new code being continuously deployed to staging environments.

To allow the metadata updates, a project's `buildspec.yml` should include an environment variable called `PRX_SPIRE_ECR_PKG_PARAMETERS`, whose value is one or more mappings of Docker image labels to Parameter Store parameter names.

`buildspec.yml` should also export the `PRX_SPIRE_ECR_PKG_PARAMETERS` variable, as well as variables matching any labels that are included in the mappings. For example:

```yaml
env:
  variables:
    PRX_SPIRE_ECR_PKG_PARAMETERS: MY_APP=/prx/stag/Spire/MyApp/pkg/docker-image-tag
  exported-variables:
    - PRX_SPIRE_ECR_PKG_PARAMETERS
    - MY_APP
```

The label in the mapping must correspond to the value of a `org.prx.spire.publish.ecr` label included in a Docker image that was produced during the build.

Multiple Parameter Store parameters can be updated for a single Docker image if necessary, by separating the parameter names with commas:

    PRX_SPIRE_ECR_PKG_PARAMETERS: MY_APP=/path/one,/path/two

Metadata for multiple Docker images can be updated if necessary, by separating mappings with a semicolon:

    PRX_SPIRE_ECR_PKG_PARAMETERS: MY_APP=/path/one,/path/two;MY_DB=/path/three

This will result in any included Parameter Store parameters having their values updated to the full name of a Docker image that was pushed to ECR (e.g., `123456789.dkr.ecr.us-east-1.amazonaws.com/github/prx/myapp:12345646fe26a4b636f0d142b5815ff86fdbafaf`)

The name of the Parameter Store parameters included in these mappings must strictly adhere to the [naming conventions](https://github.com/PRX/internal/wiki/WIP:-Parameter-Store).

### S3 Targets

Several different deployment types use code from S3, including Lambda functions and S3 static websites. The following process is the same for all of them.

#### Publishing ZIP Archives

At the end of a build, if the `post_build` script is invoked, ZIP files resulting from the build will be pushed to S3 if they include the label `org.prx.spire.publish.s3`. The value is irrelevent in the context of the file being pushed to S3. For example, a `Dockerfile` might contain:

    LABEL org.prx.spire.publish.s3="MY_APP"

The files will be pushed to S3 objects that correspond to their source GitHub repository and commit. For example, a project in the GitHub repository `PRX/my-app` will be pushed to an S3 object named `GitHub/PRX/my-app/a1b2c3.zip`. The S3 bucket these files are pushed to is configured on the CI stack.

The file that gets pushed to S3 will be copied out of the labeled Docker image. The location of the file within the image is defined by the `PRX_S3_ARCHIVE_BUILD_PATH` environment variable, which defaults to `/.prxci/build.zip`. If your built ZIP file is located elsewhere in the Docker image, set `PRX_S3_ARCHIVE_BUILD_PATH` to that location in the `buildspec.yml`.

How the code gets tested and zipped is in no way controlled or defined by the CI process. As the creator of a project, you need to make sure that the code is being tested appropriately during the execution of the `buildspec`, and that some Docker image exists at the end of the process that is labeled and contains the ZIP file. The implementation details of those steps are left up to you. You can reference existing projects for guidance.

#### Updating Spire CD Metadata

In addition to pushing files to S3, CI can also update metadata used by Spire CD for deciding which application code to deploy. When CI builds are configured to update these metadata, Spire CD pipeline deploys will begin automatically, resulting in the new code being continuously deployed to staging environments.

To allow the metadata updates, a project's `buildspec.yml` should include an environment variable called `PRX_SPIRE_S3_PKG_PARAMETERS`, whose value is one or more mappings of Docker image labels to Parameter Store parameter names.

`buildspec.yml` should also export the `PRX_SPIRE_S3_PKG_PARAMETERS`variable, as well as variables matching any labels that are included in the mappings. For example:

```yaml
env:
  variables:
    PRX_SPIRE_S3_PKG_PARAMETERS: MY_APP=/prx/stag/Spire/MyApp/pkg/s3-object-key
  exported-variables:
    - PRX_SPIRE_S3_PKG_PARAMETERS
    - MY_APP
```

The label in the mapping must correspond to the value of a `org.prx.spire.publish.s3` label included in a Docker image that was produced during the build.

Multiple Parameter Store parameters can be updated for a single ZIP file if necessary, by separating the parameter names with commas:

    PRX_SPIRE_S3_PKG_PARAMETERS: MY_APP=/path/one,/path/two

Metadata for multiple ZIP files can be updated if necessary, by separating mappings with a semicolon:

    PRX_SPIRE_S3_PKG_PARAMETERS: MY_APP=/path/one,/path/two;MY_DB=/path/three

This will result in any included Parameter Store parameters having their values updated to the object key of the ZIP file that was pushed to S3 (e.g., `GitHub/PRX/my-app/a1b2c3.zip`).

The name of the Parameter Store parameters included in these mappings must strictly adhere to the [naming conventions](https://github.com/PRX/internal/wiki/WIP:-Parameter-Store).

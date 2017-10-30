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
Naming the stack "CI" would make a lot of sense.

## DNS

For now CloudFormation doesn't allow for the setup of custom domain names on
API Gateway deployments. It's probably a good idea to set one up manually after
the stack launches, so URL's provided to services like the GitHub webhook are a
little easier to control. The stack will create a certificate through ACM that
you can use for that.

## Bootstrapping a CodeBuild

The `bootstrap.sh` script can run tests and push-to-ECR any PRX app, using AWS
CodeBuild.

Just set up an entrypoint in CodeBuild that will:

```
curl -sO https://raw.githubusercontent.com/PRX/Infrastructure/master/codebuild/bootstrap.sh && sh bootstrap.sh
```

### Inputs

Within the CodeBuild build environment, environment variables will originate from several places.

#### CloudFormation CodeBuild Project Definition

These are defined on the project resource definition, and could be overridden by the buildspec or build start API call

- `PRX_SNS_CALLBACK`
- `PRX_AWS_ACCOUNT_ID`

#### CodeBuild buildStart API Call

- `PRX_REPO`
- `PRX_COMMIT`
- `PRX_CI_TEST`
- `PRX_CI_PUBLISH`
- `PRX_GITHUB_PR`

#### Repository buildspec.yml

- Codebuild ENVs:
  - `PRX_SNS_CALLBACK` - an SNS topic for callbacks.
  - `PRX_REPO` - the repo this is for.  Not actually used in this script, but passed back to SNS.
  - `PRX_COMMIT` - the 7-char SHA of the commit this is for. Not used, but passed back to SNS.
  - `PRX_GITHUB_PR` - optional github pull request number.
  - `PRX_ECR_TAG` - optional param telling codebuild to push to this ECR tag after successfully testing. Will only be used if there is a Dockerfile present.
  - `PRX_ECR_REGION` - required if you set `PRX_ECR_TAG`
- Repo setup:
  - Must have a `.prxci` file in the root.  This is just a plain text file, with 1 command to run per line.  Does any setup for the tests, and runs them.
  - For docker projects, the Dockerfile must have `LABEL org.prx.app="yes"` in it.  This tells codebuild which image to push to ECR (in case your docker-compose is building multiple).

### SNS Callback

- Will publish an SNS json object with the following keys:
  - `success` - boolean true or false, indicating if `.prxci` passed, and optionally if pushing to ECR worked.
  - `reason` - string message if success = false.
  - `prxRepo` - the repo you passed in.
  - `prxCommit` - the commit you passed in.
  - `prxGithubPr` - the pull request number you passed in.
  - `prxEcrTag` - the ecr tag you passed in.
  - `prxEcrRegion` - the ecr region you passed in.
  - `buildArn` - the ARN of this codebuild run.

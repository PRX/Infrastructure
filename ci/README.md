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

Most of the setup is done by launching a stack using the CloudFormation
template. The only prerequisite is that code for the Lambda functions has been
copied to S3. There's a basic deploy script that will do that for you.

When launching the stack, you will need to provide a GitHub access token, the
secret that was set for the GitHub webhook, and the name of the S3 bucket where
the Lambda function code can be found.

For now the expectation is that this stack will only be launched once, and the
GitHub webhook will be setup at the organization level, for all repositories.
Naming the stack "CI" would make a lot of sense.

## DNS

For now CloudFormation doesn't allow for the setup of custom domain names on
API Gateway deployments. It's probably a good idea to set one up manually after
the stack launches, so URL's provided to services like the GitHub webhook are a
little easier to control. The stack will create a certificate through ACM that
you can use for that.

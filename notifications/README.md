WIP

# Notifications

A CloudFormation stack for helping deal with notifications across the infrastructure. The notifications stack serves as a central hub for inbound data (eg. CloudWatch Alarm alerts) and outbound data (eg. message payloads being sent to Slack).

## Inputs

Data is sent to the notifications stack from a variety of sources. Currently the following sources are handing explicitly:

- Stack changes, produced by CloudFormation
- CI build status, produced by CodeBuild
- Deploy pipeline status, produced by custom (Lambda) actions as part of a CodePipeline pipeline
- Alarm changes, produced by CloudWatch Alarms

Data from other sources is generally passed along to a default output location.

## Outputs

Notification messages are sent to Slack. The **Slack Message Relay** SNS topic and Lambda function are responsible for sending most message data to Slack's API via webhooks.

Some message must be sent by a Slack app, in order to enable things like interactive buttons.

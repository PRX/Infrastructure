# This is a work-in-progress and not currently in use

import boto3
import json
import os

sns = boto3.client('sns')


def action_failure_or_canceled():
    # sns.publish(
    #     TopicArn=os.environ['SLACK_MESSAGE_RELAY_TOPIC_ARN'],
    #     Message=json.dumps(slack_message(action_state))
    # )


def lambda_handler(event, context):
    # Only expects events from CodePipeline
    if event['source'] != 'aws.codepipeline':
        return

    if event['detail-type'] == 'CodePipeline Pipeline Execution State Change':
        # https://console.aws.amazon.com/events/home?region=us-east-1#/registries/aws.events/schemas/aws.codepipeline%40CodePipelinePipelineExecutionStateChange/version/1
        pass
    elif event['detail-type'] == 'CodePipeline Stage Execution State Change':
        # https://console.aws.amazon.com/events/home?region=us-east-1#/registries/aws.events/schemas/aws.codepipeline%40CodePipelineStageExecutionStateChange/version/1
        pass
    elif event['detail-type'] == 'CodePipeline Action Execution State Change':
        # https://console.aws.amazon.com/events/home?region=us-east-1#/registries/aws.events/schemas/aws.codepipeline%40CodePipelineActionExecutionStateChange/version/1
        if event['detail']['state'] == 'FAILED' or event['detail']['state'] == 'CANCELED':
            action_failure_or_canceled(event)

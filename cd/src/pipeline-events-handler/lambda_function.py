import boto3
import json
import os

code_pipeline = boto3.client("codepipeline")
sns = boto3.client("sns")

SLACK_CHANNEL = "#ops-deploys"
SLACK_USERNAME = "AWS CodePipeline"
SLACK_ICON_EMOJI = ":ops-codepipeline:"


def action_canceled(event):
    # TODO
    pass


def action_failed(event):
    action_executions = code_pipeline.list_action_executions(
        pipelineName=event["detail"]["pipeline"],
        filter={"pipelineExecutionId": event["detail"]["execution-id"]},
    )

    action_execution_details = action_executions["actionExecutionDetails"]

    def attachment(action_detail):
        stage_name = action_detail["stageName"]
        action_name = action_detail["actionName"]
        summary = action_detail["output"]["executionResult"]["externalExecutionSummary"]

        return {
            "color": "danger",
            "mrkdwn_in": ["text"],
            "text": (
                f"Stage: *{stage_name}* – "
                f"Action: *{action_name}*\n>Reason: {summary}"
            ),
        }

    failed_actions = filter(
        lambda d: d["status"] == "Failed"
        and d["stageName"] == event["detail"]["stage"]
        and d["actionName"] == event["detail"]["action"],
        action_execution_details,
    )
    attachments = list(map(attachment, failed_actions))

    message = {
        "channel": SLACK_CHANNEL,
        "username": SLACK_USERNAME,
        "icon_emoji": SLACK_ICON_EMOJI,
        "text": "A CD pipeline execution didn't complete. The following action failed:",
        "attachments": attachments,
    }

    sns.publish(
        TopicArn=os.environ["SLACK_MESSAGE_RELAY_TOPIC_ARN"],
        Message=json.dumps(message),
    )


def lambda_handler(event, context):
    print(json.dumps(event))

    # Only expects events from CodePipeline
    if event["source"] != "aws.codepipeline":
        return

    if event["detail-type"] == "CodePipeline Pipeline Execution State Change":
        # https://console.aws.amazon.com/events/home?region=us-east-1#/registries/aws.events/schemas/aws.codepipeline%40CodePipelinePipelineExecutionStateChange/version/1
        pass
    elif event["detail-type"] == "CodePipeline Stage Execution State Change":
        # https://console.aws.amazon.com/events/home?region=us-east-1#/registries/aws.events/schemas/aws.codepipeline%40CodePipelineStageExecutionStateChange/version/1
        pass
    elif event["detail-type"] == "CodePipeline Action Execution State Change":
        # https://console.aws.amazon.com/events/home?region=us-east-1#/registries/aws.events/schemas/aws.codepipeline%40CodePipelineActionExecutionStateChange/version/1
        if event["detail"]["state"] == "FAILED":
            action_failed(event)
        elif event["detail"]["state"] == "CANCELED":
            action_canceled(event)

# Invoked by: CloudWatch Events
# Returns: Error or status message
#
# Triggered periodically to check if the CD CodePipeline has failed, and
# publishes a notification

import boto3
import traceback
import json
import os
from datetime import datetime, timedelta

code_pipeline = boto3.client('codepipeline')
sns = boto3.client('sns')


class DateTimeEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, datetime):
            return o.isoformat()

        return json.JSONEncoder.default(self, o)


def slack_message(action_state):
    action_name = action_state['actionName']
    url = action_state['latestExecution']['externalExecutionUrl']
    error_code = action_state['latestExecution']['errorDetails']['code']
    error_message = action_state['latestExecution']['errorDetails']['message']
    # timestamp = action_state['latestExecution']['lastStatusChange']

    return {
        'color': 'danger',
        'mrkdwn_in': ['text'],
        'fallback': f"Deploy pipeline failed on {action_name}",
        'title': f"Deploy pipeline failed on {action_name}",
        'title_link': url,
        'text': f"> {error_code} – {error_message}"
        # TODO ts: (Date.parse(timestamp) / 1000 | 0),
    }


# Builds a fully-formed Slack message and publishes it to the Slack Message
# Relay topic to get forwarded to Slack
def publish_slack_message(action_state):
    print('...Publishing message...')
    sns.publish(
        TopicArn=os.environ['SLACK_MESSAGE_RELAY_TOPIC_ARN'],
        Message=json.dumps(slack_message(action_state))
    )


# def post_notification(action_state):
#     topic_arn = os.environ['CODEPIPELINE_FAILURES_TOPIC_ARN']
#     message = json.dumps(action_state, cls=DateTimeEncoder)

#     sns.publish(TopicArn=topic_arn, Message=message)


def lambda_handler(event, context):
    try:
        print('Checking pipeline state...')

        pipeline_name = os.environ['PIPELINE_NAME']

        # Get the state history of the pipeline
        pipeline_state = code_pipeline.get_pipeline_state(name=pipeline_name)
        print('...Got pipeline state...')

        # Look through the history and see if there have been any changes in
        # the last 60 seconds (ie since the last time the function executed).
        # If there are and that change was a failure, send a message.
        for stage_state in pipeline_state['stageStates']:
            for action_state in stage_state['actionStates']:
                if 'latestExecution' in action_state:
                    print('...Checking latest execution...')
                    execution = action_state['latestExecution']

                    tz = execution['lastStatusChange'].tzinfo
                    period_start = datetime.now(tz) - timedelta(seconds=60)

                    if execution['lastStatusChange'] > period_start:
                        print('...Found recent execution...')

                        if execution['status'] == 'Failed':
                            print('...Found recent failure...')
                            publish_slack_message(action_state)

        return '...Done'

    except Exception as e:
        print('Function failed due to exception.')
        print(e)
        traceback.print_exc()

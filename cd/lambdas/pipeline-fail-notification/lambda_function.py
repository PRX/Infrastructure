# Invoked by: CloudWatch Events
# Returns: Error or status message
#
# Triggered periodically to check if the CD CodePipeline has failed, and
# publishes a notification.
#
# This is not an action within the CD pipeline.

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

    if action_name == 'ApproveChangeSet':
        url = ''
        error_code = 'Rejected'
        error_message = action_state['latestExecution']['summary']
    else:
        url = action_state['latestExecution']['externalExecutionUrl']

        error_details = action_state['latestExecution']['errorDetails']
        error_code = error_details['code']
        error_message = error_details['message']

    # timestamp = action_state['latestExecution']['lastStatusChange']

    return {
        'channel': '#ops-deploys',
        'username': 'AWS CodePipeline',
        'icon_emoji': ':ops-codepipeline:',
        'attachments': [
            {
                'color': 'danger',
                'mrkdwn_in': ['text'],
                'fallback': f"Deploy pipeline failed on {action_name}",
                'title': f"Deploy pipeline failed on {action_name}",
                'title_link': url,
                'text': f"> {error_code} – {error_message}"
                # TODO ts: (Date.parse(timestamp) / 1000 | 0),
            }
        ]
    }


# Builds a fully-formed Slack message and publishes it to the Slack Message
# Relay topic to get forwarded to Slack
def publish_slack_message(action_state):
    print('...Publishing message...')
    sns.publish(
        TopicArn=os.environ['SLACK_MESSAGE_RELAY_TOPIC_ARN'],
        Message=json.dumps(slack_message(action_state))
    )


def lambda_handler(event, context):
    try:
        print('Checking pipeline state...')

        pipeline_name = os.environ['PIPELINE_NAME']

        # Get the state history of the pipeline
        pipeline_state = code_pipeline.get_pipeline_state(name=pipeline_name)

        # Look through the history and see if there have been any changes in
        # the last 60 seconds (ie since the last time the function executed).
        # If there are and that change was a failure, send a message.
        for stage_state in pipeline_state['stageStates']:
            for action_state in stage_state['actionStates']:
                if 'latestExecution' in action_state:
                    execution = action_state['latestExecution']

                    tz = execution['lastStatusChange'].tzinfo
                    period_start = datetime.now(tz) - timedelta(seconds=60)

                    if execution['lastStatusChange'] > period_start:
                        if execution['status'] == 'Failed':
                            print('...Found recent failure...')
                            publish_slack_message(action_state)

        return '...Done'

    except Exception as e:
        print('Function failed due to exception.')
        print(e)
        traceback.print_exc()

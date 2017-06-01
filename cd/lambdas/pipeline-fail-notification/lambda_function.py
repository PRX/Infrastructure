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

def post_notification(action_state):
    topic_arn = os.environ['CODEPIPELINE_FAILURES_TOPIC_ARN']
    message = json.dumps(action_state, cls=DateTimeEncoder)

    sns.publish(TopicArn=topic_arn, Message=message)

def lambda_handler(event, context):
    try:
        print('Checking pipeline state...')

        pipeline_name = os.environ['PIPELINE_NAME']

        pipeline_state = code_pipeline.get_pipeline_state(name=pipeline_name)

        for stage_state in pipeline_state['stageStates']:
            for action_state in stage_state['actionStates']:
                if 'latestExecution' in action_state:
                    execution = action_state['latestExecution']

                    timezone = execution['lastStatusChange'].tzinfo
                    period_start = datetime.now(timezone) - timedelta(seconds=60)

                    if execution['lastStatusChange'] > period_start:
                        if execution['status'] == 'Failed':
                            post_notification(action_state)

        return '...Done'

    except Exception as e:
        print('Function failed due to exception.')
        print(e)
        traceback.print_exc()

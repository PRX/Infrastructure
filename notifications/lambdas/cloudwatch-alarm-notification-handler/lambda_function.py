# Invoked by: SNS Subscription
# Returns: Error or status message
#
# Triggered by messages sent to various SNS topics resulting from CloudWatch
# Alarms being triggered or changing states.

import boto3
import os
import json
from dateutil.parser import parse
import datetime

sns = boto3.client('sns')
cloudwatch = boto3.client('cloudwatch')

SLACK_ICON = ':ops-cloudwatch-alarm:'
SLACK_USERNAME = 'Amazon CloudWatch Alarms'


def channel_for_topic(sns_topic_arn):
    if 'OpsFatal' in sns_topic_arn:
        return '#ops-fatal'
    elif 'OpsError' in sns_topic_arn:
        return '#ops-error'
    elif 'OpsWarn' in sns_topic_arn:
        return '#ops-warn'
    elif 'OpsInfo' in sns_topic_arn:
        return '#ops-info'
    else:
        return '#ops-debug'


def color_for_alarm(alarm):
    if alarm['NewStateValue'] == 'ALARM':
        return '#cc0000'
    elif alarm['NewStateValue'] == 'OK':
        return '#019933'
    else:
        return '#e07701'

    return {
        ''
    }[alarm['NewStateValue']]


def alarm_slack_attachment(alarm):
    trigger = alarm['Trigger']

    alarm_history = cloudwatch.describe_alarm_history(
        AlarmName=alarm['AlarmName'],
        HistoryItemType='StateUpdate',
        StartDate=datetime.datetime.now() - datetime.timedelta(hours=24),
        EndDate=datetime.datetime.now(),
    )

    items = alarm_history['AlarmHistoryItems']
    alarms = filter(lambda x: ('to ALARM' in x['HistorySummary']), items)

    return {
        'color': color_for_alarm(alarm),
        'fallback': f"{alarm['NewStateValue']} – {alarm['AlarmName']}",
        'title': f"{alarm['NewStateValue']} – {alarm['AlarmName']}",
        'text': f"{trigger['MetricName']}: {alarm['NewStateReason']}",
        'footer': f"{trigger['Namespace']} – {alarm['Region']}",
        'ts': round(parse(alarm['StateChangeTime']).timestamp()),
        'fields': [
            {
                'title': 'Evaluation',
                'value': f"{trigger['Statistic']} – {trigger['EvaluationPeriods']} × {trigger['Period']}",
                'short': True,
            }, {
                'title': 'Threshold',
                'value': trigger['Threshold'],
                'short': True,
            }, {
                'title': 'Last 24 Hours',
                'value': f"{len(list(alarms))} alarms",
                'short': True,
            }
        ]
    }


def ok_slack_attachment(alarm):
    return {
        'color': color_for_alarm(alarm),
        'fallback': f"{alarm['NewStateValue']} – {alarm['AlarmName']}",
        'title': f"{alarm['NewStateValue']} – {alarm['AlarmName']}",
        'footer': f"{alarm['Trigger']['Namespace']} – {alarm['Region']}",
        'ts': round(parse(alarm['StateChangeTime']).timestamp())
    }


def slack_message(sns_payload):
    alarm = json.loads(sns_payload['Message'])

    if alarm['NewStateValue'] == 'OK':
        attachment = ok_slack_attachment(alarm)
    else:
        attachment = alarm_slack_attachment(alarm)

    return {
        'channel': channel_for_topic(sns_payload['TopicArn']),
        'username': SLACK_USERNAME,
        'icon_emoji': SLACK_ICON,
        'attachments': [attachment]
    }


def lambda_handler(event, context):
    sns_payload = event['Records'][0]['Sns']

    # TODO This isn't necessary once all stacks stop using the log-level SNS
    # topics for deployment notifications
    if sns_payload['Subject'] == 'AWS CloudFormation Notification':
        return

    sns.publish(
        TopicArn=os.environ['SLACK_MESSAGE_RELAY_TOPIC_ARN'],
        Message=json.dumps(slack_message(sns_payload))
    )

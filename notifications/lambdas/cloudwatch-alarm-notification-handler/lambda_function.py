# Invoked by: SNS Subscription
# Returns: Error or status message
#
# Triggered by messages sent to various SNS topics resulting from CloudWatch
# Alarms being triggered or changing states.

import boto3
import os
import json
import urllib.parse
from dateutil.parser import parse
import datetime
import re

sns = boto3.client('sns')
sts = boto3.client('sts')
cloudwatch = boto3.client('cloudwatch')

SLACK_ICON = ':ops-cloudwatch-alarm:'
SLACK_USERNAME = 'Amazon CloudWatch Alarms'


# Return a boto3 CloudWatch client with credentials for the account where the
# alarm originated
def cloudwatch_client(alarm):
    account_id = alarm['AWSAccountId']
    role_name = os.environ['CROSS_ACCOUNT_CLOUDWATCH_ALARM_IAM_ROLE_NAME']

    role = sts.assume_role(
        RoleArn=f"arn:aws:iam::{account_id}:role/{role_name}",
        RoleSessionName='notifications_lambda_reader',
    )

    return boto3.client(
        'cloudwatch',
        aws_access_key_id=role['Credentials']['AccessKeyId'],
        aws_secret_access_key=role['Credentials']['SecretAccessKey'],
        aws_session_token=role['Credentials']['SessionToken'],
    )


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


def alarm_slack_attachment(alarm):
    # Extract datapoint values from the SNS alarm data
    # eg, "Threshold Crossed: 1 datapoint [10.0 (05/09/18 12:15:00)] was
    # greater than or equal to the threshold (10.0)."
    datapoints = re.findall(r'([0-9]+\.[0-9]+) ', alarm['NewStateReason'])
    datapoints_list = '`\n`'.join(datapoints)

    trigger = alarm['Trigger']

    cw = cloudwatch_client(alarm)

    # Get the complete alarm info for this alarm (Only partial data may have
    # been included in the SNS message)
    alarm_infos = cw.describe_alarms(AlarmNames=[alarm['AlarmName']])

    # TODO There shouldn't be any cases where this is happening anymore, since
    # alarm data is being queried using a privileged role in all cases now
    if not alarm_infos['MetricAlarms']:
        # Usually this list will be empty because the alarm is in a different
        # account. Use a simplified message in those cases.
        return {
            'color': color_for_alarm(alarm),
            'fallback': f"{alarm['NewStateValue']} – {alarm['AlarmName']}",
            'title': f"{alarm['NewStateValue']} – {alarm['AlarmName']}",
            'text': f"{alarm['AlarmDescription']}",
            'ts': round(parse(alarm['StateChangeTime']).timestamp()),
            'fields': [
                {
                    'title': 'Datapoints',
                    'value': f"`{datapoints_list}`",
                    'short': False,
                }
            ]
        }

    alarm_info = alarm_infos['MetricAlarms'][0]

    alarm_region = alarm_info['AlarmArn'].split(':', 4)[3]

    # If the alarm doesn't have DatapointsToAlarm defined, force it equal to
    # the EvaluationPeriods
    if 'DatapointsToAlarm' not in alarm_info:
        alarm_info['DatapointsToAlarm'] = alarm_info['EvaluationPeriods']

    # Get a count of how many times this alarm has alarmed in the last 24 hours
    now = datetime.datetime.now(datetime.timezone.utc)
    alarm_history = cw.describe_alarm_history(
        AlarmName=alarm['AlarmName'],
        HistoryItemType='StateUpdate',
        StartDate=now - datetime.timedelta(hours=24),
        EndDate=now,
        MaxRecords=100,
    )
    if 'AlarmHistoryItems' in alarm_history:
        items = alarm_history['AlarmHistoryItems']
        alarms = filter(lambda x: ('to ALARM' in x['HistorySummary']), items)
        alarms_count = len(list(alarms))
    else:
        alarms_count = 0

    # Construct a URL for this alarm in the Console
    cw_console_url = 'https://console.aws.amazon.com/cloudwatch/home'
    alarm_name_escaped = urllib.parse.quote(alarm['AlarmName'])
    alarm_console_url = f"{cw_console_url}?region={alarm_region}#alarm:alarmFilter=ANY;name={alarm_name_escaped}"

    cw_logs = 'n/a'

    # All periods are 10, 30, or a multiple of 60
    # Each datapoint is the aggregate (SUM, AVERAGE, etc) of one period
    if trigger['Period'] >= 60:
        each_datapoint = f"{round(trigger['Period'] / 60)} minute"
    else:
        each_datapoint = f"{trigger['Period']} second"

    # ExtendedStatistic is used for percentile statistics.
    # ExtendedStatistic and Statistic are mutually exclusive.
    if 'ExtendedStatistic' in trigger:
        stat = trigger['ExtendedStatistic']
    elif 'Statistic' in trigger:
        stat = trigger['Statistic']
    elif 'Metrics' in trigger:
        stat = 'metric math'
    else:
        stat = 'unknown'

    if 'MetricName' in trigger:
        metric_name = trigger['MetricName']
    else:
        metric_name = 'expression'

    # eg "5 minute TargetResponseTime average"
    threshold_left = f"{each_datapoint} `{metric_name}` {stat.lower()}"

    trigger_period = trigger['Period'] * trigger['EvaluationPeriods']
    trigger_period_label = "seconds"

    if trigger_period >= 60:
        trigger_period = round(trigger_period / 60)
        trigger_period_label = "minutes"

    if trigger['EvaluationPeriods'] == 1:
        # Entire threshold breach was a single period/datapoint
        threshold_right = ""
    elif alarm_info['DatapointsToAlarm'] == alarm_info['EvaluationPeriods']:
        # Threshold breach was multiple, consecutive periods
        threshold_right = f"for {trigger_period} consecutive {trigger_period_label}"
    else:
        # Threshold breach was "M of N" periods
        threshold_right = f"at least {alarm_info['DatapointsToAlarm']} times in {trigger_period} {trigger_period_label}"

    if trigger['ComparisonOperator'] == 'GreaterThanOrEqualToThreshold':
        comparison = '≥'
    elif trigger['ComparisonOperator'] == 'GreaterThanThreshold':
        comparison = '>'
    elif trigger['ComparisonOperator'] == 'LessThanThreshold':
        comparison = '<'
    elif trigger['ComparisonOperator'] == 'LessThanOrEqualToThreshold':
        comparison = '≤'

    threshold = f"{threshold_left} *{comparison}* `{trigger['Threshold']}` {threshold_right}"

    # Log URL handling
    # eg, alarm['StateChangeTime'] = 2019-08-03T01:46:44.418+0000
    state_change_time = parse(alarm['StateChangeTime'])
    log_end = state_change_time.strftime("%Y-%m-%dT%H:%M:%S")

    log_period = trigger['Period'] * trigger['EvaluationPeriods']

    log_start_time = state_change_time - datetime.timedelta(seconds=log_period)
    log_start = log_start_time.strftime("%Y-%m-%dT%H:%M:%S")

    namespace = 'Math/Multiple'
    if 'Namespace' in trigger:
        namespace = trigger['Namespace']

        if trigger['Namespace'] == 'AWS/Lambda':
            # Find the function name
            for dimension in trigger['Dimensions']:
                if dimension['name'] == 'FunctionName':
                    function_name = dimension['value']

            cw_logs = f"<https://console.aws.amazon.com/cloudwatch/home?region={alarm_region}#logEventViewer:group=/aws/lambda/{function_name};start={log_start}Z;end={log_end}Z|CloudWatch Logs>"

    return {
        'color': color_for_alarm(alarm),
        'fallback': f"{alarm['NewStateValue']} – {alarm['AlarmName']}",
        'title_link': alarm_console_url,
        'title': f"{alarm['NewStateValue']} – {alarm['AlarmName']}",
        'text': f"{alarm['AlarmDescription']}",
        'footer': f"{namespace} – {alarm['Region']}",
        'ts': round(parse(alarm['StateChangeTime']).timestamp()),
        'fields': [
            {
                'title': 'Last 24 Hours',
                'value': f"{alarms_count} alarms",
                'short': True,
            },
            {
                'title': 'Logs',
                'value': cw_logs,
                'short': True,
            },
            {
                'title': 'Threshold breach',
                'value': threshold,
                'short': False,
            },
            {
                'title': 'Datapoints',
                'value': f"`{datapoints_list}`",
                'short': False,
            }
        ]
    }


def ok_slack_attachment(alarm):
    cw = cloudwatch_client(alarm)

    # Get the complete alarm info for this alarm (Only partial data may have
    # been included in the SNS message)
    alarm_infos = cw.describe_alarms(AlarmNames=[alarm['AlarmName']])

    if not alarm_infos['MetricAlarms']:
        return {
            'color': color_for_alarm(alarm),
            'fallback': f"{alarm['NewStateValue']} – {alarm['AlarmName']}",
            'title': f"{alarm['NewStateValue']} – {alarm['AlarmName']}",
            'ts': round(parse(alarm['StateChangeTime']).timestamp())
        }

    alarm_info = alarm_infos['MetricAlarms'][0]

    alarm_region = alarm_info['AlarmArn'].split(':', 4)[3]

    # Calculate the duration of the previous alarm state. The previous
    # state may not exist or may not be an alarm, so this needs to fail
    # gracefully
    duration = 'Unavailable'
    try:
        # Retrieve the alarm history (only state updates)
        now = datetime.datetime.now(datetime.timezone.utc)
        alarm_history = cw.describe_alarm_history(
            AlarmName=alarm['AlarmName'],
            HistoryItemType='StateUpdate',
            StartDate=now - datetime.timedelta(hours=24),
            EndDate=now,
        )
        items = alarm_history['AlarmHistoryItems']

        # Since a state change triggered this, this should always be > 0
        if len(items) > 0:
            # The NewStateValue of the alarm was OK, so the most recent history
            # item should be an OK state (the inciting OK state, in fact)
            ok_item = items[0]

            # See history_data.json
            history_data = json.loads(ok_item['HistoryData'])

            if history_data['oldState']['stateValue'] == 'ALARM':
                alarm_time = history_data['oldState']['stateReasonData']['startDate']
                alarm_time = parse(alarm_time)

                ok_time = ok_item['Timestamp']

                dif = ok_time - alarm_time
                duration = f"{round(dif.total_seconds() / 60)} min."
    except Exception:
        pass

    cw_console_url = 'https://console.aws.amazon.com/cloudwatch/home'
    alarm_name_escaped = urllib.parse.quote(alarm['AlarmName'])
    alarm_console_url = f"{cw_console_url}?region={alarm_region}#alarm:alarmFilter=ANY;name={alarm_name_escaped}"

    namespace = 'Math/Multiple'
    if 'Namespace' in alarm['Trigger']:
        namespace = alarm['Trigger']['Namespace']

    return {
        'color': color_for_alarm(alarm),
        'fallback': f"{alarm['NewStateValue']} – {alarm['AlarmName']}",
        'title': f"{alarm['NewStateValue']} – {alarm['AlarmName']}",
        'title_link': alarm_console_url,
        'text': f"Alarm duration: {duration}",
        'footer': f"{namespace} – {alarm['Region']}",
        'ts': round(parse(alarm['StateChangeTime']).timestamp())
    }


def slack_message(sns_payload):
    alarm = json.loads(sns_payload['Message'])

    if alarm['NewStateValue'] == 'OK':
        attachment = ok_slack_attachment(alarm)
    else:
        attachment = alarm_slack_attachment(alarm)

    print(json.dumps({
        'NewStateValue': alarm['NewStateValue'],
        'TopicArn': sns_payload['TopicArn']
    }))

    return {
        'channel': channel_for_topic(sns_payload['TopicArn']),
        'username': SLACK_USERNAME,
        'icon_emoji': SLACK_ICON,
        'attachments': [attachment]
    }


def lambda_handler(event, context):
    try:
        sns_payload = event['Records'][0]['Sns']

        sns.publish(
            TopicArn=os.environ['SLACK_MESSAGE_RELAY_TOPIC_ARN'],
            Message=json.dumps(slack_message(sns_payload))
        )
    except Exception as e:
        print(e)
        sns.publish(
            TopicArn=os.environ['SLACK_MESSAGE_RELAY_TOPIC_ARN'],
            Message=json.dumps({
                'channel': '#ops-warn',
                'username': SLACK_USERNAME,
                'icon_emoji': SLACK_ICON,
                'text': f"The following CloudWatch Alarm notification was not handled successfully:\n\n {json.dumps(event)}\n\n{e}"
            })
        )

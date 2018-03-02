# Invoked by: CodePipeline
# Returns: Error or status message
#
# Published messages about deltas between a CloudFormation stack change set and
# the current version of the stack. The stack parameter values for both the
# stack and change set are queried, compared, and the differences are sent as a
# message to the Slack relay.
#
# This should always callback to the CodePipeline API to indicate success or
# failure.

import boto3
import traceback
import json
import re
import os

code_pipeline = boto3.client('codepipeline')
cloudformation = boto3.client('cloudformation')
sns = boto3.client('sns')


def put_job_success(job, message):
    print('Putting job success')
    print(message)
    code_pipeline.put_job_success_result(jobId=job['id'])


def put_job_failure(job, message):
    print('Putting job failure')
    print(message)
    code_pipeline.put_job_failure_result(
        jobId=job['id'],
        failureDetails={'message': message, 'type': 'JobFailed'})


def parameters_delta_attachment(user_parameters):
    stack_name = user_parameters['StackName']
    change_set_name = user_parameters['ChangeSetName']

    # Get current stack parameter values
    stack = cloudformation.describe_stacks(StackName=stack_name)['Stacks'][0]
    stack_parameters = stack['Parameters']

    # Get new parameter values from change set
    change_set = cloudformation.describe_change_set(
        ChangeSetName=change_set_name,
        StackName=stack_name
    )
    change_set_parameters = change_set['Parameters']

    # Combine parameters from stack and change set
    parameters = {}

    for p in stack_parameters:
        if not p['ParameterKey'] in parameters:
            parameters[p['ParameterKey']] = {}

        parameters[p['ParameterKey']]['StackValue'] = p['ParameterValue']

    for p in change_set_parameters:
        if not p['ParameterKey'] in parameters:
            parameters[p['ParameterKey']] = {}

        parameters[p['ParameterKey']]['ChangeSetValue'] = p['ParameterValue']

    # Find values that have changed, and build strings that will be included in
    # the Slack message describing the changes
    deltas = []

    for k, v in parameters.items():
        if k == 'PipelineExecutionNonce':
            continue

        elif 'StackValue' not in v:
            deltas.append(f"*{k}*: ❔ ➡ `{v['ChangeSetValue']}`")

        elif 'ChangeSetValue' not in v:
            deltas.append(f"*{k}*: `{v['StackValue']}` ➡ ❌")

        elif v['StackValue'] != v['ChangeSetValue']:
            before = v['StackValue']
            after = v['ChangeSetValue']

            if re.search(r'EcrImageTag', k) or re.search(r'GitCommit', k):
                base = 'https://github.com/PRX'
                slug = k.replace('EcrImageTag', '').replace('GitCommit', '')
                repo = f'{slug}.prx.org'.replace('Infrastructure.prx.org', 'Infrastructure')
                url = f'{base}/{repo}/compare/{before}...{after}'
                deltas.append(f"*{k}*: `{before}` ➡ `<{url}|{after}>`")
            else:
                deltas.append(f"*{k}*: `{before}` ➡ `{after}`")

    unchanged_count = len(parameters) - len(deltas)

    return {
        'title': 'Stack Parameters Delta',
        'footer': f'Excludes {unchanged_count} unchanged parameters',
        'mrkdwn_in': ['text'],
        'text': '\n'.join(deltas)
    }


def slack_message(notification):
    return {
        'channel': '#ops-deploys',
        'username': 'AWS CodePipeline',
        'icon_emoji': ':ops-codepipeline:',
        'attachments': [
            parameters_delta_attachment(notification)
        ]
    }


def sns_message(notification):
    return json.dumps(slack_message(notification))


def lambda_handler(event, context):
    try:
        print('Posting delta notification...')

        job = event['CodePipeline.job']

        cfg = job['data']['actionConfiguration']['configuration']
        user_parameters = json.loads(cfg['UserParameters'])

        sns.publish(
            TopicArn=os.environ['SLACK_MESSAGE_RELAY_TOPIC_ARN'],
            Message=sns_message(user_parameters)
        )

        # Cleanup
        put_job_success(job, '')

        return '...Done'

    except Exception as e:
        print('Function failed due to exception.')
        print(e)
        traceback.print_exc()
        put_job_failure(job, 'Function exception: ' + str(e))

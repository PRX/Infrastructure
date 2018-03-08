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


def parameters_delta_attachment(user_parameters, deploy_id):
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
    deltas = [f"*`{deploy_id}` {user_parameters['Stage']} Stack Parameters Delta*"]

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

    unchanged_count = len(parameters) - len(deltas) + 1

    return {
        'footer': f'Excludes {unchanged_count} unchanged parameters',
        'color': '#a0d0d4',
        'mrkdwn_in': ['text'],
        'text': '\n'.join(deltas)
    }


def slack_message(notification, deploy_id):
    return {
        'channel': '#ops-deploys',
        'username': 'AWS CodePipeline',
        'icon_emoji': ':ops-codepipeline:',
        'attachments': [
            parameters_delta_attachment(notification, deploy_id)
        ]
    }


def sns_message(notification, deploy_id):
    return json.dumps(slack_message(notification, deploy_id))


def deploy_id(artifacts):
    repo_artifact = next((a for a in artifacts if a['name'] == 'InfrastructureRepoSourceArtifact'), None)
    staging_config_artifact = next((a for a in artifacts if a['name'] == 'TemplateConfigStagingZipArtifact'), None)

    repo_id = repo_artifact['revision'][0:3]
    stag_config_id = staging_config_artifact['revision'][0:3]

    return f"{repo_id}-{stag_config_id}"


def lambda_handler(event, context):
    try:
        print('Posting delta notification...')

        job = event['CodePipeline.job']
        input_artifacts = job['data']['inputArtifacts']

        cfg = job['data']['actionConfiguration']['configuration']
        user_parameters = json.loads(cfg['UserParameters'])

        sns.publish(
            TopicArn=os.environ['SLACK_MESSAGE_RELAY_TOPIC_ARN'],
            Message=sns_message(user_parameters, deploy_id(input_artifacts))
        )

        # Cleanup
        put_job_success(job, '')

        return '...Done'

    except Exception as e:
        print('Function failed due to exception.')
        print(e)
        traceback.print_exc()
        put_job_failure(job, 'Function exception: ' + str(e))

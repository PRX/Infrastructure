# Invoked by: CodePipeline
# Returns: Error or status message
#
# Publishes messages about the status of deployments in CodePipeline. The
# messages are published to SNS, and generally forwarded to Slack via another
# process. Some data used in the notifications are passed in from CodePipeline,
# and others are queried.
#
# This function also sends some basic counting metrics about deployments to
# CloudWatch.

# This should always callback to the CodePipeline API to indicate success or
# failure.

import boto3
import traceback
import json
import os

code_pipeline = boto3.client('codepipeline')
sns = boto3.client('sns')
cloudwatch = boto3.client('cloudwatch')
s3 = boto3.client('s3')


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


def log_deploy_metric(env):
    if (env == 'Staging') or (env == 'Production'):
        stack_name = os.environ['CD_STACK_NAME']

        cloudwatch.put_metric_data(
            Namespace='PRX/CD',
            MetricData=[
                {
                    'MetricName': 'Deploys',
                    'Dimensions': [
                        {
                            'Name': 'Environment',
                            'Value': env
                        }, {
                            'Name': 'StackName',
                            'Value': stack_name
                        }
                    ],
                    'Value': 1,
                    'Unit': 'Count'
                },
            ]
        )


def publish_slack_message(env, input_artifact, config_version):
    commit = input_artifact['revision']
    region = os.environ['AWS_REGION']

    url = f"https://github.com/PRX/Infrastructure/commit/{commit}"

    if env == 'Start':
        attachment = {
            'mrkdwn_in': ['text'],
            # ts: (Date.now() / 1000 | 0), TODO
            'footer': region,
            'color': '#A807E8',
            'fallback': f"Starting deploy. Infrastructure revision {commit}. Config version {config_version}",
            'text': f"Starting deploy pipeline.\nInfrastructure revision <{url}|`{commit}`>\nTemplate config version `{config_version}`",
        }
    else:
        if env == 'Production':
            color = 'good'
        else:
            color = 'warning'

        attachment = {
            'mrkdwn_in': ['text'],
            # ts: (Date.now() / 1000 | 0), TODO
            'footer': region,
            'color': color,
            'fallback': f"{env} deploy complete. Infrastructure revision {commit}",
            'text': f"*{env}* deploy complete.\nInfrastructure revision <{url}|`${commit}`>\nTemplate config version `${config_version}`",
        }

    message = {
        'channel': '#ops-deploys',
        'username': 'AWS CodePipeline',
        'icon_emoji': ':ops-codepipeline:',
        'attachments': [attachment]
    }

    sns.publish(
        TopicArn=os.environ['SLACK_MESSAGE_RELAY_TOPIC_ARN'],
        Message=json.dumps(message)
    )


def lambda_handler(event, context):
    try:
        print('Posting notification...')

        job = event['CodePipeline.job']

        input_artifact = job['data']['inputArtifacts'][0]

        cfg = job['data']['actionConfiguration']['configuration']
        env = cfg['UserParameters']

        # Get the S3 version of the most recent config

        if env == 'Production':
            config_key = os.environ['INFRASTRUCTURE_CONFIG_PRODUCTION_KEY']
        else:
            config_key = os.environ['INFRASTRUCTURE_CONFIG_STAGING_KEY']

        config_head = s3.head_object(
            Bucket=os.environ['INFRASTRUCTURE_CONFIG_BUCKET'],
            Key=config_key
        )

        config_version = config_head['VersionId']

        # Publish to SNS Topic
        publish_slack_message(env, input_artifact, config_version)
        # Log a custom metric data point with CloudWatch
        log_deploy_metric(env)

        # Cleanup
        put_job_success(job, '')

        return '...Done'

    except Exception as e:
        print('Function failed due to exception.')
        print(e)
        traceback.print_exc()
        put_job_failure(job, 'Function exception: ' + str(e))

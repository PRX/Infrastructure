# Invoked by: SNS Subscription
# Returns: Error or status message
#
# Triggered after a CodeBuild run finishes and is responsible for updating
# the GitHub status, and sending some notifications.
#
# The SNS mesage included in the event follows this format:
# Message: A status message, generally including an error message if the
# build process failed
# MessageAttributes:
#   STATUS: "true" or "false"
#   CODEBUILD_BUILD_ARN
#   PRX_AWS_ACCOUNT_ID
#   PRX_REPO
#   PRX_COMMIT
#   PRX_GITHUB_PR: only for pull requests
#   PRX_ECR_REGION: only for Docker apps
#   PRX_ECR_REPOSITORY: only for Docker apps
#   PRX_ECR_TAG: only for Docker apps
#   PRX_LAMBDA_CODE_S3_KEY: only for Lambda apps
#   PRX_LAMBDA_CODE_S3_VERSION_ID: only for Lambda apps


import boto3
import os
import zipfile
import json
import uuid
import urllib.request
from botocore.client import Config

s3 = boto3.client('s3', config=Config(signature_version='s3v4'))
sns = boto3.client('sns')

USER_AGENT = 'PRX/Infrastructure (codebuild-callback-handler)'

SLACK_CHANNEL = '#ops-builds'
SLACK_ICON = ':ops-codebuild:'
SLACK_USERNAME = 'AWS CodeBuild'


def update_github_status2(sns_message):
    print('...Updating GitHub status...')

    message = sns_message['Message']
    attrs = sns_message['MessageAttributes']

    github_token = os.environ['GITHUB_ACCESS_TOKEN']

    headers = {}
    headers['User-Agent'] = USER_AGENT
    headers['Accept'] = 'application/vnd.github.v3+json'
    headers['Authorization'] = f"token {github_token}"

    api = 'api.github.com'
    repo = attrs['PRX_REPO']
    sha = attrs['PRX_COMMIT']

    arn = attrs['CODEBUILD_BUILD_ARN']
    region = arn.split(':')[3]
    build_id = arn.split('/')[1]
    path = 'console.aws.amazon.com/codebuild/home#/builds'
    build_url = f"https://{region}.{path}/{build_id}/view/new"

    # The GitHub state value
    state = 'success' if attrs['STATUS'] == 'true' else 'failure'

    description = 'Build complete' if attrs['STATUS'] == 'true' else message

    json_body = json.dumps({
        'state': state,
        'target_url': build_url,
        'description': description,
        'context': 'continuous-integration/prxci',
    }).encode('utf8')

    api_url = f"https://{api}/repos/{repo}/statuses/{sha}"

    print(f"...Requesting {api_url}...")
    req = urllib.request.Request(api_url, data=json_body, headers=headers)
    urllib.request.urlopen(req)


def update_staging_config_status2(sns_message):
    attrs = sns_message['MessageAttributes']

    if (attrs['STATUS'] == 'true'):
        print('...Updating Staging template config...')

        # Get current staging template config

        source_bucket = os.environ['INFRASTRUCTURE_CONFIG_BUCKET']
        source_key = os.environ['INFRASTRUCTURE_CONFIG_STAGING_KEY']

        archive_path = f"/tmp/{source_key}"

        print(f"...Getting staging config: {source_bucket}/{source_key}...")

        s3.download_file(source_bucket, source_key, archive_path)

        with zipfile.ZipFile(archive_path, 'r') as archive:
            staging_config = json.load(archive.open('staging.json'))

        if attrs['PRX_ECR_TAG']:
            print('...Updating ECR image tag value...')

            # Update config with new ECR Tag for the appropriate app

            sha = attrs['PRX_COMMIT']
            ecr_tag = sha[:7]
            repo = attrs['PRX_REPO']

            short_name = repo.replace('PRX/', '').replace('.prx.org', '')
            key_name = "{0}EcrImageTag".format(short_name.capitalize())

            print(f"...Setting {key_name} to {ecr_tag}...")

            staging_config['Parameters'][key_name] = ecr_tag

        if attrs['PRX_LAMBDA_CODE_S3_VERSION_ID']:
            version_id = attrs['PRX_LAMBDA_CODE_S3_VERSION_ID']

            print('...Updating Lambda code S3 version ID value...')

            for key in attrs['PRX_LAMBDA_CONFIG_KEYS'].split(','):
                print(f"...Setting {key} to {version_id}...")


        # Zip the new config up

        new_archive_path = f"/tmp/{uuid.uuid4()}"

        body = json.dumps(staging_config)

        # TODO Should be able to do this all in memory
        archive = zipfile.ZipFile(new_archive_path, mode='w')
        archive.writestr(
            'staging.json',
            body,
            compress_type=zipfile.ZIP_DEFLATED)
        archive.close()

        # Send back to S3

        print(f"...Uploading to S3 {source_bucket}/{source_key}...")

        s3.upload_file(new_archive_path, source_bucket, source_key)


def post_notification_status2(sns_message):
    print('...Posting build status notification...')

    topic_arn = os.environ['SLACK_MESSAGE_RELAY_TOPIC_ARN']

    slack_message = json.dumps({
        'channel': SLACK_CHANNEL,
        'username': SLACK_USERNAME,
        'icon_emoji': SLACK_ICON,
        'attachments': [
            {
                'mrkdwn_in': ['text'],

            }
        ]
    })

    sns.publish(TopicArn=topic_arn, Message=slack_message)


def update_github_status(data):
    print('...Updating GitHub status...')

    github_token = os.environ['GITHUB_ACCESS_TOKEN']

    headers = {}
    headers['User-Agent'] = USER_AGENT
    headers['Accept'] = 'application/vnd.github.v3+json'
    headers['Authorization'] = "token {0}".format(github_token)

    api = 'api.github.com'
    repo = data['prxRepo']
    sha = data['prxCommit']

    arn = data['buildArn']
    region = arn.split(':')[3]
    buildId = arn.split('/')[1]
    path = 'console.aws.amazon.com/codebuild/home#/builds'
    buildUrl = "https://{0}.{1}/{2}/view/new".format(region, path, buildId)

    state = 'success' if data['success'] else 'failure'
    description = 'Build complete' if data['success'] else data['reason']

    json_body = json.dumps({
        'state': state,
        'target_url': buildUrl,
        'description': description,
        'context': 'continuous-integration/prxci',
    }).encode('utf8')

    api_url = "https://{0}/repos/{1}/statuses/{2}".format(api, repo, sha)

    print(f"...Requesting {api_url}...")
    req = urllib.request.Request(api_url, data=json_body, headers=headers)
    urllib.request.urlopen(req)


def update_staging_config_status(data):
    if (data['success']) and ('prxEcrTag' in data):

        print('...Updating Staging template config...')

        # Get current staging template config

        source_bucket = os.environ['INFRASTRUCTURE_CONFIG_BUCKET']
        source_key = os.environ['INFRASTRUCTURE_CONFIG_STAGING_KEY']

        archive_path = "/tmp/{0}".format(source_key)

        print(f"...Getting staging config: {source_bucket}/{source_key}...")

        s3.download_file(source_bucket, source_key, archive_path)

        with zipfile.ZipFile(archive_path, 'r') as archive:
            staging_config = json.load(archive.open('staging.json'))

        # Update config with new ECR Tag for the appropriate app

        sha = data['prxCommit']
        ecr_tag = sha[:7]
        repo = data['prxRepo']

        short_name = repo.replace('PRX/', '').replace('.prx.org', '')
        key_name = "{0}EcrImageTag".format(short_name.capitalize())

        print(f"...Setting {key_name} to {ecr_tag}...")

        staging_config['Parameters'][key_name] = ecr_tag

        # Zip the new config up

        new_archive_path = "/tmp/{0}".format(uuid.uuid4())

        body = json.dumps(staging_config)

        # TODO Should be able to do this all in memory
        archive = zipfile.ZipFile(new_archive_path, mode='w')
        archive.writestr(
            'staging.json',
            body,
            compress_type=zipfile.ZIP_DEFLATED)
        archive.close()

        # Send back to S3

        print(f"...Uploading to S3 {source_bucket}/{source_key}...")

        s3.upload_file(new_archive_path, source_bucket, source_key)


def post_notification_status(data):
    print('...Posting build status notification...')

    topic_arn = os.environ['CI_STATUS_TOPIC_ARN']
    message = json.dumps({'callback': data})

    sns.publish(TopicArn=topic_arn, Message=message)


def lambda_handler(event, context):
    sns_object = event['Records'][0]['Sns']

    if ('MessageAttributes' in sns_object
            and len(sns_object['MessageAttributes']) > 0):
        # New CI
        update_github_status2(sns_object)
        update_staging_config_status2(sns_object)
        post_notification_status2(sns_object)
    else:
        # Old CI
        callback_object = json.loads(event['Records'][0]['Sns']['Message'])

        update_github_status(callback_object)
        update_staging_config_status(callback_object)
        post_notification_status(callback_object)




# Invoked by: SNS Subscription
# Returns: Error or status message
#
# Triggered after a CodeBuild run finishes and is responsible for updating
# the GitHub status, and sending some notifications.

import boto3
import traceback
import os
import zlib
import zipfile
import json
import re
import uuid
import urllib.request
from botocore.client import Config

s3 = boto3.client('s3', config=Config(signature_version='s3v4'))
sns = boto3.client('sns')

USER_AGENT = 'PRX/Infrastructure (codebuild-callback-handler)'

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
    buildUrl = "https://{0}.console.aws.amazon.com/codebuild/home#/builds/{1}/view/new".format(region, buildId)

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
    if 'prxEcrTag' in data:

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
        archive.writestr('staging.json', body, compress_type=zipfile.ZIP_DEFLATED)
        archive.close()

        # Send back to S3

        print(f"...Uploading to S3 {source_bucket}/{source_key}...")

        s3.upload_file(new_archive_path, source_bucket, source_key)

def post_notification_status(data):
    print('...Posting build status notification...')

    topic_arn = os.environ['CI_STATUS_TOPIC_ARN']
    message = json.dumps({ 'callback': data })

    sns.publish(TopicArn=topic_arn, Message=message)

def lambda_handler(event, context):
    callback_object = json.loads(event['Records'][0]['Sns']['Message'])

    update_github_status(callback_object)
    update_staging_config_status(callback_object)
    post_notification_status(callback_object)

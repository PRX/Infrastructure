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
#   PRX_ECR_CONFIG_PARAMETERS: only for Docker apps
#   PRX_ECR_IMAGE: only for Docker apps
#   PRX_ECR_TAG: only for Docker apps
#   PRX_LAMBDA_CODE_S3_KEY: only for Lambda apps
#   PRX_LAMBDA_CODE_S3_VERSION_ID: only for Lambda apps
#   PRX_LAMBDA_CODE_CONFIG_PARAMETERS: only for Lambda apps
#   PRX_S3_STATIC_S3_KEY: only for S3 static sites
#   PRX_S3_STATIC_S3_VERSION_ID: only for S3 static sites
#   PRX_S3_STATIC_CONFIG_PARAMETERS: only for S3 static sites


import boto3
import os
import zipfile
import json
import uuid
import datetime
import urllib.request
from botocore.client import Config

s3 = boto3.client('s3', config=Config(signature_version='s3v4'))
sns = boto3.client('sns')
cloudwatch = boto3.client('cloudwatch')
codebuild = boto3.client('codebuild')

USER_AGENT = 'PRX/Infrastructure (codebuild-callback-handler)'

SLACK_CHANNEL = '#ops-builds'
SLACK_ICON = ':ops-codebuild:'
SLACK_USERNAME = 'AWS CodeBuild'


def update_github_status(sns_message):
    print('...Updating GitHub status...')

    message = sns_message['Message']
    attrs = sns_message['MessageAttributes']

    github_token = os.environ['GITHUB_ACCESS_TOKEN']

    headers = {}
    headers['User-Agent'] = USER_AGENT
    headers['Accept'] = 'application/vnd.github.v3+json'
    headers['Authorization'] = f"token {github_token}"

    api = 'api.github.com'
    repo = attrs['PRX_REPO']['Value']
    sha = attrs['PRX_COMMIT']['Value']

    arn = attrs['CODEBUILD_BUILD_ARN']['Value']
    region = arn.split(':')[3]
    build_id = arn.split('/')[1]
    path = 'console.aws.amazon.com/codebuild/home#/builds'
    build_url = f"https://{region}.{path}/{build_id}/view/new"

    # The GitHub state value
    status = attrs['STATUS']['Value']
    state = 'success' if status == 'true' else 'failure'
    description = 'Build complete' if status == 'true' else message

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


def update_staging_config_status(sns_message):
    attrs = sns_message['MessageAttributes']

    if (attrs['STATUS']['Value'] == 'true'):
        print('...Updating Staging template config...')

        # Keep track of if anything has changed
        config_did_change = False

        # Get current staging template config

        source_bucket = os.environ['INFRASTRUCTURE_CONFIG_BUCKET']
        source_key = os.environ['INFRASTRUCTURE_CONFIG_STAGING_KEY']

        archive_path = f"/tmp/{source_key}"

        print(f"...Getting staging config: {source_bucket}/{source_key}...")

        s3.download_file(source_bucket, source_key, archive_path)

        with zipfile.ZipFile(archive_path, 'r') as archive:
            staging_config = json.load(archive.open('staging.json'))

        if 'PRX_ECR_TAG' in attrs:
            print('...Updating ECR image tag value...')

            config_did_change = True

            # Update config with new ECR Tag

            ecr_tag = attrs['PRX_ECR_TAG']['Value']

            for key_name in attrs['PRX_ECR_CONFIG_PARAMETERS']['Value'].split(','):
                print(f"...Setting {key_name.strip()} to {ecr_tag}...")

                staging_config['Parameters'][key_name.strip()] = ecr_tag

        if 'PRX_LAMBDA_CODE_S3_VERSION_ID' in attrs:
            print('...Updating Lambda code S3 version ID value...')

            config_did_change = True

            # Update config with new S3 Version ID

            version_id = attrs['PRX_LAMBDA_CODE_S3_VERSION_ID']['Value']

            key_names = attrs['PRX_LAMBDA_CODE_CONFIG_PARAMETERS']['Value'].split(',')
            for key_name in key_names:
                print(f"...Setting {key_name.strip()} to {version_id}...")

                staging_config['Parameters'][key_name.strip()] = version_id

        if 'PRX_S3_STATIC_S3_VERSION_ID' in attrs:
            print('...Updating S3 static site S3 version ID value...')

            config_did_change = True

            # Update config with new S3 Version ID

            version_id = attrs['PRX_S3_STATIC_S3_VERSION_ID']['Value']

            key_names = attrs['PRX_S3_STATIC_CONFIG_PARAMETERS']['Value'].split(',')
            for key_name in key_names:
                print(f"...Setting {key_name.strip()} to {version_id}...")

                staging_config['Parameters'][key_name.strip()] = version_id

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
        # Only do this if something was updated, so we're not pushing unchanged
        # files, which would still trigger deploys

        if config_did_change:
            print(f"...Uploading to S3 {source_bucket}/{source_key}...")

            s3.upload_file(new_archive_path, source_bucket, source_key)


def post_notification_status(sns_message):
    print('...Posting build status notification...')

    message = sns_message['Message']
    attrs = sns_message['MessageAttributes']

    attachment = {
        # ts: Math.floor(Date.now() / 1000),
        'mrkdwn_in': ['text'],
    }

    repo = attrs['PRX_REPO']['Value']
    sha = attrs['PRX_COMMIT']['Value']
    sha7 = sha[0:7]

    arn = attrs['CODEBUILD_BUILD_ARN']['Value']
    region = arn.split(':')[3]
    build_id = arn.split('/')[1]

    commit_url = f"https://github.com/{repo}/commit/{sha7}"
    build_url = f"https://{region}.console.aws.amazon.com/codebuild/home#/builds/{build_id}/view/new"

    if 'PRX_GITHUB_PR' in attrs:
        num = attrs['PRX_GITHUB_PR']['Value']
        pr_url = f"https://github.com/{repo}/pull/{num}"
        extra = f" <{pr_url}|#{num}>"
    else:
        extra = f":{attrs['PRX_BRANCH']['Value']}"

    if attrs['STATUS']['Value'] == 'true':
        attachment['color'] = 'good'
        attachment['fallback'] = f"Built {repo}{extra} with commit {sha7}"
        attachment['title'] = f"<{build_url}|Built> {repo}{extra} with commit <{commit_url}|{sha7}>"

        text_lines = []

        if 'PRX_GITHUB_PR' in attrs:
            num = attrs['PRX_GITHUB_PR']['Value']
            pr_url = f"https://github.com/{repo}/pull/{num}"
            text_lines.append(f"<{pr_url}|{pr_url}>")
        elif 'PRX_ECR_TAG' in attrs:
            tag = attrs['PRX_ECR_TAG']['Value']
            ecr_region = attrs['PRX_ECR_REGION']['Value']
            ecr_repo = attrs['PRX_ECR_REPOSITORY']['Value']
            ecr_url = f"https://console.aws.amazon.com/ecs/home?region={ecr_region}#/repositories/{ecr_repo}"
            text_lines.append(f"Docker image pushed to <{ecr_url}|ECR> with tag `{tag}`")
        elif 'PRX_LAMBDA_CODE_S3_VERSION_ID' in attrs:
            s3_version = attrs['PRX_LAMBDA_CODE_S3_VERSION_ID']['Value']
            text_lines.append(f"Lambda code pushed to S3 with version ID `{s3_version}`")
        elif 'PRX_S3_STATIC_S3_VERSION_ID' in attrs:
            s3_version = attrs['PRX_S3_STATIC_S3_VERSION_ID']['Value']
            text_lines.append(f"S3 static site pushed to S3 with version ID `{s3_version}`")
        else:
            text_lines.append('No pull request; no known artifact')

        attachment['text'] = '\n'.join(text_lines)
    else:
        attachment['color'] = 'danger'
        attachment['fallback'] = f"Failed to build {repo}{extra} with commit {sha7}"
        attachment['title'] = f"Failed to <{build_url}|build> {repo}{extra} with commit <{commit_url}|{sha7}>"
        attachment['text'] = f"> _{message}_"

    slack_message = json.dumps({
        'channel': SLACK_CHANNEL,
        'username': f"{SLACK_USERNAME}",
        'icon_emoji': SLACK_ICON,
        'attachments': [attachment]
    })

    topic_arn = os.environ['SLACK_MESSAGE_RELAY_TOPIC_ARN']

    sns.publish(TopicArn=topic_arn, Message=slack_message)


def log_build_metrics(sns_message):
    attrs = sns_message['MessageAttributes']

    build_arn = attrs['CODEBUILD_BUILD_ARN']['Value']
    build_id = build_arn.split('/')[1]
    project_name = build_id.split(':')[0]

    github_repo = attrs['PRX_REPO']['Value']

    build = codebuild.batch_get_builds(ids=[build_id])['builds'][0]

    now = datetime.datetime.now(datetime.timezone.utc)

    build_duration = (now - build['startTime']).total_seconds()

    cloudwatch.put_metric_data(
        Namespace='PRX/CI',
        MetricData=[
            {
                'MetricName': 'Builds',
                'Dimensions': [
                    {
                        'Name': 'CodeBuildProject',
                        'Value': project_name
                    }
                ],
                'Value': 1,
                'Unit': 'Count'
            }, {
                'MetricName': 'BuildDuration',
                'Dimensions': [
                    {
                        'Name': 'CodeBuildProject',
                        'Value': project_name
                    }
                ],
                'Value': build_duration,
                'Unit': 'Seconds'
            }, {
                'MetricName': 'Builds',
                'Dimensions': [
                    {
                        'Name': 'GitHubRepository',
                        'Value': github_repo
                    }
                ],
                'Value': 1,
                'Unit': 'Count'
            }, {
                'MetricName': 'BuildDuration',
                'Dimensions': [
                    {
                        'Name': 'GitHubRepository',
                        'Value': github_repo
                    }
                ],
                'Value': build_duration,
                'Unit': 'Seconds'
            }
        ]
    )


def lambda_handler(event, context):
    sns_object = event['Records'][0]['Sns']

    if ('MessageAttributes' in sns_object
            and len(sns_object['MessageAttributes']) > 0):
        # New CI
        update_github_status(sns_object)
        update_staging_config_status(sns_object)
        post_notification_status(sns_object)
        log_build_metrics(sns_object)

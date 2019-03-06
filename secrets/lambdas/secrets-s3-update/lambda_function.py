# Invoked by: S3 Object Change
# Returns: Error or status message
#
# Environment variables for applications are stored in encrypted s3 files.
# When those files are updated, the env config file should be updated with the
# current object version number for the application for that app and env

import zipfile
import boto3
import traceback
import json
import zlib
import uuid
import os
from botocore.client import Config

#########
# helpers
#########
s3 = boto3.client('s3', config=Config(signature_version='s3v4'))
abbreviations = { 'dev' : 'development', 'stag' : 'staging', 'prod' : 'production' }

def env_abbr_to_full(abbr):
    return abbreviations[abbr]

def temp_file_path():
    return "/tmp/{0}".format(uuid.uuid4())


##############
# main methods
##############
def get_record_info(record):
    bucket = record['s3']['bucket']['name']
    key = record['s3']['object']['key']
    app, env, file = key.split('/')
    # print(app, env, file)
    version = s3.head_object(Bucket=bucket, Key=key)['VersionId']
    return {'app' : app, 'env' : env, 'file' : file, 'version' : version}

def get_secrets_changes(event):
    changes = {}
    for record in event['Records']:
        info = get_record_info(record)
        if info['file'] == 'secrets':
            changes.setdefault(info['env'], []).append(info)
    return changes

def get_config(env):
    environment = env_abbr_to_full(env)
    source_bucket = os.environ['INFRASTRUCTURE_CONFIG_BUCKET']
    source_key = os.environ["INFRASTRUCTURE_CONFIG_%s_KEY" % environment.upper()]

    archive_path = temp_file_path()

    print("...Getting %s config: %s/%s..." % (environment, source_bucket, source_key))
    print("...Writing file to %s..." % archive_path)

    s3.download_file(source_bucket, source_key, archive_path)

    with zipfile.ZipFile(archive_path, 'r') as archive:
        env_config = json.load(archive.open(environment + '.json'))

    return env_config

def update_config(env, changes):
    env_config = get_config(env)
    for change in changes:
        app_key = change['app'].title() + 'SecretsVersion'
        if app_key in env_config['Parameters']:
            current_val = env_config['Parameters'][app_key]
        else:
            current_val = None
        new_val = change['version']
        print("...Set %s from %s to %s..." % (app_key, current_val, new_val))
        env_config['Parameters'][app_key] = new_val
    return env_config

def upload_config(env, config):
    print("...Generating template config version...")

    body = json.dumps(config)
    archive_path = temp_file_path()
    environment = env_abbr_to_full(env)

    archive = zipfile.ZipFile(archive_path, mode='w')
    archive.writestr(environment + '.json', body, compress_type=zipfile.ZIP_DEFLATED)
    archive.close()

    source_bucket = os.environ['INFRASTRUCTURE_CONFIG_BUCKET']
    source_key = os.environ["INFRASTRUCTURE_CONFIG_%s_KEY" % environment.upper()]

    s3.upload_file(archive_path, source_bucket, source_key)

    print("...Wrote update to %s/%s..." % (source_bucket, source_key))


def lambda_handler(event, context):
    try:
        print('Starting secrets update...')

        # get all the secrets changes, keyed by env
        changes = get_secrets_changes(event)

        # for each env, update with change, then upload zipped file
        for env in changes.keys():
            upload_config(env, update_config(env, changes[env]))

        return '...Done'

    except Exception as e:
        print('Function failed due to exception.')
        print(e)
        traceback.print_exc()


################################################################################
# local test
################################################################################
if os.environ.get('LOCAL_TEST'):
    os.environ['INFRASTRUCTURE_CONFIG_DEVELOPMENT_KEY'] = 'template-config-development.zip'
    os.environ['INFRASTRUCTURE_CONFIG_BUCKET'] = 'prx-infrastructure-us-east-1-config'
    test_event = {
        'Records' : [
            {
                's3': {
                    'object' : { 'key' : 'castle/dev/secrets' },
                    'bucket' : { 'name': 'prx_test_aws_secrets-secrets' }
                }
            }
        ]
    }
    test_context = {}
    lambda_handler(test_event, test_context)

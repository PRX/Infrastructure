# Invoked by: CodePipeline
# Returns: Error or status message
#
# Creates an output artifact for the production template config. It does that by
# getting the existing production config from S3 and the staging config pipeline
# artifact, and updating any app version information (ECR image tags, etc) from
# staging to production. The result is written to the output artifact

import boto3
import traceback
import os
import zlib
import zipfile
import json
import re
import uuid
from botocore.client import Config

s3 = boto3.client('s3', config=Config(signature_version='s3v4'))
code_pipeline = boto3.client('codepipeline')

def put_job_success(job, message):
    print('Putting job success')
    print(message)
    code_pipeline.put_job_success_result(jobId=job['id'])

def put_job_failure(job, message):
    print('Putting job failure')
    print(message)
    code_pipeline.put_job_failure_result(jobId=job['id'], failureDetails={'message': message, 'type': 'JobFailed'})

def get_staging_config(job):
    input_artifact = job['data']['inputArtifacts'][0]
    input_location = input_artifact['location']['s3Location']
    input_bucket = input_location['bucketName']
    input_key = input_location['objectKey']
    input_id = input_key.split('/')[-1]

    archive_path = "/tmp/{0}".format(input_id)

    print(f"...Getting staging config from {input_bucket}/{input_key}...")
    print(f"...Writing artifact to {archive_path}...")

    s3.download_file(input_bucket, input_key, archive_path)

    with zipfile.ZipFile(archive_path, 'r') as archive:
        staging_config = json.load(archive.open('staging.json'))

    return staging_config

def get_production_config(job):
    source_bucket = os.environ['INFRASTRUCTURE_CONFIG_BUCKET']
    source_key = os.environ['INFRASTRUCTURE_CONFIG_PRODUCTION_KEY']

    archive_path = "/tmp/{0}".format(source_key)

    print(f"...Getting production config: {source_bucket}/{source_key}...")
    print(f"...Writing artifact to {archive_path}...")

    s3.download_file(source_bucket, source_key, archive_path)

    with zipfile.ZipFile(archive_path, 'r') as archive:
        production_config = json.load(archive.open('production.json'))

    return production_config

def update_production_config(production_config, staging_config):
    print('...Updating production config...')

    for key, value in production_config['Parameters'].items():
        if re.search("ECRImageTag", key):
            print(f"...Updating {key}: from {value} to {new_value}...")
            new_value = staging_config['Parameters'][key]

    return production_config

def lambda_handler(event, context):
    try:
        print('Starting copy...')

        job = event['CodePipeline.job']

        staging_config = get_staging_config(job)
        production_config = get_production_config(job)

        config = update_production_config(production_config, staging_config)

        body = json.dumps(config);

        archive_path = "/tmp/{0}".format(uuid.uuid4())

        # TODO Should be able to do this all in memory
        archive = zipfile.ZipFile(archive_path, mode='w')
        archive.writestr('production.json', body, compress_type=zipfile.ZIP_DEFLATED)
        archive.close()

        output_artifact = job['data']['outputArtifacts'][0]
        output_location = output_artifact['location']['s3Location']
        output_bucket = output_location['bucketName']
        output_key = output_location['objectKey']
        s3.upload_file(archive_path, output_bucket, output_key)

        print(f"...Wrote update to {output_bucket}/{output_key}...")

        put_job_success(job, '')

        return '...Done'

    except Exception as e:
        print('Function failed due to exception.')
        print(e)
        traceback.print_exc()
        put_job_failure(job, 'Function exception: ' + str(e))

# Invoked by: CodePipeline
# Returns: Error or status message
#
# In order for the root stack to launch nested stacks, the tempates for those
# nested stacks much be available on S3. This function copies all the files in
# the stacks/ dir of the Infrastructure repo artifact to S3 for that purpose.
# Those files are copied to the InfrastructureSourceBucket bucket, with an
# object prefix of the Git commit hash.
#
# This should always callback to the CodePipeline API to indicate success or
# failure.

import zipfile
import boto3
import traceback
import json
import zlib
import uuid
import os
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

def sync_source(job):
    print(f"...Syncing repository source...")

    input_artifact = job['data']['inputArtifacts'][0]

    sha = input_artifact['revision']

    input_location = input_artifact['location']['s3Location']
    input_bucket = input_location['bucketName']
    input_key = input_location['objectKey']
    input_id = input_key.split('/')[-1]

    archive_path = "/tmp/{0}".format(input_id)

    print(f"...Getting artifact from {input_bucket}/{input_key}...")
    print(f"...Writing artifact to {archive_path}...")

    output_bucket = os.environ['INFRASTRUCTURE_SOURCE_BUCKET']

    s3.download_file(input_bucket, input_key, archive_path)

    archive = zipfile.ZipFile(archive_path, 'r')
    names = archive.namelist()
    for name in names:
        print(f'...Uploading {name}...')

        f = archive.open(name)

        output_key = "{0}/{1}".format(sha, name)
        s3.upload_fileobj(f, output_bucket, output_key)

def lambda_handler(event, context):
    try:
        print('Starting sync...')

        job = event['CodePipeline.job']

        sync_source(job)

        put_job_success(job, '')

        return '...Done'

    except Exception as e:
        print('Function failed due to exception.')
        print(e)
        traceback.print_exc()
        put_job_failure(job, 'Function exception: ' + str(e))

# Invoked by: CodePipeline
# Returns: Error or status message
#
# This function creates an output artifact, which is a zipped JSON file
# that contains the Git commit hash of the input repo artifact. The destination
# bucket for that is the native CodePipeline artifact store bucket.
#
# This should always callback to the CodePipeline API to indicate success or
# failure.

import zipfile
import boto3
import traceback
import json
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
    code_pipeline.put_job_failure_result(
        jobId=job['id'],
        failureDetails={'message': message, 'type': 'JobFailed'})


# Gets the revision value (Git sha) of the input artifact, and puts it in a
# JSON file that gets zipped and sent to S3 as an output artifact
def publish_revision(job):
    input_artifact = job['data']['inputArtifacts'][0]
    output_artifact = job['data']['outputArtifacts'][0]

    sha = input_artifact['revision']

    print(f"...Publishing revision {sha}...")

    body = json.dumps({'commit': sha})

    archive_path = "/tmp/{0}".format(uuid.uuid4())

    # TODO Should be able to do this all in memory
    archive = zipfile.ZipFile(archive_path, mode='w')
    archive.writestr('state.json', body, compress_type=zipfile.ZIP_DEFLATED)
    archive.close()

    output_location = output_artifact['location']['s3Location']
    output_bucket = output_location['bucketName']
    output_key = output_location['objectKey']
    s3.upload_file(archive_path, output_bucket, output_key)

    print(f"...Wrote to {output_bucket}/{output_key}...")


def lambda_handler(event, context):
    try:
        print('Starting sync...')

        job = event['CodePipeline.job']

        publish_revision(job)

        put_job_success(job, '')

        return '...Done'

    except Exception as e:
        print('Function failed due to exception.')
        print(e)
        traceback.print_exc()
        put_job_failure(job, 'Function exception: ' + str(e))

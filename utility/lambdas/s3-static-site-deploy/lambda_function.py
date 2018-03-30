# Invoked by: CloudFormation
# Returns: A `Data` object to a pre-signed URL
#
# Deploys the contents of a versioned zip file object from one bucket in S3
# to a another bucket

import sys
import boto3
from botocore.client import Config
import io
import zipfile
import os
import urllib.request
import json
import traceback
import mimetypes
import re

s3 = boto3.client('s3', config=Config(signature_version='s3v4'))

STATUS_SUCCESS = 'SUCCESS'
STATUS_FAILED = 'FAILED'

mimetypes.init()
mimetypes.add_type('application/json', 'json')
mimetypes.add_type('application/ttf', 'ttf')
mimetypes.add_type('application/eot', 'eot')
mimetypes.add_type('application/otf', 'otf')
mimetypes.add_type('application/woff', 'woff')


def send_response(event, context, res_status, res_reason='Done', res_data={}):
    print(f"Sending {res_status} response")

    res_data = json.dumps({
        'Status': res_status,
        'Reason': res_reason,
        'PhysicalResourceId': context.log_stream_name,
        'StackId': event['StackId'],
        'RequestId': event['RequestId'],
        'LogicalResourceId': event['LogicalResourceId'],
        'Data': res_data
    }).encode()

    headers = {'content-type': ''}

    url = event['ResponseURL']
    req = urllib.request.Request(url, data=res_data, method='PUT', headers=headers)
    urllib.request.urlopen(req)

    print(f"Response sent")


def lambda_handler(event, context):
    try:
        print(event)

        if event['RequestType'] == 'Create' or event['RequestType'] == 'Update':
            # The location of the built static site archive file in S3
            bucket = event['ResourceProperties']['StaticSiteArchiveS3Bucket']
            key = event['ResourceProperties']['StaticSiteArchiveS3Object']
            version = event['ResourceProperties']['StaticSiteArchiveS3ObjectVersion']

            # Get the archive object
            s3_obj = s3.get_object(Bucket=bucket, Key=key, VersionId=version)

            unzip_dir = f"/tmp/unzip-{event['RequestId']}"

            # Unzip the archive, to disk
            with zipfile.ZipFile(io.BytesIO(s3_obj['Body'].read()), 'r') as zip:
                zip.extractall(unzip_dir)

            # The bucket to deploy the static to
            deploy_bucket = event['ResourceProperties']['StaticSiteS3DeployBucket']

            # Upload everything from the unzipped archive
            for root, dirs, files in os.walk(unzip_dir):
                for filename in files:

                    local_path = os.path.join(root, filename)
                    s3_key = os.path.relpath(local_path, unzip_dir)

                    print(f"Uploading {s3_key} to {deploy_bucket}")
                    mime_type = mimetypes.guess_type(filename)[0] or 'application/octet-stream'
                    extras = {'ContentType': mime_type}
                    if re.search(r'\.html$', filename):
                        extras['CacheControl'] = 'max-age=300'
                    s3.upload_file(local_path, deploy_bucket, s3_key, ExtraArgs=extras)

            send_response(event, context, STATUS_SUCCESS)
        else:
            send_response(event, context, STATUS_SUCCESS)

    except Exception as e:
        print('Function failed due to exception.')
        print(e)
        traceback.print_exc()
        send_response(event, context, STATUS_FAILED, res_reason=str(e))

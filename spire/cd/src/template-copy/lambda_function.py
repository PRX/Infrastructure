# Invoked by: CodePipeline
# Returns: Error or status message
#
# In order for the root stack to launch nested stacks, the templates for those
# nested stacks much be available on S3. This function copies all files in the
# Infrastructure repo artifact to S3 for that purpose.
# Those files are copied to the template copy bucket, with an
# object prefix of the Git commit hash of the commit being copied.
#
# This should always callback to the CodePipeline API to indicate success or
# failure.

import zipfile
import boto3
import traceback
import os
from botocore.client import Config

s3 = boto3.client("s3", config=Config(signature_version="s3v4"))
code_pipeline = boto3.client("codepipeline")


def put_job_failure(job, message):
    print("Putting job failure")
    print(message)
    code_pipeline.put_job_failure_result(
        jobId=job["id"], failureDetails={"message": message, "type": "JobFailed"}
    )


def lambda_handler(event, context):
    try:
        print("Starting sync...")

        job = event["CodePipeline.job"]

        print("...Syncing repository source...")

        if len(job["data"]["inputArtifacts"]) != 1:
            raise Exception("Expected exactly 1 input artifact")

        input_artifact = job["data"]["inputArtifacts"][0]

        commit_hash = input_artifact["revision"]

        input_location = input_artifact["location"]["s3Location"]
        input_bucket = input_location["bucketName"]
        input_key = input_location["objectKey"]
        input_id = input_key.split("/")[-1]

        archive_path = "/tmp/{0}".format(input_id)

        print(f"...Getting artifact from {input_bucket}/{input_key}...")
        print(f"...Writing artifact to {archive_path}...")

        output_bucket_name = os.environ["TEMPLATE_COPY_BUCKET_NAME"]

        s3.download_file(input_bucket, input_key, archive_path)

        archive = zipfile.ZipFile(archive_path, "r")
        names = archive.namelist()
        for name in names:
            # `name` will be the full relative file path for the file as it
            # exists in the Infrastructure repository.
            # For example:
            # - "README.md"
            # - "dns/prx.mx-hosted_zone.yml"
            # - "spire/templates/root.yml"
            if f"{name}".startswith("spire/templates"):
                print(f"...Uploading {name}...")

                f = archive.open(name)

                # The object key will match the name from above, with a Git
                # hash (and slash) prepended.
                # For example:
                # - "046c0da3e8cb4…ec83755ad111/README.md"
                # - "046c0da3e8cb4…ec83755ad111/dns/prx.mx-hosted_zone.yml"
                # - "046c0da3e8cb4…ec83755ad111/spire/templates/root.yml"
                output_key = "{0}/{1}".format(commit_hash, name)
                s3.upload_fileobj(f, output_bucket_name, output_key)

        region = os.environ["AWS_REGION"]
        template_url_base = (
            f"https://{output_bucket_name}.s3.{region}.amazonaws.com/{commit_hash}"
        )

        code_pipeline.put_job_success_result(
            jobId=job["id"], outputVariables={"TemplateUrlBase": template_url_base}
        )

        return "...Done"

    except Exception as e:
        print("Function failed due to exception.")
        print(e)
        traceback.print_exc()
        put_job_failure(job, "Function exception: " + str(e))

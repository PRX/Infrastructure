# Invoked by: EventBridge rule
#
# Triggered by CodeBuild state changes, and is responsible for updating the
# CloudFormation template config JSON file for the staging stack (in S3).
#
# The event details will include the environment variables defined on the
# CodeBuild project, declared as part of start-build, and those that are
# exported in the buildspec.

import boto3
import os
import zipfile
import json
import uuid
from botocore.client import Config

s3 = boto3.client("s3", config=Config(signature_version="s3v4"))


def update_staging_config_file(event, env_vars):
    if (
        env_vars["PRX_CI_PUBLISH"] == "true"
        and event["detail"]["build-status"] == "SUCCEEDED"
    ):
        print("...Updating Staging template config...")

        # Keep track of if anything has changed
        config_did_change = False

        # Get current staging template config

        source_bucket = os.environ["INFRASTRUCTURE_CONFIG_BUCKET"]
        source_key = os.environ["INFRASTRUCTURE_CONFIG_STAGING_KEY"]

        archive_path = f"/tmp/{source_key}"

        print(f"...Getting staging config: {source_bucket}/{source_key}...")

        s3.download_file(source_bucket, source_key, archive_path)

        with zipfile.ZipFile(archive_path, "r") as archive:
            staging_config = json.load(archive.open("staging.json"))

        if "PRX_ECR_IMAGE" in env_vars and len(env_vars["PRX_ECR_IMAGE"]) > 0:
            print("...Updating ECR image value...")

            config_did_change = True

            # Update config with new ECR image

            ecr_image_name = env_vars["PRX_ECR_IMAGE"]

            for key_name in env_vars["PRX_ECR_CONFIG_PARAMETERS"].split(","):
                print(f"...Setting {key_name.strip()} to {ecr_image_name}...")

                staging_config["Parameters"][key_name.strip()] = ecr_image_name

        if (
            "PRX_LAMBDA_CODE_CONFIG_VALUE" in env_vars
            and len(env_vars["PRX_LAMBDA_CODE_CONFIG_VALUE"]) > 0
        ):
            print("...Updating Lambda code S3 object key value...")

            config_did_change = True

            # Update config with new S3 object key

            config_value = env_vars["PRX_LAMBDA_CODE_CONFIG_VALUE"]

            key_names = env_vars["PRX_LAMBDA_CODE_CONFIG_PARAMETERS"].split(",")
            for key_name in key_names:
                print(f"...Setting {key_name.strip()} to {config_value}...")

                staging_config["Parameters"][key_name.strip()] = config_value

        if (
            "PRX_S3_STATIC_CONFIG_VALUE" in env_vars
            and len(env_vars["PRX_S3_STATIC_CONFIG_VALUE"]) > 0
        ):
            print("...Updating S3 static site S3 object key value...")

            config_did_change = True

            # Update config with new S3 object key

            config_value = env_vars["PRX_S3_STATIC_CONFIG_VALUE"]

            key_names = env_vars["PRX_S3_STATIC_CONFIG_PARAMETERS"].split(",")
            for key_name in key_names:
                print(f"...Setting {key_name.strip()} to {config_value}...")

                staging_config["Parameters"][key_name.strip()] = config_value

        # Zip the new config up

        new_archive_path = f"/tmp/{uuid.uuid4()}"

        body = json.dumps(staging_config)

        # TODO Should be able to do this all in memory
        archive = zipfile.ZipFile(new_archive_path, mode="w")
        archive.writestr("staging.json", body, compress_type=zipfile.ZIP_DEFLATED)
        archive.close()

        # Send back to S3
        # Only do this if something was updated, so we're not pushing unchanged
        # files, which would still trigger deploys

        if config_did_change:
            print(f"...Uploading to S3 {source_bucket}/{source_key}...")

            s3.upload_file(new_archive_path, source_bucket, source_key)


def lambda_handler(event, context):
    print(json.dumps(event))

    event_detail = event["detail"]
    info = event_detail["additional-information"]

    all_env_vars = {}
    for v in info["environment"]["environment-variables"]:
        all_env_vars[v["name"]] = v["value"]
    for v in info["exported-environment-variables"]:
        all_env_vars[v["name"]] = v["value"]

    update_staging_config_file(event, all_env_vars)

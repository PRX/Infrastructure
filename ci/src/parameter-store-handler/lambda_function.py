import boto3
import json
from botocore.client import Config

s3 = boto3.client("s3", config=Config(signature_version="s3v4"))
ssm = boto3.client("ssm")


def update_ssm_parameters(event, env_vars):
    if (
        env_vars["PRX_CI_PUBLISH"] == "true"
        and event["detail"]["build-status"] == "SUCCEEDED"
    ):
        print("...Updating Parameter Store parameters...")

        if (
            "PRX_SPIRE_SSM_PARAMETERS_ECR_TAG" in env_vars
            and "PRX_ECR_IMAGE" in env_vars
            and len(env_vars["PRX_ECR_IMAGE"]) > 0
        ):
            # Update parameters with new ECR image

            ecr_image_name = env_vars["PRX_ECR_IMAGE"]

            print("...Updating ECR image parameter values...")

            for parameter_name in env_vars["PRX_SPIRE_SSM_PARAMETERS_ECR_TAG"].split(
                ","
            ):
                if parameter_name.startswith("/prx/stag/Spire/"):
                    print(f"...{parameter_name}={ecr_image_name}")
                    ssm.put_parameter(
                        Name=parameter_name.strip(),
                        Value=ecr_image_name,
                        Overwrite=True,
                    )

        if (
            "PRX_LAMBDA_CODE_CONFIG_VALUE" in env_vars
            and len(env_vars["PRX_LAMBDA_CODE_CONFIG_VALUE"]) > 0
        ):
            # Update parameters with new S3 object key

            new_s3_object_key = env_vars["PRX_LAMBDA_CODE_CONFIG_VALUE"]
            print("...Updating Lambda code S3 object parameters...")

            for parameter_name in env_vars[
                "PRX_SPIRE_SSM_PARAMETERS_LAMBDA_S3_KEY"
            ].split(","):
                if parameter_name.startswith("/prx/stag/Spire/"):
                    print(f"...{parameter_name.strip()}={new_s3_object_key}...")
                    ssm.put_parameter(
                        Name=parameter_name, Value=new_s3_object_key, Overwrite=True
                    )

        if (
            "PRX_S3_STATIC_CONFIG_VALUE" in env_vars
            and len(env_vars["PRX_S3_STATIC_CONFIG_VALUE"]) > 0
        ):

            new_s3_object_key = env_vars["PRX_S3_STATIC_CONFIG_VALUE"]
            print("...Updating static code S3 object parameters...")

            for parameter_name in env_vars[
                "PRX_SPIRE_SSM_PARAMETERS_STATIC_S3_KEY"
            ].split(","):
                if parameter_name.startswith("/prx/stag/Spire/"):
                    print(f"...{parameter_name.strip()}={new_s3_object_key}...")
                    ssm.put_parameter(
                        Name=parameter_name, Value=new_s3_object_key, Overwrite=True
                    )


def lambda_handler(event, context):
    print(json.dumps(event))

    event_detail = event["detail"]
    info = event_detail["additional-information"]

    all_env_vars = {}
    if "environment-variables" in info["environment"]:
        for v in info["environment"]["environment-variables"]:
            all_env_vars[v["name"]] = v["value"]

    if "exported-environment-variables" in info:
        for v in info["exported-environment-variables"]:
            all_env_vars[v["name"]] = v["value"]

    update_ssm_parameters(event, all_env_vars)

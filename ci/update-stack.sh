#!/bin/bash
set -e

source ../.env
mkdir -p .deploy

# Get the name of the support bucket from the storage stack export values
support_bucket_export_key="${STORAGE_STACK_NAME}-InfrastructureSupportBucket"
support_bucket_name="$(aws cloudformation list-exports | jq -r --arg name "$support_bucket_export_key" '.Exports[] | select(.Name==$name) | .Value')"

# Check Versioning status for support bucket
bucket_versioning=`aws s3api get-bucket-versioning --bucket "$support_bucket_name" --output text --query 'Status'`
if [ "$bucket_versioning" != "Enabled" ]
then
        echo "Bucket versioning must be enabled for the stack resources bucket"
        return 1
fi

# Copy Lambda code to S3
version_suffix="S3ObjectVersion"
mkdir -p .deploy/lambdas
cd ./lambdas
while read dirname
do
        cd "$dirname"
        zip -r "$dirname" *
        mv "${dirname}.zip" ../../.deploy/lambdas
        version_id=`aws s3api put-object --bucket "$support_bucket_name" --key "${CI_STACK_NAME}/lambdas/${dirname}.zip" --acl private --body ../../.deploy/lambdas/"$dirname".zip --output text --query 'VersionId'`
        declare "${dirname}_${version_suffix}"="$version_id"
        cd ..
done < <(find * -maxdepth 0 -type d)
cd ..

# Deploy CloudFormation stack
aws cloudformation deploy \
        --template-file ./ci.yml \
        --stack-name "$CI_STACK_NAME" \
        --capabilities CAPABILITY_IAM \
        --no-execute-changeset \
        --parameter-overrides \
                CiStatusNotificationHandlerLambdaFunctionS3ObjectVersion="${ci_status_notification_handler_S3ObjectVersion}" \
                GitHubWebhookEndpointLambdaFunctionS3ObjectVersion="${github_webhook_endpoint_S3ObjectVersion}" \
                GitHubEventHandler2LambdaFunctionS3ObjectVersion="${github_event_handler2_S3ObjectVersion}" \
                CodeBuildCallbackHandlerLambdaFunctionS3ObjectVersion="${codebuild_callback_handler_S3ObjectVersion}"

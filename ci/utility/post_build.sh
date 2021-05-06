#!/bin/bash
set -e
set -a

# First parameter is required and is a boolean indicating if the build was a
# success. Second paremeter is an error message if the build was a failure.
send_sns_callback_message() {
    echo "Sending SNS message to CodeBuild callback topic"

    MSG="$2"

    # Construct the message attributes JSON
    MSGATR="{"

    # Required status code (always comes first, for the comma)
    MSGATR+="\"STATUS\": {\"DataType\": \"String\", \"StringValue\": \"$1\"}"

    # Non-optional values
    MSGATR+=",\"CODEBUILD_BUILD_ARN\": {\"DataType\": \"String\", \"StringValue\": \"$CODEBUILD_BUILD_ARN\"}"
    MSGATR+=",\"PRX_AWS_ACCOUNT_ID\": {\"DataType\": \"String\", \"StringValue\": \"$PRX_AWS_ACCOUNT_ID\"}"
    MSGATR+=",\"PRX_REPO\": {\"DataType\": \"String\", \"StringValue\": \"$PRX_REPO\"}"
    MSGATR+=",\"PRX_COMMIT\": {\"DataType\": \"String\", \"StringValue\": \"$PRX_COMMIT\"}"
    MSGATR+=",\"PRX_BRANCH\": {\"DataType\": \"String\", \"StringValue\": \"$PRX_BRANCH\"}"

    # Optional GitHub pull request number parameter (pass-through)
    [ -z "$PRX_GITHUB_PR" ] || MSGATR+=",\"PRX_GITHUB_PR\": {\"DataType\": \"String\", \"StringValue\": \"$PRX_GITHUB_PR\"}"

    # Optional ECR parameters
    [ -z "$PRX_ECR_CONFIG_PARAMETERS" ] || MSGATR+=",\"PRX_ECR_CONFIG_PARAMETERS\": {\"DataType\": \"String\", \"StringValue\": \"$PRX_ECR_CONFIG_PARAMETERS\"}"
    [ -z "$PRX_ECR_IMAGE" ] || MSGATR+=",\"PRX_ECR_IMAGE\": {\"DataType\": \"String\", \"StringValue\": \"$PRX_ECR_IMAGE\"}"

    # Optional Lambda code parameters
    [ -z "$PRX_LAMBDA_CODE_CONFIG_VALUE" ] || MSGATR+=",\"PRX_LAMBDA_CODE_CONFIG_VALUE\": {\"DataType\": \"String\", \"StringValue\": \"$PRX_LAMBDA_CODE_CONFIG_VALUE\"}"
    [ -z "$PRX_LAMBDA_CODE_CONFIG_PARAMETERS" ] || MSGATR+=",\"PRX_LAMBDA_CODE_CONFIG_PARAMETERS\": {\"DataType\": \"String\", \"StringValue\": \"$PRX_LAMBDA_CODE_CONFIG_PARAMETERS\"}"

    # Optional S3 static site parameters
    [ -z "$PRX_S3_STATIC_CONFIG_VALUE" ] || MSGATR+=",\"PRX_S3_STATIC_CONFIG_VALUE\": {\"DataType\": \"String\", \"StringValue\": \"$PRX_S3_STATIC_CONFIG_VALUE\"}"
    [ -z "$PRX_S3_STATIC_CONFIG_PARAMETERS" ] || MSGATR+=",\"PRX_S3_STATIC_CONFIG_PARAMETERS\": {\"DataType\": \"String\", \"StringValue\": \"$PRX_S3_STATIC_CONFIG_PARAMETERS\"}"

    MSGATR+="}"

    echo "$MSGATR"

    OUT=$(aws sns publish --topic-arn "$PRX_SNS_CALLBACK" --message "$MSG" --message-attributes "$MSGATR")

    SNS_CLI_CODE=$?
    if [ $SNS_CLI_CODE -eq 0 ]; then
        echo "Sent SNS message: $MSG"
    else
        echo "Failed to send SNS message: $MSG"
        exit $SNS_CLI_CODE
    fi
}

build_success() {
    echo "Script completed successfully!"
    send_sns_callback_message true "Success"
    exit 0
}

build_error() {
    echo "Script did not complete successfully: $1"
    send_sns_callback_message false "$1"
    exit 1
}

# If PRX_ECR_CONFIG_PARAMETERS is present, we try to push to ECR
push_to_ecr() {
    if [ -n "$PRX_ECR_CONFIG_PARAMETERS" ]
    then
        if [ -z "$PRX_ECR_CONFIG_PARAMETERS" ]; then build_error "PRX_ECR_CONFIG_PARAMETERS required for ECR push"; fi
        echo "Handling ECR push..."

        echo "Logging into ECR..."
        $(aws ecr get-login --no-include-email --region $AWS_DEFAULT_REGION)
        echo "...Logged in to ECR"

        UNSAFE_ECR_REPO_NAME="GitHub/${PRX_REPO}"
        # Do any transformations necessary to satisfy ECR naming requirements:
        # Start with letter, [a-z0-9-_/.] (maybe, docs are unclear)
        SAFE_ECR_REPO_NAME=$(echo "$UNSAFE_ECR_REPO_NAME" | tr '[:upper:]' '[:lower:]')

        # Need to allow errors temporarily to check if the repo exists
        set +e
        aws ecr describe-repositories --repository-names "$SAFE_ECR_REPO_NAME" > /dev/null 2>&1
        if [ $? -eq 0 ]
        then
            echo "ECR Repository already exists"
        else
            echo "Creating ECR repository"
            aws ecr create-repository --repository-name "$SAFE_ECR_REPO_NAME"
        fi
        set -e

        echo "Getting Docker image ID"
        IMAGE_ID=$(docker images --filter "label=org.prx.app" --format "{{.ID}}" | head -n 1)

        if [ -z "$IMAGE_ID" ]; then
            build_error "No Docker image found; ensure at least one Dockerfile has an org.prx.app label"
        else
            # Construct the image name with a tag
            ECR_IMAGE_NAME="${PRX_AWS_ACCOUNT_ID}.dkr.ecr.${AWS_DEFAULT_REGION}.amazonaws.com/${SAFE_ECR_REPO_NAME}:${PRX_COMMIT}"
            export PRX_ECR_IMAGE="$ECR_IMAGE_NAME"

            echo "Pushing image $IMAGE_ID to ECR $ECR_IMAGE_NAME..."
            docker tag $IMAGE_ID $ECR_IMAGE_NAME
            docker push $ECR_IMAGE_NAME
        fi
    fi
}

# If the buildspec provides an S3 object key for Lambda code, the built code
# from the CodeBuild needs to be pushed to that key in the standard Application
# Code bucket provided by the Storage stack.
push_to_s3_lambda() {
    if [ -n "$PRX_LAMBDA_CODE_CONFIG_PARAMETERS" ]
    then
        if [ -z "$PRX_APPLICATION_CODE_BUCKET" ]; then build_error "PRX_APPLICATION_CODE_BUCKET required for Lambda code push"; fi
        if [ -z "$PRX_LAMBDA_CODE_CONFIG_PARAMETERS" ]; then build_error "PRX_LAMBDA_CODE_CONFIG_PARAMETERS required for Lambda code push"; fi
        if [ -z "$PRX_LAMBDA_ARCHIVE_BUILD_PATH" ]; then export PRX_LAMBDA_ARCHIVE_BUILD_PATH="/.prxci/build.zip" ; fi
        echo "Handling Lambda code push..."

        echo "Getting Docker image ID"
        image_id=$(docker images --filter "label=org.prx.lambda" --format "{{.ID}}" | head -n 1)

        if [ -z "$image_id" ]; then
            build_error "No Docker image found; ensure at least one Dockerfile has an org.prx.lambda label"
        else
            container_id=$(docker create $image_id)

            echo "Copying zip archive for Lambda source..."
            docker cp $container_id:$PRX_LAMBDA_ARCHIVE_BUILD_PATH build.zip

            cleaned=`docker rm $container_id`

            echo "Sending zip archive to S3..."
            key="GitHub/${PRX_REPO}/${PRX_COMMIT}.zip"
            aws s3api put-object --bucket $PRX_APPLICATION_CODE_BUCKET --key $key --acl private --body build.zip

            PRX_LAMBDA_CODE_CONFIG_VALUE="$key"
            export PRX_LAMBDA_CODE_CONFIG_VALUE
        fi
    fi
}

#
push_to_s3_static() {
    if [ -n "$PRX_S3_STATIC_CONFIG_PARAMETERS" ]
    then
        if [ -z "$PRX_APPLICATION_CODE_BUCKET" ]; then build_error "PRX_APPLICATION_CODE_BUCKET required for S3 static code push"; fi
        if [ -z "$PRX_S3_STATIC_CONFIG_PARAMETERS" ]; then build_error "PRX_S3_STATIC_CONFIG_PARAMETERS required for S3 static code push"; fi
        if [ -z "$PRX_S3_STATIC_ARCHIVE_BUILD_PATH" ]; then export PRX_S3_STATIC_ARCHIVE_BUILD_PATH="/.prxci/build.zip" ; fi
        echo "Handling S3 static code push..."

        echo "Getting Docker image ID"
        image_id=$(docker images --filter "label=org.prx.s3static" --format "{{.ID}}" | head -n 1)

        if [ -z "$image_id" ]; then
            build_error "No Docker image found; ensure at least one Dockerfile has an org.prx.s3static label"
        else
            container_id=$(docker create $image_id)

            echo "Copying zip archive for S3 static source..."
            docker cp $container_id:$PRX_S3_STATIC_ARCHIVE_BUILD_PATH build.zip

            cleaned=`docker rm $container_id`

            echo "Sending zip archive to S3..."
            key="GitHub/${PRX_REPO}/${PRX_COMMIT}.zip"
            aws s3api put-object --bucket $PRX_APPLICATION_CODE_BUCKET --key $key --acl private --body build.zip

            export PRX_S3_STATIC_CONFIG_VALUE="$key"
        fi

    fi
}

init() {
    echo "Running post_build script..."

    # Check for required environment variables
    if [ -z "$PRX_SNS_CALLBACK" ]; then echo "PRX_SNS_CALLBACK required"; exit 1; fi
    if [ -z "$PRX_AWS_ACCOUNT_ID" ]; then build_error "PRX_AWS_ACCOUNT_ID required"; fi
    if [ -z "$PRX_REPO" ]; then build_error "PRX_REPO required"; fi
    if [ -z "$PRX_COMMIT" ]; then build_error "PRX_COMMIT required"; fi
    if [ -z "$CODEBUILD_BUILD_SUCCEEDING" ]; then build_error "CODEBUILD_BUILD_SUCCEEDING required"; fi

    # Check the status of the build
    if [ $CODEBUILD_BUILD_SUCCEEDING -eq 0 ]
    then
        build_error "A previous CodeBuild phase did not succeed"
    fi

    # Handle code publish if enabled
    if [ "$PRX_CI_PUBLISH" = "true" ]
    then
        echo "Publishing code..."
        push_to_ecr
        push_to_s3_lambda
        push_to_s3_static

        build_success
    else
        build_success
    fi
}

init

export PRX_LAMBDA_CODE_CONFIG_VALUE

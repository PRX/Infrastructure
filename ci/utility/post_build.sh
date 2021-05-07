#!/bin/bash
set -e
set -a

# If PRX_ECR_CONFIG_PARAMETERS is present, we try to push to ECR
push_to_ecr() {
    if [ -n "$PRX_ECR_CONFIG_PARAMETERS" ]
    then
        if [ -z "$PRX_ECR_CONFIG_PARAMETERS" ]; then build_error "PRX_ECR_CONFIG_PARAMETERS required for ECR push"; fi
        echo "Handling ECR push..."

        echo "Logging into ECR..."
        $(aws ecr get-login --no-include-email --region $AWS_DEFAULT_REGION)
        echo "...Logged in to ECR"

        unsafe_ecr_repo_name="GitHub/${PRX_REPO}"
        # Do any transformations necessary to satisfy ECR naming requirements:
        # Start with letter, [a-z0-9-_/.] (maybe, docs are unclear)
        safe_ecr_repo_name=$(echo "$unsafe_ecr_repo_name" | tr '[:upper:]' '[:lower:]')

        # Need to allow errors temporarily to check if the repo exists
        set +e
        aws ecr describe-repositories --repository-names "$safe_ecr_repo_name" > /dev/null 2>&1
        if [ $? -eq 0 ]
        then
            echo "ECR Repository already exists"
        else
            echo "Creating ECR repository"
            aws ecr create-repository --repository-name "$safe_ecr_repo_name"
        fi
        set -e

        echo "Getting Docker image ID"
        image_id=$(docker images --filter "label=org.prx.app" --format "{{.ID}}" | head -n 1)

        if [ -z "$image_id" ]; then
            build_error "No Docker image found; ensure at least one Dockerfile has an org.prx.app label"
        else
            # Construct the image name with a tag
            ecr_image_name="${PRX_AWS_ACCOUNT_ID}.dkr.ecr.${AWS_DEFAULT_REGION}.amazonaws.com/${safe_ecr_repo_name}:${PRX_COMMIT}"
            export PRX_ECR_IMAGE="$ecr_image_name"

            echo "Pushing image $image_id to ECR $ecr_image_name..."
            docker tag $image_id $ecr_image_name
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
            export PRX_LAMBDA_CODE_CONFIG_VALUE="$key"
            aws s3api put-object --bucket $PRX_APPLICATION_CODE_BUCKET --key $key --acl private --body build.zip
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
            export PRX_S3_STATIC_CONFIG_VALUE="$key"
            aws s3api put-object --bucket $PRX_APPLICATION_CODE_BUCKET --key $key --acl private --body build.zip
        fi
    fi
}

init() {
    echo "Running post_build script..."

    ## Set by CodeBuild during the build
    if [ -z "$CODEBUILD_BUILD_SUCCEEDING" ]; then exit 1 "CODEBUILD_BUILD_SUCCEEDING required"; fi

    # Only do work if the build is succeeding to this point
    if [ $CODEBUILD_BUILD_SUCCEEDING -eq 0 ]
    then
        echo "A previous CodeBuild phase did not succeed"
    else
        # Check for required environment variables
        ## Set on the CodeBuild project definition
        if [ -z "$PRX_AWS_ACCOUNT_ID" ]; then build_error "PRX_AWS_ACCOUNT_ID required"; fi
        ## Set from startBuild
        if [ -z "$PRX_REPO" ]; then build_error "PRX_REPO required"; fi
        if [ -z "$PRX_COMMIT" ]; then build_error "PRX_COMMIT required"; fi


        # Handle code publish if enabled
        if [ "$PRX_CI_PUBLISH" = "true" ]
        then
            echo "Publishing code..."
            push_to_ecr
            push_to_s3_lambda
            push_to_s3_static
        else
            echo "Code publishing is not enabled for this build"
        fi
    fi
}

init

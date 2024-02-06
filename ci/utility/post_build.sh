#!/bin/bash
set -e
set -a

# Look for any Docker images labeled with "org.prx.spire.publish.ecr"
push_to_ecr() {
    echo ">>> Looking for publishable Docker images"
    image_ids=$(docker images --filter "label=org.prx.spire.publish.ecr" --format "{{.ID}}")

    if [ -z "$image_ids" ]; then
        echo "< No Docker images found. Set the org.prx.spire.publish.ecr LABEL in a Dockerfile to publish its image."
    else
        for image_id in $image_ids; do
            echo "> Publishing Docker image: $image_id..."

            label=$(docker inspect --format '{{ index .Config.Labels "org.prx.spire.publish.ecr"}}' "$image_id")

            echo "> Logging into ECR"
            aws ecr get-login-password --region "${AWS_DEFAULT_REGION}" | docker login --username AWS --password-stdin "${PRX_AWS_ACCOUNT_ID}.dkr.ecr.${AWS_DEFAULT_REGION}.amazonaws.com"
            echo "> Logged in to ECR"

            unsafe_ecr_repo_name="GitHub/${PRX_REPO}"
            # Do any transformations necessary to satisfy ECR naming requirements:
            # Start with letter, [a-z0-9-_/.] (maybe, docs are unclear)
            safe_ecr_repo_name=$(echo "$unsafe_ecr_repo_name" | tr '[:upper:]' '[:lower:]')

            # Need to allow errors temporarily to check if the repo exists
            set +e
            aws ecr describe-repositories --repository-names "$safe_ecr_repo_name" > /dev/null 2>&1
            if [ $? -eq 0 ]
            then
                echo "> ECR Repository already exists"
            else
                echo "> Creating ECR repository"
                aws ecr create-repository --repository-name "$safe_ecr_repo_name"
            fi
            set -e

            image_tag="${PRX_COMMIT}"
            image_name="${safe_ecr_repo_name}"
            tagged_image_name="${image_name}:${image_tag}"

            ecr_domain="${PRX_AWS_ACCOUNT_ID}.dkr.ecr.${AWS_DEFAULT_REGION}.amazonaws.com"

            full_image_uri="${ecr_domain}/${tagged_image_name}"

            # Export a variable whose name is the LABEL from the Dockerfile,
            # and whose value is the full image name with tag
            # e.g., if there's a LABEL org.prx.spire.publish.docker="WEB_SERVER"
            # this would set WEB_SERVER=1234.dkr.ecr.us-eas-1.amazonaws.com...
            declare -gx "$label"="$tagged_image_name"

            echo "> Pushing image $image_id to ECR $full_image_uri"
            docker tag $image_id $full_image_uri
            docker push $full_image_uri
            echo "< Finished publishing Docker image"
        done
    fi
}

# Look for any Docker images labeled with "org.prx.spire.publish.s3"
push_to_s3() {
    echo ">>> Looking for publishable ZIP files"
    image_ids=$(docker images --filter "label=org.prx.spire.publish.s3" --format "{{.ID}}")

    if [ -z "$image_ids" ]; then
        echo "< No Docker images found. Set the org.prx.spire.publish.s3 LABEL in a Dockerfile to publish a ZIP file."
    else
        for image_id in $image_ids; do
            label=$(docker inspect --format '{{ index .Config.Labels "org.prx.spire.publish.s3"}}' "$image_id")

            echo "> Publishing ZIP file for ${label} from Docker image: $image_id..."

            if [ -z "$PRX_S3_ARCHIVE_BUILD_PATH" ]; then export PRX_S3_ARCHIVE_BUILD_PATH="/.prxci/build.zip" ; fi

            # Create a container from the image that was made during the build.
            # The code will be somewhere in that image as a ZIP file.
            container_id=$(docker create $image_id)

            # Copy the ZIP file out of the container into the local environment
            # in a file called: send-to-s3.zip
            echo "> Copying ZIP file $PRX_S3_ARCHIVE_BUILD_PATH from container $container_id"
            docker cp $container_id:$PRX_S3_ARCHIVE_BUILD_PATH send-to-s3.zip

            cleaned=`docker rm $container_id`

            # Send send-to-s3.zip to S3 as a new object (not a version)
            echo "> Sending ZIP file to S3"
            key="GitHub/${PRX_REPO}/${PRX_COMMIT}/${label}.zip"

            aws s3api put-object --bucket $PRX_APPLICATION_CODE_BUCKET --key $key --acl private --body send-to-s3.zip
            echo "< Finished publishing ZIP file"

            declare -gx "$label"="$key"
        done
    fi
}

init() {
    echo ">>>>> Running post_build script"

    ## Set by CodeBuild during the build
    if [ -z "$CODEBUILD_BUILD_SUCCEEDING" ]; then exit 1 "CODEBUILD_BUILD_SUCCEEDING required"; fi

    # Only do work if the build is succeeding to this point
    if [ $CODEBUILD_BUILD_SUCCEEDING -eq 0 ]
    then
        echo "< A previous CodeBuild phase did not succeed"
    else
        # Check for required environment variables.
        #### Set on the AWS::CodeBuild::Project in template.yml
        if [ -z "$PRX_AWS_ACCOUNT_ID" ]; then exit 1 "PRX_AWS_ACCOUNT_ID required"; fi
        #### Set from startBuild (in build-handler Lambda)
        if [ -z "$PRX_REPO" ]; then exit 1 "PRX_REPO required"; fi
        if [ -z "$PRX_COMMIT" ]; then exit 1 "PRX_COMMIT required"; fi

        # Handle code publish if enabled
        if [ "$PRX_CI_PUBLISH" = "true" ]
        then
            echo "> Publishing code"
            push_to_ecr
            push_to_s3
        elif [ "$PRX_CI_PRERELEASE" = "true" ]
        then
            echo "> Pushing pre-release code"
            push_to_ecr
            push_to_s3
        else
            echo "< Code publishing is not enabled for this build"
        fi
    fi
}

init

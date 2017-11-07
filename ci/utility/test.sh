#!/bin/sh

# export PRX_ECR_REPOSITORY=some.ecr.repo &&
export CODEBUILD_BUILD_SUCCEEDING=1 && export PRX_ECR_REGION=us-east-1 && export PRX_ECR_REPOSITORY=some.ecr.repo && export PRX_CI_PUBLISH=1 && export PRX_SNS_CALLBACK=1 && export PRX_AWS_ACCOUNT_ID=987654 && export PRX_REPO=somerepo && export PRX_COMMIT=abc123def && ./post_build.sh

#!/bin/sh
set -e
TEST_FILE=".prxci"

#
# PRX codebuild test bootstrapping
#
# Usage:
#   curl -sO https://raw.githubusercontent.com/PRX/Infrastructure/codebuild_scripts/codebuild/scripts/bootstrap.sh && sh bootstrap.sh
#

# sns callback helpers
if [ -z "$SNS_CALLBACK" ]; then
  echo "You must define an \$SNS_CALLBACK"
  exit 1
fi
sns_message() {
  MSG="'{\"success\":$1,\"reason\":\"$2\""
  [ -z "$PRX_REPO" ] || MSG="$MSG,\"prxRepo\":\"$PRX_REPO\""
  [ -z "$PRX_COMMIT" ] || MSG="$MSG,\"prxCommit\":\"$PRX_COMMIT\""
  [ -z "$PRX_ECR_TAG" ] || MSG="$MSG,\"prxEcrTag\":\"$PRX_ECR_TAG\""
  [ -z "$PRX_ECR_REGION" ] || MSG="$MSG,\"prxEcrRegion\":\"$PRX_ECR_REGION\""
  [ -z "$CODEBUILD_BUILD_ARN" ] || MSG="$MSG,\"buildArn\":\"$CODEBUILD_BUILD_ARN\""
  MSG="$MSG}'"
  OUT=$(aws sns publish --topic-arn "$SNS_CALLBACK" --message "$MSG")
  CODE=$?
  if [ $CODE -eq 0 ]; then
    echo "Sent SNS message: $MSG"
  else
    echo "Failed to send SNS message: $MSG"
    exit $CODE
  fi
}
sns_callback() {
  echo "Success!"
  sns_message true
  exit 0
}
sns_error() {
  echo "Failure: $1"
  sns_message false "$1"
  exit 1
}

#
# inputs
#
if [ -z "$PRX_REPO" ]; then
  sns_error "You must set a \$PRX_REPO"
fi
if [ -z "$PRX_COMMIT" ]; then
  sns_error "You must set a \$PRX_COMMIT"
fi
if [ -n "$PRX_ECR_TAG" ] && [ -z "$PRX_ECR_REGION" ]; then
  sns_error "You must set a \$PRX_ECR_REGION"
fi

#
# dependencies
#
if [ ! -f $TEST_FILE ]; then
  sns_error "Repo is missing a $TEST_FILE test script"
fi
if [ ! -f .env ]; then
  echo "" > .env
fi
if [ -n "$(grep docker-compose $TEST_FILE)" ] && [ -z "$(command -v docker-compose 2>&1)" ]; then
  echo "Installing docker-compose..."
  COMPOSE="https://github.com/docker/compose/releases/download/1.11.2/docker-compose-$(uname -s)-$(uname -m)"
  curl -sL $COMPOSE -o /usr/local/bin/docker-compose
  chmod +x /usr/local/bin/docker-compose
  echo "  installed $(docker-compose -v)"
fi
if [ -n "$PRX_ECR_TAG" ]; then
  echo "Logging into ECR..."
  $(aws ecr get-login --region $PRX_ECR_REGION)
fi

#
# run tests
#
set +e
while read LINE; do
  echo "--- PRXCI: $LINE ---"
  ("$LINE")
  CODE=$?
  if [ $CODE -ne 0 ]; then
    sns_error "Command exited with $CODE: $LINE"
    exit $CODE
  fi
done < $TEST_FILE
set -e

#
# optionally push to ECR
#
if [ -n "$PRX_ECR_TAG" ]; then
  echo "TODO: guess which image it was, retag it, and push to ECR"
fi

sns_callback

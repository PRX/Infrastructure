#!/usr/bin/env bash

# List all the regions where Dovetail components run.
# This should match the regions to which Dovetail Router is deployed and
# handling traffic.
REGIONS=("us-east-1" "us-west-2")

clean_up() {
    test -d "$tmp_dir" && rm -fr "$tmp_dir"
}

tmp_dir=$(mktemp -d)

declare -a env
if [[ $1 == "--production" ]]; then
    env_proper="Production"
    env_lower="production"
    env_short="prod"

    logging_prefix="cdn-dovetail-production-logs"
else
    env_proper="Staging"
    env_lower="staging"
    env_short="stag"

    logging_prefix="cdn-dovetail-staging-logs"
fi

# Currently all Spire root stacks follow this naming convention
spire_root_stack_name="infrastructure-cd-root-$env_lower"

# Get the Dovetail CDN hostname from Spire outputs. This value will be the same
# in all regions, so it can be queried from any region.
distribution_domain=$(aws cloudformation describe-stacks --region us-east-1 --stack-name "$spire_root_stack_name" --profile "prx-legacy" --query "Stacks[0].Outputs[?OutputKey=='DovetailCdnHostname'].OutputValue" --output text)

# Get the Dovetail Router hostname from Spire outputs. This value will be the
# same in all regions, so it can be queried from any region.
dovetail_router_domain=$(aws cloudformation describe-stacks --region us-east-1 --stack-name "$spire_root_stack_name" --profile "prx-legacy" --query "Stacks[0].Outputs[?OutputKey=='DovetailRouterHostname'].OutputValue" --output text)
expired_redirect_prefix="https://$dovetail_router_domain"

# Get the Arranger workspace buckets for each region. There should be as many
# of these as there are items in REGIONS.
ue1_bucket_arn=$(aws cloudformation describe-stacks --region us-east-1 --stack-name "$spire_root_stack_name" --profile "prx-legacy" --query "Stacks[0].Outputs[?OutputKey=='DovetailCdnArrangerWorkspaceBucketArn'].OutputValue" --output text)
ue1_bucket=$(echo $ue1_bucket_arn | sed 's/arn:aws:s3::://')
uw2_bucket_arn=$(aws cloudformation describe-stacks --region us-west-2 --stack-name "$spire_root_stack_name" --profile "prx-legacy" --query "Stacks[0].Outputs[?OutputKey=='DovetailCdnArrangerWorkspaceBucketArn'].OutputValue" --output text)
uw2_bucket=$(echo $uw2_bucket_arn | sed 's/arn:aws:s3::://')

#
#
#
# Deploy stacks for real-time logs Kinesis streams to each region
for region in "${REGIONS[@]}"
do
    echo "=> Deploying stack [real-time-logs-kinesis-$env_short] to $region"

    aws cloudformation deploy \
        --template-file real-time-logs-kinesis.yml \
        --profile "prx-dovetail-cdn-$env_lower" \
        --no-fail-on-empty-changeset \
        --region "$region" \
        --stack-name "real-time-logs-kinesis-$env_short"
done

#
#
#
# Deploy the origin-request Lambda to the same region as CloudFront
echo "=> Deploying origin request Lambda function to us-east-1"
code_dir="$tmp_dir/dovetail-cdn-origin-request"
mkdir "$code_dir"
git clone https://github.com/PRX/dovetail-cdn-origin-request.git "$code_dir"
echo "18.15.0" > "$tmp_dir/dovetail-cdn-origin-request/.nvmrc"
sam build \
    --template-file origin-request-lambda.yml \
    --parameter-overrides \
        "EnvironmentType=$env_proper" \
        "LocalCodeDirPath=$code_dir"
sam deploy \
    --no-fail-on-empty-changeset \
    --no-confirm-changeset \
    --resolve-s3 \
    --region us-east-1 \
    --profile "prx-dovetail-cdn-$env_lower" \
    --stack-name "dovetail-origin-request-$env_short" \
    --s3-prefix "dovetail-origin-request-$env_short" \
    --capabilities CAPABILITY_IAM \
    --parameter-overrides \
        "EnvironmentType=$env_proper" \
        "LocalCodeDirPath=$code_dir"

#
#
#
# Get some dynamic values
ue1_kin_arn=$(aws cloudformation describe-stacks --region us-east-1 --stack-name "real-time-logs-kinesis-$env_short" --profile "prx-dovetail-cdn-$env_lower" --query "Stacks[0].Outputs[?OutputKey=='RealTimeLogsStreamArn'].OutputValue" --output text)
uw2_kin_arn=$(aws cloudformation describe-stacks --region us-west-2 --stack-name "real-time-logs-kinesis-$env_short" --profile "prx-dovetail-cdn-$env_lower" --query "Stacks[0].Outputs[?OutputKey=='RealTimeLogsStreamArn'].OutputValue" --output text)
fn_arn=$(aws cloudformation describe-stacks --stack-name "dovetail-origin-request-$env_short" --profile "prx-dovetail-cdn-$env_lower" --query "Stacks[0].Outputs[?OutputKey=='OriginRequestFunctionVersionArn'].OutputValue" --output text --region us-east-1)

#
#
#
# Deploy CloudFront to us-east-1
echo "=> Deploying stack [dovetail-cdn] to us-east-1"
aws cloudformation deploy \
    --profile "prx-dovetail-cdn-$env_lower" \
    --no-fail-on-empty-changeset \
    --capabilities CAPABILITY_IAM \
    --region us-east-1 \
    --stack-name "dovetail-cdn-$env_short" \
    --template-file cloudfront.yml \
    --parameter-overrides "EnvironmentType=$env_proper" \
        "ExpiredRedirectPrefix=$expired_redirect_prefix" \
        "RealtimeLogKinesisStreamArn1=$ue1_kin_arn" \
        "OriginBucket1=$ue1_bucket.s3.us-east-1.amazonaws.com" \
        "CacheBehaviorPrefix1=/use1/*" \
        "RealtimeLogKinesisStreamArn2=$uw2_kin_arn" \
        "OriginBucket2=$uw2_bucket.s3.us-west-2.amazonaws.com" \
        "CacheBehaviorPrefix2=/usw2/*" \
        "RealtimeLogKinesisStreamArn3=" \
        "OriginBucket3=" \
        "CacheBehaviorPrefix3=" \
        "DistributionDomain=$distribution_domain" \
        "OriginRequestFunctionArn=$fn_arn" \
        "StandardLoggingBucket=prx-dovetail.s3.amazonaws.com" \
        "StandardLoggingPrefix=$logging_prefix" \

#
#
#
# Deploy stacks for Kinesis stream proxies to each region
for region in "${REGIONS[@]}"
do
    echo "=> Deploying stack [real-time-logs-kinesis-relay-$env_short] to $region"

    src_kin_arn=$(aws cloudformation describe-stacks --region "$region" --stack-name "real-time-logs-kinesis-$env_short" --profile "prx-dovetail-cdn-$env_lower" --query "Stacks[0].Outputs[?OutputKey=='RealTimeLogsStreamArn'].OutputValue" --output text)
    dest_kin_arn=$(aws cloudformation describe-stacks --region "$region" --stack-name "$spire_root_stack_name" --profile "prx-legacy" --query "Stacks[0].Outputs[?OutputKey=='DovetailCdnLogsKinesisStreamArn'].OutputValue" --output text)
    dest_kin_role_arn=$(aws cloudformation describe-stacks --region "$region" --stack-name "$spire_root_stack_name" --profile "prx-legacy" --query "Stacks[0].Outputs[?OutputKey=='DovetailCdnLogsKinesisStreamOrgWriterRoleArn'].OutputValue" --output text)

    sam build \
        --template-file real-time-logs-kinesis-relay.yml \
        --parameter-overrides \
            "EnvironmentType=$env_proper"
    sam deploy \
        --no-fail-on-empty-changeset \
        --no-confirm-changeset \
        --resolve-s3 \
        --region "$region" \
        --profile "prx-dovetail-cdn-$env_lower" \
        --stack-name "real-time-logs-kinesis-relay-$env_short" \
        --s3-prefix "real-time-logs-kinesis-relay-$env_short" \
        --capabilities CAPABILITY_IAM \
        --parameter-overrides \
            "EnvironmentType=$env_proper" \
            "EnvironmentTypeAbbreviation=$env_short" \
            "SourceKinesisStreamArn=$src_kin_arn" \
            "DestinationKinesisStreamArn=$dest_kin_arn" \
            "DestinationKinesisStreamWriterRoleArn=$dest_kin_role_arn"
done

trap "clean_up $tmp_dir" EXIT

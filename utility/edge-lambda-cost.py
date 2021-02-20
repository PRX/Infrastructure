import boto3
import pprint
from datetime import datetime, timedelta

pp = pprint.PrettyPrinter(indent=4)

DOLLARS_PER_REQUEST = 0.0000006
DOLLARS_PER_128MB_SECOND = 0.00000625125

STITCH_FUNCTION_NAME = (
    "us-east-1.infrastructure-cd-root-pr-DovetailStitchLambdaFunc-BZB7C5WUMFH6"
)
BYTES_FUNCTION_NAME = (
    "us-east-1.infrastructure-cd-root-pr-DovetailBytesLambdaFunct-18OYO33ARP2Z5"
)

functions = [STITCH_FUNCTION_NAME, BYTES_FUNCTION_NAME]

regions = [
    "us-east-2",
    "us-east-1",
    "us-west-1",
    "us-west-2",
    "ap-south-1",
    # 'ap-northeast-3',
    "ap-northeast-2",
    "ap-southeast-1",
    "ap-southeast-2",
    "ap-northeast-1",
    "ca-central-1",
    # 'cn-north-1',
    # 'cn-northwest-1',
    "eu-central-1",
    "eu-west-1",
    "eu-west-2",
    "eu-west-3",
    "eu-north-1",
    "sa-east-1",
]

date_start = datetime.today() - timedelta(hours=24)
date_end = datetime.today() - timedelta(days=0)

# date_start = datetime(2018, 12, 9)
# date_end = datetime(2018, 12, 10)

# print(date_start)
# print(date_end)

global_requests_cost = 0
global_duration_costs = 0

for function in functions:
    fn_requests_cost = 0
    fn_duration_costs = 0

    print("======================================")
    print(f"==== {function}")

    for region in regions:
        cloudwatch = boto3.client("cloudwatch", region_name=region)
        aws_lambda = boto3.client("lambda", region_name=region)

        lambda_response = aws_lambda.list_functions(
            MasterRegion="ALL", FunctionVersion="ALL"
        )

        for fn in lambda_response["Functions"]:
            if fn["FunctionName"] == function:
                memory_size = fn["MemorySize"]

        cloudwatch_response = cloudwatch.get_metric_data(
            MetricDataQueries=[
                {
                    "Id": "stitchRequests",
                    "MetricStat": {
                        "Metric": {
                            "Namespace": "AWS/Lambda",
                            "MetricName": "Invocations",
                            "Dimensions": [{"Name": "FunctionName", "Value": function}],
                        },
                        "Period": 86400,
                        "Stat": "Sum",
                        "Unit": "Count",
                    },
                },
                {
                    "Id": "stitchDuration",
                    "MetricStat": {
                        "Metric": {
                            "Namespace": "AWS/Lambda",
                            "MetricName": "Duration",
                            "Dimensions": [{"Name": "FunctionName", "Value": function}],
                        },
                        "Period": 86400,
                        "Stat": "Sum",
                        "Unit": "Milliseconds",
                    },
                },
            ],
            StartTime=date_start,
            EndTime=date_end,
        )

        # pp.pprint(cloudwatch_response['MetricDataResults'])

        requests = 0
        requests_cost = 0
        duration = 0
        duration_cost = 0

        if cloudwatch_response["MetricDataResults"][0]["Values"]:
            requests = cloudwatch_response["MetricDataResults"][0]["Values"][0]
            requests_cost = requests * DOLLARS_PER_REQUEST
            fn_requests_cost += requests_cost
            global_requests_cost += requests_cost

        if cloudwatch_response["MetricDataResults"][1]["Values"]:
            duration = cloudwatch_response["MetricDataResults"][1]["Values"][0]
            seconds = duration / 1000
            memory_factor = memory_size / 128
            duration_cost = seconds * memory_factor * DOLLARS_PER_128MB_SECOND
            fn_duration_costs += duration_cost
            global_duration_costs += duration_cost

        print(
            (
                f"{region} – Req: {requests} (${requests_cost}); "
                f"Duration: {duration}ms (${duration_cost})"
            )
        )

    print(f"======== Function total ($) {fn_requests_cost + fn_duration_costs}")

print("---------------------------------------")
print(f"Global requests cost ($) {global_requests_cost}")
print(f"Global duration cost ($) {global_duration_costs}")
print(f"Global total ($) {global_requests_cost + global_duration_costs}")

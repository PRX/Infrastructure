import boto3
import os
import json
import re
from datetime import datetime, timedelta

# Set the SNS client endpoint region based on the region of the destination topic
sns_endpoint_region = re.search(
    r"arn:aws:sns:([a-z0-9-]+)", os.environ["SLACK_MESSAGE_RELAY_SNS_TOPIC_ARN"]
).group(1)

sns = boto3.client("sns", region_name=sns_endpoint_region)
ce = boto3.client("ce")


def daily_cost_chart_url(start, end):
    cost = ce.get_cost_and_usage(
        TimePeriod={
            "Start": start.strftime("%Y-%m-%d"),
            "End": end.strftime("%Y-%m-%d"),
        },
        Granularity="DAILY",
        Metrics=[
            "UnblendedCost",
        ],
    )

    c = map(lambda c: c["Total"]["UnblendedCost"]["Amount"], cost["ResultsByTime"])
    d = ",".join(c)

    return (
        f"https://image-charts.com"
        f"/chart?cht=bvs&chs=600x90&chma=-10,0,3,-7&chds=a&chco=0089BD&chd=t:{d}"
    )


def daily_usage_cost_chart_url(start, end):
    cost = ce.get_cost_and_usage(
        TimePeriod={
            "Start": start.strftime("%Y-%m-%d"),
            "End": end.strftime("%Y-%m-%d"),
        },
        Granularity="DAILY",
        Metrics=[
            "UnblendedCost",
        ],
        Filter={
            "Not": {
                "Dimensions": {
                    "Key": "RECORD_TYPE",
                    "Values": [
                        "Refund",
                        "Credit",
                        "Upfront",
                        "Recurring",
                        "Tax",
                        "Support",
                        "SavingsPlanRecurringFee",
                        "SavingsPlanUpfrontFee",
                        "Other",
                    ],
                }
            }
        },
        # ,GroupBy=[
        #     {
        #         'Type': 'DIMENSION',
        #         'Key': 'SERVICE'
        #     }
        # ]
    )

    c = map(lambda c: c["Total"]["UnblendedCost"]["Amount"], cost["ResultsByTime"])
    d = ",".join(c)

    return (
        f"https://image-charts.com"
        f"/chart?cht=bvs&chs=600x150&chds=a&chco=0089BD&chd=t:{d}"
    )


def daily_savings_plan_coverage_chart_url(service, start, end):
    coverage_data = ce.get_savings_plans_coverage(
        TimePeriod={
            "Start": start.strftime("%Y-%m-%d"),
            "End": end.strftime("%Y-%m-%d"),
        },
        Granularity="DAILY",
        Filter={"Dimensions": {"Key": "SERVICE", "Values": [service]}},
    )

    days = coverage_data["SavingsPlansCoverages"]

    daily_coverage_rates = map(
        lambda day: str(int(float(day["Coverage"]["CoveragePercentage"]))), days
    )
    daily_uncovered_rates = map(
        lambda day: str(100 - int(float(day["Coverage"]["CoveragePercentage"]))),
        days,
    )
    d = "|".join([",".join(daily_coverage_rates), ",".join(daily_uncovered_rates)])

    return (
        f"https://image-charts.com"
        f"/chart?cht=bvs&chs=600x90&chma=-10,0,3,-7&chds=a&chco=0089BD,FF9600&chd=t:{d}"
    )


def daily_savings_plan_utilization_chart_url(service, start, end):
    utilization_data = ce.get_savings_plans_utilization(
        TimePeriod={
            "Start": start.strftime("%Y-%m-%d"),
            "End": end.strftime("%Y-%m-%d"),
        },
        Granularity="DAILY",
    )

    days = utilization_data["SavingsPlansUtilizationsByTime"]

    daily_utilization_rates = map(
        lambda day: str(int(float(day["Utilization"]["UtilizationPercentage"]))),
        days,
    )
    daily_unused_rates = map(
        lambda day: str(100 - int(float(day["Utilization"]["UtilizationPercentage"]))),
        days,
    )

    d = "|".join([",".join(daily_utilization_rates), ",".join(daily_unused_rates)])

    return (
        f"https://image-charts.com"
        f"/chart?cht=bvs&chs=600x90&chma=-10,0,3,-7&chds=a&chco=0089BD,FF9600&chd=t:{d}"
    )


def daily_reservation_coverage_chart_url(service, start, end):
    coverage_data = ce.get_reservation_coverage(
        TimePeriod={
            "Start": start.strftime("%Y-%m-%d"),
            "End": end.strftime("%Y-%m-%d"),
        },
        Granularity="DAILY",
        Filter={"Dimensions": {"Key": "SERVICE", "Values": [service]}},
    )

    days = coverage_data["CoveragesByTime"]

    daily_coverage_rates = map(
        lambda day: str(
            int(float(day["Total"]["CoverageHours"]["CoverageHoursPercentage"]))
        ),
        days,
    )

    daily_uncovered_rates = map(
        lambda day: str(
            100 - int(float(day["Total"]["CoverageHours"]["CoverageHoursPercentage"]))
        ),
        days,
    )

    d = "|".join([",".join(daily_coverage_rates), ",".join(daily_uncovered_rates)])

    return (
        f"https://image-charts.com"
        f"/chart?cht=bvs&chs=600x90&chma=-10,0,3,-7&chds=a&chco=0089BD,FF9600&chd=t:{d}"
    )


def daily_reservation_utilization_chart_url(service, start, end):
    utilization_data = ce.get_reservation_utilization(
        TimePeriod={
            "Start": start.strftime("%Y-%m-%d"),
            "End": end.strftime("%Y-%m-%d"),
        },
        Granularity="DAILY",
        Filter={"Dimensions": {"Key": "SERVICE", "Values": [service]}},
    )

    days = utilization_data["UtilizationsByTime"]

    daily_utilization_rates = map(
        lambda day: str(int(float(day["Total"]["UtilizationPercentage"]))),
        days,
    )

    daily_unused_rates = map(
        lambda day: str(100 - int(float(day["Total"]["UtilizationPercentage"]))),
        days,
    )

    d = "|".join([",".join(daily_utilization_rates), ",".join(daily_unused_rates)])

    return (
        f"https://image-charts.com"
        f"/chart?cht=bvs&chs=600x90&chma=-10,0,3,-7&chds=a&chco=0089BD,FF9600&chd=t:{d}"
    )


def lambda_handler(event, context):
    date_start = datetime.today() - timedelta(days=14)
    # End date is exclusive
    date_end = datetime.today() - timedelta(days=0)

    sns.publish(
        TopicArn=os.environ["SLACK_MESSAGE_RELAY_SNS_TOPIC_ARN"],
        Message=json.dumps(
            {
                "channel": "G9MGS7W8N",  # ops-billing
                "username": "AWS Cost Explorer",
                "icon_emoji": ":ops-costexplorer:",
                "blocks": [
                    {
                        "type": "image",
                        "title": {
                            "type": "plain_text",
                            "text": "EC2 Savings Plan Utilization",
                            "emoji": True,
                        },
                        "image_url": daily_savings_plan_utilization_chart_url(
                            "Amazon Elastic Compute Cloud - Compute",
                            date_start,
                            date_end,
                        ),
                        "alt_text": "EC2 savings plans utilization stacked bar chart",
                    },
                    {
                        "type": "image",
                        "title": {
                            "type": "plain_text",
                            "text": "EC2 Savings Plan Coverage",
                            "emoji": True,
                        },
                        "image_url": daily_savings_plan_coverage_chart_url(
                            "Amazon Elastic Compute Cloud - Compute",
                            date_start,
                            date_end,
                        ),
                        "alt_text": "EC2 savings plans coverage stacked bar chart",
                    },
                    {"type": "divider"},
                    {
                        "type": "image",
                        "title": {
                            "type": "plain_text",
                            "text": "RDS Reservations Utilization",
                            "emoji": True,
                        },
                        "image_url": daily_reservation_utilization_chart_url(
                            "Amazon Relational Database Service", date_start, date_end
                        ),
                        "alt_text": "RDS Reservations Utilization",
                    },
                    {
                        "type": "image",
                        "title": {
                            "type": "plain_text",
                            "text": "RDS Reservations Coverage",
                            "emoji": True,
                        },
                        "image_url": daily_reservation_coverage_chart_url(
                            "Amazon Relational Database Service", date_start, date_end
                        ),
                        "alt_text": "RDS Reservations Utilization",
                    },
                    {"type": "divider"},
                    {
                        "type": "image",
                        "title": {
                            "type": "plain_text",
                            "text": "ElastiCache Reservations Utilization",
                            "emoji": True,
                        },
                        "image_url": daily_reservation_utilization_chart_url(
                            "Amazon ElastiCache", date_start, date_end
                        ),
                        "alt_text": "ElastiCache Reservations Utilization",
                    },
                    {
                        "type": "image",
                        "title": {
                            "type": "plain_text",
                            "text": "ElastiCache Reservations Coverage",
                            "emoji": True,
                        },
                        "image_url": daily_reservation_coverage_chart_url(
                            "Amazon ElastiCache", date_start, date_end
                        ),
                        "alt_text": "ElastiCache Reservations Utilization",
                    },
                    {"type": "divider"},
                    {
                        "type": "image",
                        "title": {
                            "type": "plain_text",
                            "text": "Total Daily Costs (Unblended)",
                            "emoji": True,
                        },
                        "image_url": daily_cost_chart_url(
                            datetime.today() - timedelta(days=21), date_end
                        ),
                        "alt_text": "Daily unblended costs stacked bar chart",
                    },
                    {
                        "type": "image",
                        "title": {
                            "type": "plain_text",
                            "text": "Daily Usage Costs (Unblended)",
                            "emoji": True,
                        },
                        "image_url": daily_usage_cost_chart_url(
                            datetime.today() - timedelta(days=28), date_end
                        ),
                        "alt_text": "Daily usage costs stacked bar chart",
                    },
                ],
            }
        ),
    )

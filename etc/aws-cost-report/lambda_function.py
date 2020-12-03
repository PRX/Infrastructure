import boto3
import os
import json
import re
from datetime import datetime, timedelta

# Set the SNS client endpoint region based on the region of the destination topic
sns_endpoint_region = re.search(r'arn:aws:sns:([a-z0-9-]+)', os.environ['SLACK_MESSAGE_RELAY_SNS_TOPIC_ARN']).group(1)

sns = boto3.client('sns', region_name=sns_endpoint_region)
ce = boto3.client('ce')

ri_amounts = {}


def daily_savings_plan_coverage(service, start, end):
    return ce.get_savings_plans_coverage(
        TimePeriod={
            'Start': start.strftime('%Y-%m-%d'),
            'End': end.strftime('%Y-%m-%d')
        },
        Granularity='DAILY',
        Filter={
            'Dimensions': {
                'Key': 'SERVICE',
                'Values': [service]
            }
        }
    )


def daily_savings_plan_utilization(service, start, end):
    return ce.get_savings_plans_utilization(
        TimePeriod={
            'Start': start.strftime('%Y-%m-%d'),
            'End': end.strftime('%Y-%m-%d')
        },
        Granularity='DAILY'
    )


def daily_reservation_coverage(service, start, end):
    return ce.get_reservation_coverage(
        TimePeriod={
            'Start': start.strftime('%Y-%m-%d'),
            'End': end.strftime('%Y-%m-%d')
        },
        Granularity='DAILY',
        Filter={
            'Dimensions': {
                'Key': 'SERVICE',
                'Values': [service]
            }
        }
    )


def daily_reservation_utilization(service, start, end):
    return ce.get_reservation_utilization(
        TimePeriod={
            'Start': start.strftime('%Y-%m-%d'),
            'End': end.strftime('%Y-%m-%d')
        },
        Granularity='DAILY',
        Filter={
            'Dimensions': {
                'Key': 'SERVICE',
                'Values': [service]
            }
        }
    )


def ec2_savings_chart_url(start, end):
    sp_coverage = daily_savings_plan_coverage('Amazon Elastic Compute Cloud - Compute', start, end)

    o = map(lambda c: c['Coverage']['OnDemandCost'], sp_coverage['SavingsPlansCoverages'])
    s = map(lambda c: str(float(c['Coverage']['TotalCost']) - float(c['Coverage']['OnDemandCost'])), sp_coverage['SavingsPlansCoverages'])
    d = '|'.join([','.join(s), ','.join(o)])

    return f'https://image-charts.com/chart?cht=bvs&chs=600x90&chds=a&chco=0089BD,FF9600&chd=t:{d}'


def ec2_savings_utilization_chart_url(start, end):
    sp_util = daily_savings_plan_utilization('Amazon Elastic Compute Cloud - Compute', start, end)

    u = map(lambda c: c['Utilization']['UsedCommitment'], sp_util['SavingsPlansUtilizationsByTime'])
    n = map(lambda c: c['Utilization']['UnusedCommitment'], sp_util['SavingsPlansUtilizationsByTime'])
    d = '|'.join([','.join(u), ','.join(n)])

    return f'https://image-charts.com/chart?cht=bvs&chs=600x90&chds=a&chco=0089BD,FF9600&chd=t:{d}'


def rds_chart_url(start, end):
    coverage = daily_reservation_coverage('Amazon Relational Database Service', start, end)

    t = map(lambda c: c['Total']['CoverageHours']['TotalRunningHours'], coverage['CoveragesByTime'])

    o = map(lambda c: c['Total']['CoverageHours']['OnDemandHours'], coverage['CoveragesByTime'])
    r = map(lambda c: c['Total']['CoverageHours']['ReservedHours'], coverage['CoveragesByTime'])
    d = '|'.join([','.join(r), ','.join(o)])

    return f'https://image-charts.com/chart?cht=bvs&chs=600x90&chds=a&chco=0089BD,FF9600&chd=t:{d}'


def ec_chart_url(start, end):
    coverage = daily_reservation_coverage('Amazon ElastiCache', start, end)

    t = map(lambda c: c['Total']['CoverageHours']['TotalRunningHours'], coverage['CoveragesByTime'])

    o = map(lambda c: c['Total']['CoverageHours']['OnDemandHours'], coverage['CoveragesByTime'])
    r = map(lambda c: c['Total']['CoverageHours']['ReservedHours'], coverage['CoveragesByTime'])
    d = '|'.join([','.join(r), ','.join(o)])

    return f'https://image-charts.com/chart?cht=bvs&chs=600x90&chds=a&chco=0089BD,FF9600&chd=t:{d}'


def daily_cost_chart_url(start, end):
    cost = ce.get_cost_and_usage(
        TimePeriod={
            'Start': start.strftime('%Y-%m-%d'),
            'End': end.strftime('%Y-%m-%d')
        },
        Granularity='DAILY',
        Metrics=[
            'UnblendedCost',
        ]
    )

    c = map(lambda c: c['Total']['UnblendedCost']['Amount'], cost['ResultsByTime'])
    d = ','.join(c)

    return f'https://image-charts.com/chart?cht=bvs&chs=600x90&chds=a&chco=0089BD&chd=t:{d}'


def daily_usage_cost_chart_url(start, end):
    cost = ce.get_cost_and_usage(
        TimePeriod={
            'Start': start.strftime('%Y-%m-%d'),
            'End': end.strftime('%Y-%m-%d')
        },
        Granularity='DAILY',
        Metrics=[
            'UnblendedCost',
        ],
        Filter={
            'Not': {
                'Dimensions': {
                    'Key': 'RECORD_TYPE',
                    'Values': [
                        'Refund',
                        'Credit',
                        'Upfront',
                        'Recurring',
                        'Tax',
                        'Support',
                        'SavingsPlanRecurringFee',
                        'SavingsPlanUpfrontFee',
                        'Other'
                    ]
                }
            }
        }
        # ,GroupBy=[
        #     {
        #         'Type': 'DIMENSION',
        #         'Key': 'SERVICE'
        #     }
        # ]
    )

    c = map(lambda c: c['Total']['UnblendedCost']['Amount'], cost['ResultsByTime'])
    d = ','.join(c)

    return f'https://image-charts.com/chart?cht=bvs&chs=600x150&chds=a&chco=0089BD&chd=t:{d}'


def utilization_chart_url(start, end):
    ec2_util = daily_reservation_utilization('Amazon Elastic Compute Cloud - Compute', start, end)
    ec2 = map(lambda c: c['Total']['UnusedHours'], ec2_util['UtilizationsByTime'])

    rds_util = daily_reservation_utilization('Amazon Relational Database Service', start, end)
    rds = map(lambda c: c['Total']['UnusedHours'], rds_util['UtilizationsByTime'])

    ec_util = daily_reservation_utilization('Amazon ElastiCache', start, end)
    ec = map(lambda c: c['Total']['UnusedHours'], ec_util['UtilizationsByTime'])

    d = '|'.join([','.join(ec2), ','.join(rds), ','.join(ec)])

    return f'https://image-charts.com/chart?cht=bvs&chs=600x90&chds=a&chco=0089BD,FF9600,1A1A1A&chd=t:{d}'


def lambda_handler(event, context):
    date_start = datetime.today() - timedelta(days=14)
    # End date is exclusive
    date_end = datetime.today() - timedelta(days=0)

    ec2_sp_url = ec2_savings_chart_url(date_start, date_end)
    ec2_sp_util_url = ec2_savings_utilization_chart_url(date_start, date_end)
    rds_url = rds_chart_url(date_start, date_end)
    ec_url = ec_chart_url(date_start, date_end)

    utilization_url = utilization_chart_url(date_start, date_end)

    date_start = datetime.today() - timedelta(days=21)
    daily_cost_url = daily_cost_chart_url(date_start, date_end)

    date_start = datetime.today() - timedelta(days=28)
    daily_usage_url = daily_usage_cost_chart_url(date_start, date_end)

    sns.publish(
        TopicArn=os.environ['SLACK_MESSAGE_RELAY_SNS_TOPIC_ARN'],
        Message=json.dumps({
            'channel': '#ops-billing',
            'username': 'AWS Cost Explorer',
            'icon_emoji': ':aws:',
            'blocks': [
                {
                    'type': 'image',
                    'title': {
                        'type': 'plain_text',
                        'text': 'EC2 – Unreserved costs: Savings Plan (blue) vs. On-Demand (orange)',
                        'emoji': True
                    },
                    'image_url': ec2_sp_url,
                    'alt_text': 'EC2 savings plans coverage stacked bar chart'
                }, {
                    'type': 'image',
                    'title': {
                        'type': 'plain_text',
                        'text': 'EC2 – Savings Plan utilization: Used (blue) vs. Unused (orange)',
                        'emoji': True
                    },
                    'image_url': ec2_sp_util_url,
                    'alt_text': 'EC2 savings plans utilization stacked bar chart'
                }, {
                    'type': 'image',
                    'title': {
                        'type': 'plain_text',
                        'text': 'Unused reserved hours for EC2 (blue), RDS (orange) and ElastiCache (grey)',
                        'emoji': True
                    },
                    'image_url': utilization_url,
                    'alt_text': 'Unused reserved hours stacked bar chart'
                }, {
                    'type': 'image',
                    'title': {
                        'type': 'plain_text',
                        'text': 'RDS Reserved hours (blue) & On-Demand hours (orange)',
                        'emoji': True
                    },
                    'image_url': rds_url,
                    'alt_text': 'RDS reserved and on-demand comparison stacked bar chart'
                }, {
                    'type': 'image',
                    'title': {
                        'type': 'plain_text',
                        'text': 'ElastiCache Reserved hours (blue) & On-Demand hours (orange)',
                        'emoji': True
                    },
                    'image_url': ec_url,
                    'alt_text': 'ElastiCache reserved and on-demand comparison stacked bar chart'
                }, {
                    'type': 'divider'
                }, {
                    'type': 'image',
                    'title': {
                        'type': 'plain_text',
                        'text': 'Total Daily Costs (Unblended)',
                        'emoji': True
                    },
                    'image_url': daily_cost_url,
                    'alt_text': 'Daily unblended costs stacked bar chart'
                }, {
                    'type': 'image',
                    'title': {
                        'type': 'plain_text',
                        'text': 'Daily Usage Costs (Unblended)',
                        'emoji': True
                    },
                    'image_url': daily_usage_url,
                    'alt_text': 'Daily usage costs stacked bar chart'
                }
            ]
        })
    )

import boto3
import os
import json
from datetime import datetime, timedelta

sns = boto3.client('sns')
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


def ec2_savings_chart_url(start, end):
    sp_coverage = daily_savings_plan_coverage('Amazon Elastic Compute Cloud - Compute', start, end)

    o = map(lambda c: c['Coverage']['OnDemandCost'], sp_coverage['SavingsPlansCoverages'])
    s = map(lambda c: str(float(c['Coverage']['TotalCost']) - float(c['Coverage']['OnDemandCost'])), sp_coverage['SavingsPlansCoverages'])
    d = '|'.join([','.join(s), ','.join(o)])

    return f'https://image-charts.com/chart?cht=bvs&chs=600x90&chds=a&chco=0089BD,FF9600&chd=t:{d}'


def ec2_chart_url(start, end):
    ri_coverage = daily_reservation_coverage('Amazon Elastic Compute Cloud - Compute', start, end)

    t = map(lambda c: c['Total']['CoverageHours']['TotalRunningHours'], ri_coverage['CoveragesByTime'])

    o = map(lambda c: c['Total']['CoverageHours']['OnDemandHours'], ri_coverage['CoveragesByTime'])
    r = map(lambda c: c['Total']['CoverageHours']['ReservedHours'], ri_coverage['CoveragesByTime'])
    d = '|'.join([','.join(r), ','.join(o)])

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


def lambda_handler(event, context):
    date_start = datetime.today() - timedelta(days=14)
    # End date is exclusive
    date_end = datetime.today() - timedelta(days=0)
    print(date_end)

    ec2_url = ec2_chart_url(date_start, date_end)
    ec2_sp_url = ec2_savings_chart_url(date_start, date_end)
    rds_url = rds_chart_url(date_start, date_end)
    ec_url = ec_chart_url(date_start, date_end)

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
                        'text': 'EC2 Total costs less on-demand (blue) & On-Demand costs (orange)',
                        'emoji': True
                    },
                    'image_url': ec2_sp_url,
                    'alt_text': 'EC2 savings plans comparison stacked bar chart'
                }, {
                    'type': 'image',
                    'title': {
                        'type': 'plain_text',
                        'text': 'EC2 Reserved hours (blue) & On-Demand hours (orange)',
                        'emoji': True
                    },
                    'image_url': ec2_url,
                    'alt_text': 'EC2 reserved and on-demand comparison stacked bar chart'
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

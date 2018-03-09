# TODO WIP this is meant to find discrepencies between the stack templates that
# are deployed to CloudFormation and what is checked in, and do some other
# basic sanity checks on the stacks and their configurations

import boto3

client = boto3.client('cloudformation')

response = client.describe_stacks()

map = {
    'cd': ['infrastructure-cd', '../cd/cd.yaml'],
    'ci': ['infrastructure-ci', '../ci/ci.yml'],
    'notifications': ['infrastructure-notifications', '../notifications/notifications.yml'],
    'secrets': ['infrastructure-secrets', '../secrets/secrets.yml'],
    'storage': ['infrastructure-storage', '../storage/storage.yml'],
    'radiotopia-com': ['hostedzone-radiotopia-com', '../dns/radiotopia.com-hosted_zone.yml'],
    'radiotopia-fm': ['hostedzone-radiotopia-fm', '../dns/radiotopia.fm-hosted_zone.yml'],
    'prxu-org': ['hostedzone-prxu-org', '../dns/prxu.org-hosted_zone.yml'],
    'prx-mx': ['hostedzone-prx-mx', '../dns/prx.mx-hosted_zone.yml'],
    'prx-org': ['hostedzone-prx-org', '../dns/prx.org-hosted_zone.yml'],
    'cdn-radiotopia-plus': ['cdn-radiotopia-plus', '../cdn/feed-cdn.yml'],
    'dt-stag': ['cloudfront-dovetail-cdn-staging', '../cdn/dovetail-cdn.yml'],
    'dt-prod': ['cloudfront-dovetail-cdn-production', '../cdn/dovetail-cdn.yml'],
}

for key in map:
    res = client.get_template(StackName=map[key][0])
    remote = res['TemplateBody']

    local = open(map[key][1], "r").read()

    if not local == remote:
        print(f"MISMATCH: {key}")
    else:
        print(f"match: {key}")









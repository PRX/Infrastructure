# TODO WIP this is meant to find discrepencies between the stack templates that
# are deployed to CloudFormation and what is checked in, and do some other basic
# sanity checks on the stacks and their configurations

import boto3

client = boto3.client('cloudformation')

response = client.describe_stacks()
for stack in response['Stacks']:
    print(f"{stack['StackName']} {stack['NotificationARNs']}")


# map = {
#     'cd': ['infrastructure-cd', '../ci/ci.yml'],
#     'ci': ['infrastructure-ci', '../cd/cd.yaml'],
#     'notifications': ['infrastructure-notifications', '../notifications/notifications.yml'],
#     'secrets': ['infrastructure-secrets', '../secrets/secrets.yml'],
#     'storage': ['infrastructure-storage', '../storage/storage.yml'],
# }

# for key in map:
#     response = client.get_template(StackName=map[key][0])
#     remote = response['TemplateBody']

#     local = open(map[key][1], "r").read()

#     if not local == remote:
#         print(f"mismatch {key}")









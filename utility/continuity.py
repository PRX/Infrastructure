# TODO WIP this is meant to find discrepencies between the stack templates that
# are deployed to CloudFormation and what is checked in, and do some other
# basic sanity checks on the stacks and their configurations

import boto3
import re

cloudformation = boto3.client('cloudformation')

stacks = cloudformation.describe_stacks()

# Stack Notifications
# Examines all stacks to ensure they have the shared CloudFormation
# notification SNS topic configured as a notification ARN

cfn_topic = 'arn:aws:sns:us-east-1:561178107736:infrastructure-notifications-CloudFormationNotificationSnsTopic-2OCAWQM7S7BP'

print("======================================================================")
print(f"These stacks do NOT include the notification ARN:")
for stack in stacks['Stacks']:
    if cfn_topic not in stack['NotificationARNs']:
        print(f"{stack['StackName']}")


# Template continuity
# Compares the template for certain stacks, as they exist in CloudFormation,
# to your local copy. If you are on master these should not have any
# differences. The first line each template should contain a relative path
# to the file in the Infrastructure repo. If that path appears to be missing,
# this will report a warning

print("======================================================================")
for stack in stacks['Stacks']:
    cfn_template = cloudformation.get_template(StackName=stack['StackName'])
    cfn_body = cfn_template['TemplateBody']

    cfn_first_line = cfn_body.split('\n', 1)[0]
    if re.match(r"\# ([a-zA-Z/_\-\.]+yml)", cfn_first_line) is None:
        print(f"Missing template path: {stack['StackName']}")
    else:
        template_path = re.findall(r'\# ([a-zA-Z/_\-\.]+yml)', cfn_first_line)[0]

        local_path = f"../{template_path}"

        try:
            local_body = open(local_path, "r").read()
        except FileNotFoundError:
            print(f"File error: {stack['StackName']}")

        if not local_body == cfn_body:
            print(f"Template mismatch: {stack['StackName']}")

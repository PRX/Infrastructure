import boto3
import pprint

pp = pprint.PrettyPrinter(indent=4)

session = boto3.Session(region_name="us-east-1", profile_name="prx-legacy")
cloudformation = session.client("cloudformation")


def all_stacks(next_token=False):
    stacks = []

    if next_token:
        resp = cloudformation.describe_stacks(NextToken=next_token)
    else:
        resp = cloudformation.describe_stacks()

    stacks = stacks + resp["Stacks"]

    if "NextToken" in resp:
        more_stacks = all_stacks(next_token=resp["NextToken"])
        stacks = stacks + more_stacks

    return stacks


stacks = all_stacks()

# stacks = cloudformation.describe_stacks()

old_east_topic = "arn:aws:sns:us-east-1:561178107736:infrastructure-notifications-CloudFormationNotificationSnsTopic-2OCAWQM7S7BP"
# old_west_topic = "arn:aws:sns:us-west-2:561178107736:infrastructure-notifications-CloudFormationNotificationSnsTopic-V0V6R4GCC6PB"

new_east_topic = "arn:aws:sns:us-east-1:578003269847:StackSet-regional-cloudformation-notification-topics-ab259fcb-8a7e-4251-ad41-5ee55dbc65ed-CloudFormationNotificationsSnsTopic-FO6UHHCE92V1"
# new_west_topic = "arn:aws:sns:us-west-2:578003269847:StackSet-regional-cloudformation-notification-topics-141ca10f-57ec-48f4-b953-a89382294382-CloudFormationNotificationsSnsTopic-1XY4PUFA0BC8W"

print("======================================================================")
print("These stacks use the legacy notification ARN:")
for stack in stacks:
    if old_east_topic in stack["NotificationARNs"]:
        if stack["StackName"].startswith("xxinfrastructure-cd-root-s"):
            pass
        else:
            pp.pprint(stack["StackName"])
            # pp.pprint(stack)

            capabilities = []
            parameters = []
            tags = []

            if "Capabilities" in stack:
                capabilities = stack["Capabilities"]
            if "Parameters" in stack:
                parameters = stack["Parameters"]

                for parameter in parameters:
                    parameter.pop("ParameterValue")
                    parameter["UsePreviousValue"] = True

            if "Tags" in stack:
                tags = stack["Tags"]

            # res = cloudformation.update_stack(
            #     StackName=stack["StackName"],
            #     UsePreviousTemplate=True,
            #     Parameters=parameters,
            #     Capabilities=capabilities,
            #     NotificationARNs=[new_east_topic],
            #     Tags=tags,
            # )

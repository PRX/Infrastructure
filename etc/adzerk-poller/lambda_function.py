import os
import json
import boto3
import datetime
import urllib.request
import re

sns = boto3.client("sns")

SLACK_ICON = ":adzerk:"
SLACK_USERNAME = "Adzerk"
SLACK_CHANNEL = "#ad-ops-adzerk-flights"
SLACK_CHANNEL_PROBLEMS = "#ad-ops-flight-problems"

ADZERK_REQUEST_HEADERS = {"X-Adzerk-ApiKey": os.environ["ADZERK_API_KEY"]}


def slack_attachments(flights):
    attachments = []

    for flight in flights:
        fields = []

        fields.append(
            {"title": "StartDate", "value": flight["StartDate"], "short": True}
        )

        if "LifetimeCapAmount" in flight and flight["LifetimeCapAmount"]:
            fields.append(
                {
                    "title": "LifetimeCapAmount",
                    "value": flight["LifetimeCapAmount"],
                    "short": True,
                }
            )

        if "EndDate" in flight and flight["EndDate"]:
            fields.append(
                {"title": "EndDate", "value": flight["EndDate"], "short": True}
            )

        attachments.append({"title": flight["Name"], "fields": fields})

    return attachments


# Finds all active flights starting tomorrow, and sends a message to Slack
# with their details
def upcoming_flight_report():
    flights = []
    # problem_flights = []

    t1 = datetime.datetime.utcnow() + datetime.timedelta(days=0)
    t2 = datetime.datetime.utcnow() + datetime.timedelta(days=2)

    s1 = t1.strftime("%Y-%m-%d%%2023:59:59")
    s2 = t2.strftime("%Y-%m-%d%%2000:00:00")

    api_url = (
        "https://api.adzerk.net"
        f"/v1/fast/flight?isActive=true&afterStartDate={s1}&beforeStartDate={s2}"
    )

    print(f"Filter flights for {s1} – {s2}")

    flight_filter_req = urllib.request.Request(api_url, headers=ADZERK_REQUEST_HEADERS)
    with urllib.request.urlopen(flight_filter_req) as response:
        response_data = response.read()

    # The response is a line-delimited set of JSON flight objects
    for json_str in response_data.decode("utf-8").split("\n"):
        if len(json_str) > 1:
            flight_data = json.loads(json_str)
            flights.append(flight_data)

            # if 'EndDate' in flight_data and flight_data['EndDate']:
            #     if not flight_data['EndDate'].endswith('59:00Z'):
            #         problem_flights.append(flight_data)

    print(f"Found {len(flights)} flights for this period")
    # print(f"Found {len(problem_flights)} problem flights for this period")

    if len(flights) > 0:
        sns.publish(
            TopicArn=os.environ["SLACK_MESSAGE_RELAY_SNS_TOPIC_ARN"],
            Message=json.dumps(
                {
                    "channel": SLACK_CHANNEL,
                    "username": SLACK_USERNAME,
                    "icon_emoji": SLACK_ICON,
                    "attachments": slack_attachments(flights),
                }
            ),
        )


def problem_flight_report():
    flights = []
    problem_flights = []

    t1 = datetime.datetime.utcnow() + datetime.timedelta(days=-28)
    s1 = t1.strftime("%Y-%m-%d%%2023:59:59")

    api_url = f"https://api.adzerk.net/v1/fast/flight?isActive=true&afterStartDate={s1}"

    flight_filter_req = urllib.request.Request(api_url, headers=ADZERK_REQUEST_HEADERS)
    with urllib.request.urlopen(flight_filter_req) as response:
        response_data = response.read()

    # The response is a line-delimited set of JSON flight objects
    for json_str in response_data.decode("utf-8").split("\n"):
        if len(json_str) > 1:
            flight_data = json.loads(json_str)
            flights.append(flight_data)

            if "EndDate" in flight_data and flight_data["EndDate"]:
                if not flight_data["EndDate"].endswith("55:00Z") and not flight_data[
                    "EndDate"
                ].endswith("59:00Z"):
                    problem_flights.append(flight_data)

    print(f"Found {len(flights)} active flights")
    print(f"Found {len(problem_flights)} problem flights for this period")

    if len(problem_flights) > 0:
        attachments = slack_attachments(problem_flights)
        for attachment in attachments:
            attachment["color"] = "danger"

        sns.publish(
            TopicArn=os.environ["SLACK_MESSAGE_RELAY_SNS_TOPIC_ARN"],
            Message=json.dumps(
                {
                    "channel": SLACK_CHANNEL_PROBLEMS,
                    "username": SLACK_USERNAME,
                    "icon_emoji": SLACK_ICON,
                    "text": (
                        ":warning: Yikes! These flights have problems :rotating_light:"
                    ),
                }
            ),
        )

        sns.publish(
            TopicArn=os.environ["SLACK_MESSAGE_RELAY_SNS_TOPIC_ARN"],
            Message=json.dumps(
                {
                    "channel": SLACK_CHANNEL_PROBLEMS,
                    "username": SLACK_USERNAME,
                    "icon_emoji": SLACK_ICON,
                    "attachments": attachments,
                }
            ),
        )


def lambda_handler(event, context):
    print(event)

    # Set the default behavior, by pretending this is the Hourly rule
    rule_arn = "Hourly"

    if "resources" in event:
        rule_arn = event["resources"][0]

    if re.search(r"Daily", rule_arn):
        upcoming_flight_report()
    elif re.search(r"Hourly", rule_arn):
        problem_flight_report()

import boto3

boto3.setup_default_session(profile_name="prx-legacy")
client = boto3.client("route53")


# List the FTP subdomains that should have explicit DNS records added
subdomains = [
    "wxyz",
]

changes = []

name = "infra-FtpSe-1W1OF5U4X8M3Z-284373e0ff42a3aa.elb.us-east-1.amazonaws.com"

for subdomain in subdomains:
    changes.append(
        {
            "Action": "UPSERT",
            "ResourceRecordSet": {
                "Name": f"{subdomain}.prxtransfer.org",
                "Type": "A",
                "AliasTarget": {
                    "HostedZoneId": "Z26RNL4JYFTOTI",
                    "DNSName": name,
                    "EvaluateTargetHealth": False,
                },
            },
        }
    )

client.change_resource_record_sets(
    HostedZoneId="Z2DOBCW7CSO5EP",
    ChangeBatch={"Changes": changes},
)

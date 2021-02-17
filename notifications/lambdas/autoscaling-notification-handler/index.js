// Invoked by: SNS Subscription
// Returns: Error or status message
//
// Receives notifications from an EC2 auto scaling group when instances launch
// or are terminated. The messages are sent to the Slack Message Relay SNS topic
// in order to be sent to Slack.

const AWS = require('aws-sdk');

const sns = new AWS.SNS({ apiVersion: '2010-03-31' });

const SLACK_CHANNEL = '#ops-debug';
const SLACK_ICON = ':ops-autoscaling:';
const SLACK_USERNAME = 'AWS Auto Scaling';

function color(scaling) {
    if (/EC2_INSTANCE_TERMINATE/.test(scaling.Event)) {
        return '#FF8400';
    }

    return '#0099FF';
}

exports.handler = async (event) => {
    const scaling = JSON.parse(event.Records[0].Sns.Message);

    if (scaling.Event !== 'autoscaling:TEST_NOTIFICATION') {
        await sns.publish({
            TopicArn: process.env.SLACK_MESSAGE_RELAY_TOPIC_ARN,
            Message: JSON.stringify({
                channel: SLACK_CHANNEL,
                username: SLACK_USERNAME,
                icon_emoji: SLACK_ICON,
                attachments: [
                    {
                        fallback: scaling.Cause,
                        color: color(scaling),
                        author_name: scaling.AutoScalingGroupName,
                        title: scaling.Event,
                        text: scaling.Cause,
                        footer: scaling.Details['Availability Zone'],
                        ts: Math.floor(Date.now() / 1000),
                    },
                ],
            }),
        }).promise();
    }
};

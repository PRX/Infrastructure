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
const SLACK_USERNAME = 'EC2 Auto Scaling';

function colorForAutoScaling(scaling) {
    if (/EC2_INSTANCE_TERMINATE/.test(scaling.Event)) {
        return '#FF8400';
    }

    return '#0099FF';
}

function messageForEvent(event) {
    const scaling = JSON.parse(event.Records[0].Sns.Message);

    return {
        channel: SLACK_CHANNEL,
        username: SLACK_USERNAME,
        icon_emoji: SLACK_ICON,
        attachments: [
            {
                fallback: scaling.Cause,
                color: colorForAutoScaling(scaling),
                author_name: scaling.AutoScalingGroupName,
                title: scaling.Event,
                text: scaling.Cause,
                footer: scaling.Details['Availability Zone'],
                ts: Math.floor(Date.now() / 1000),
            },
        ],
    };
}

function main(event, context, callback) {
    const message = messageForEvent(event);

    const messageJson = JSON.stringify(message);

    sns.publish({
        TopicArn: process.env.SLACK_MESSAGE_RELAY_TOPIC_ARN,
        Message: messageJson,
    }, (err) => {
        if (err) {
            callback(err);
        } else {
            callback(null);
        }
    });
}

exports.handler = (event, context, callback) => {
    try {
        main(event, context, callback);
    } catch (e) {
        callback(e);
    }
};

// Invoked by: SNS Subscription
// Returns: Error or status message
//
// tktk

const AWS = require('aws-sdk');

const sns = new AWS.SNS({ apiVersion: '2010-03-31' });

// const SLACK_CHANNEL = '#ops-debug';
const SLACK_ICON = ':ops-cloudwatch-alarm:';
const SLACK_USERNAME = 'Amazon CloudWatch Alarms';

function colorForAlarm(alarm) {
    switch (alarm.NewStateValue) {
        case 'ALARM':
            return '#cc0000';
        case 'OK':
            return '#019933';
        default:
            return '#e07701';
    }
}

function messageForEvent(event) {
    const alarm = JSON.parse(event.Records[0].Sns.Message);
    const trigger = alarm.Trigger;

    return {
        channel: SLACK_CHANNEL, // TODO
        username: SLACK_USERNAME,
        icon_emoji: SLACK_ICON,
        attachments: [
            {
                fallback: `${alarm.NewStateValue} – ${alarm.AlarmName}`,
                color: colorForAlarm(alarm),
                author_name: `${trigger.Namespace}`,
                title: `${alarm.NewStateValue} – ${alarm.AlarmName}`,

                text: `${trigger.MetricName}: ${alarm.NewStateReason}`,
                footer: alarm.Region,
                ts: Math.floor(Date.parse(alarm.StateChangeTime) / 1000),
                fields: [
                    {
                        title: 'Evaluation',
                        value: `${trigger.Statistic} – ${trigger.EvaluationPeriods} × ${trigger.Period}`,
                        short: true,
                    }, {
                        title: 'Threshold',
                        value: trigger.Threshold,
                        short: true,
                    },
                ],
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

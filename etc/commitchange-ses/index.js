const AWS = require('aws-sdk');

const sns = new AWS.SNS({ apiVersion: '2010-03-31' });
const s3 = new AWS.S3({ apiVersion: '2006-03-01' });

const SLACK_ICON = ':commitchange:';
const SLACK_USERNAME = 'CommitChange';

function getCount(file) {
    return new Promise((resolve, reject) => {
        s3.getObject({
            Bucket: 'farski-sandbox-prx',
            Key: file,
        }, (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(+data.Body.toString('utf8'));
            }
        });
    });
}

exports.handler = async (event) => {
    const message = JSON.parse(event.Records[0].Sns.Message);
    // message has: notificationType, receipt, mail, content
    // https://docs.aws.amazon.com/ses/latest/DeveloperGuide/receiving-email-notifications-contents.html

    const { content } = message;
    const { commonHeaders } = message.mail;

    const { subject } = commonHeaders;

    const name = subject.match(/receipt for (.*)/)[1];
    const amount = content.match(/\$([0-9,]+)/)[1];
    const isRecurring = content.includes('Every 1 month');

    const file = process.env.COUNTER_FILE_OBJECT_KEY;

    const oldCount = await getCount(file);
    const newCount = oldCount + 1;

    await s3.putObject({
        Body: `${newCount}`,
        Bucket: 'farski-sandbox-prx',
        Key: file,
    }).promise();

    let icon = '';
    if (+amount >= 1000) {
        icon = ':rotating_light::moneybag::rotating_light:';
    } else if (+amount >= 250) {
        icon = ':moneybag::moneybag:';
    } else if (+amount >= 100) {
        icon = ':moneybag:';
    }

    const text = `${icon}#${newCount} – ${name || 'Anonymous'}: $${amount} ${isRecurring ? '(monthly) :calendar:' : ''}`;

    if (content.includes(process.env.ACTIVE_CAMPAIGN_NAME)) {
        await sns.publish({
            TopicArn: process.env.SLACK_MESSAGE_RELAY_TOPIC_ARN,
            Message: JSON.stringify({
                channel: process.env.DESTINATION_SLACK_CHANNEL,
                username: SLACK_USERNAME,
                icon_emoji: SLACK_ICON,
                text,
            }),
        }).promise();
    }
};

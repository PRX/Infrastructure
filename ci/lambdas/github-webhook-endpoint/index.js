// Invoked by: API Gateway
// Returns: Error, or API Gateway proxy response object
//
// Handles GitHub webhook event payload requests. It does a bit of validation on
// the request, and then forwards the payload to an SNS topic, where other
// Lambdas will pick it up and process the event.

const crypto = require('crypto');
const AWS = require('aws-sdk');

const OK_RESPONSE = { statusCode: 200, headers: {}, body: null };

const sns = new AWS.SNS({ apiVersion: '2010-03-31' });

function publishEvent(event) {
    console.log('Publishing event to SNS');

    return sns.publish({
        TopicArn: process.env.GITHUB_EVENT_HANDLER_TOPIC_ARN,
        Message: event.isBase64Encoded
            ? Buffer.from(event.body, 'base64').toString('utf-8')
            : event.body,
        MessageAttributes: {
            githubEvent: {
                DataType: 'String',
                StringValue: event.headers['x-github-event'],
            },
            githubDeliveryId: {
                DataType: 'String',
                StringValue: event.headers['x-github-delivery'],
            },
        },
    }).promise();
}

exports.handler = async (event) => {
    const githubSignature = event.headers['x-hub-signature'].split('=')[1];

    console.log(`Checking event signature: ${githubSignature}`);

    const key = process.env.GITHUB_WEBHOOK_SECRET;
    const data = event.body;
    const check = crypto.createHmac('sha1', key).update(data).digest('hex');

    if (githubSignature !== check) {
        throw new Error('Invalid signature!');
    }

    console.log(`Handling event: ${event.headers['x-github-event']}`);

    switch (event.headers['x-github-event']) {
        case 'ping':
            // Blackhole `ping` events
            break;
        default:
            await publishEvent(event);
    }

    return OK_RESPONSE;
};

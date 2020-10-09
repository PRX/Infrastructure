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

function publishEvent(event, callback) {
    console.log('...Publishing event to SNS...');

    const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf-8') : event.body;

    sns.publish({
        TopicArn: process.env.GITHUB_EVENT_HANDLER_TOPIC_ARN,
        Message: body,
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
    }, (err) => {
        if (err) {
            console.error('...Publishing event failed!');
            callback(err);
        } else {
            console.log('...Event published!');
            callback(null, OK_RESPONSE);
        }
    });
}

function handleEvent(event, callback) {
    console.log(`...Handling event: ${event.headers['x-github-event']}...`);
    switch (event.headers['x-github-event']) {
        case 'ping':
            // Blackhole `ping` events
            callback(null, OK_RESPONSE);
            break;
        default:
            publishEvent(event, callback);
    }
}

function main(event, context, callback) {
    const githubSignature = event.headers['x-hub-signature'].split('=')[1];

    console.log(`Checking event signature: ${githubSignature}...`);

    const key = process.env.GITHUB_WEBHOOK_SECRET;
    const data = event.body;
    const check = crypto.createHmac('sha1', key).update(data).digest('hex');

    if (githubSignature === check) {
        handleEvent(event, callback);
    } else {
        // Raising an error here so it's visible if we start getting requests
        // that aren't valid.
        console.error('...Request signature was invalid!');
        callback(new Error('Invalid signature!'));
    }
}

exports.handler = (event, context, callback) => {
    try {
        main(event, context, callback);
    } catch (e) {
        console.error('Unhandled exception!');
        callback(e);
    }
};

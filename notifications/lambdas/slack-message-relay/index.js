// Invoked by: SNS Subscription
// Returns: Error or status message
//
// Recieves messages from an SNS topic subscription that contain preformed Slack
// message payloads (as JSON data). Makes a request to a Slack Incoming Webhook
// URL (also provided by the SNS message) with the payload.
//
// This is a very simple function, and should not make any decisions about where
// to send messages. It is just a relay. The `Message` value of the Sns object
// should not be parsed or processed.

const url = require('url');
const https = require('https');

exports.handler = (event, context, callback) => {
    try {
        const sns = event.Records[0].Sns;

        const attrs = sns.MessageAttributes;

        let webhookUrl = process.env['DEFAULT_WEBHOOK_URL'];
        if (attrs.WebhookURL) {
          webhookUrl = attrs.WebhookURL.Value;
        }

        // Setup request options
        const options = url.parse(webhookUrl);
        options.method = 'POST';
        options.headers = {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(sns.Message),
        };

        const req = https.request(options, (res) => {
            res.setEncoding('utf8');

            res.on('end', () => {
                if (res.statusCode < 400) {
                    callback(null, 'Slack message sent');
                } else if (res.statusCode < 500) {
                    callback(new Error('Slack client Error'));
                } else {
                    callback(new Error('Slack server Error'));
                }
            });
        });

        // Generic request error handling
        req.on('error', e => callback(e));

        req.write(sns.Message);
        req.end();
    } catch (e) {
        callback(e);
    }
};

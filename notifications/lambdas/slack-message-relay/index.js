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

const https = require('https');

exports.handler = (event, context, callback) => {
    try {
        const sns = event.Records[0].Sns;
        console.log(JSON.stringify({
            "SNS MessageId": sns.MessageId,
            "Slack channel": JSON.parse(sns.Message).channel
        }));

        const attrs = sns.MessageAttributes;

        let webhookUrl = process.env.DEFAULT_WEBHOOK_URL;
        if (attrs.WebhookURL) {
            webhookUrl = attrs.WebhookURL.Value;
        }

        const q = new URL(webhookUrl);

        // Setup request options
        const options = {
            host: q.host,
            port: q.port,
            path: `${q.pathname || ''}${q.search || ''}`,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(sns.Message),
            },
            method: 'POST',
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

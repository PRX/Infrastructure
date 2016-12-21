'use strict';

const url     = require('url');
const https   = require('https');

const postPayload = (payload, callback) => {
    const body = JSON.stringify(payload);

    const options = url.parse(process.env.SLACK_WEBHOOK_URL);
    options.method = 'POST';
    options.headers = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
    };

    let postReq = https.request(options, res => {
        let chunks = [];

        res.setEncoding('utf8');
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
            const resBody = chunks.join('');
            if (callback) {
                callback({
                    body: resBody,
                    statusCode: res.statusCode,
                    statusMessage: res.statusMessage
                });
            }
        });

        return res;
    });

    postReq.write(body);
    postReq.end();
};

const payloadForEvent = event => {
    return {
        channel: '#ops-debug',
        attachments: [{
          title: 'title',
          text: 'text'
        }]
    };
};

const processEvent = (event, context, callback) => {
    postPayload(payloadForEvent(event), response => {
        if (response.statusCode < 400) {
            console.info(`Message posted successfully`);
            callback();
        } else if (response.statusCode < 500) {
            console.error(`Error posting message to Slack API: ${response.statusCode} - ${response.statusMessage}`);
            callback();  // Don't retry because the error is due to a problem with the request, not Slack
        } else {
            // Let Lambda retry
            const msg = `Server error when processing message: ${response.statusCode} - ${response.statusMessage}`;
            callback(new Error(msg));
        }
    });
};

exports.handler = (event, context, callback) => {
    try {
        processEvent(event, context, callback);
    } catch (e) {
        callback(e);
    }
};

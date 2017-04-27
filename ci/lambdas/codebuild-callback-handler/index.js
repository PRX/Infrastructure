// Invoked by: SNS Subscription
// Returns: Error or status message
//
// Triggered after a CodeBuild run finishes and is responsible for updating
// the GitHub status, and sending some notifications.

const url = require('url');
const https = require('https');
const AWS = require('aws-sdk');

const sns = new AWS.SNS({apiVersion: '2010-03-31'});

const USER_AGENT = 'PRX/Infrastructure (codebuil-callback-handler)';
const GITHUB_HEADERS = {
    'Authorization': `token ${process.env.GITHUB_ACCESS_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': USER_AGENT
};

exports.handler = (event, context, callback) => {
    try {
        main(event, context, callback);
    } catch(e) {
        console.error('Unhandled exception!');
        callback(e);
    }
};

function main(event, context, callback) {
    const callbackObj = JSON.parse(event.Records[0].Sns.Message);

    const status = updateGitHubStatus(callbackObj);
    const notification = postNotification(callbackObj);

    Promise.all([status, notification])
        .then(() => callback(null))
        .catch(e => callback(e));
}

// Note: The response to this request should be a 201
// https://developer.github.com/v3/repos/statuses/#create-a-status
function updateGitHubStatus(data) {
    return (new Promise((resolve, reject) => {
        console.log(`...Updating GitHub status...`);

        // Get request properties
        const api = 'api.github.com';
        const repo = data.prxRepo;
        const sha = data.prxCommit;

        const arn = data.buildArn;
        const region = arn.split(':')[3];
        const buildId = arn.split('/')[1];
        const buildUrl = `https://${region}.console.aws.amazon.com/codebuild/home#/builds/${buildId}/view/new`;

        const payload = {
            state: data.success ? 'success' : 'failure',
            target_url: buildUrl,
            description: data.success ? 'Build complete' : data.reason,
            context: 'continuous-integration/prxci'
        };
        const json = JSON.stringify(payload);

        // Setup request options
        const apiUrl = `https://${api}/repos/${repo}/statuses/${sha}`;
        const options = url.parse(apiUrl);
        options.method = 'POST';
        options.headers = GITHUB_HEADERS;
        options.headers['Content-Length'] = Buffer.byteLength(json);

        // Request with response handler
        console.log(`...Calling statuses API: ${apiUrl}...`);
        let req = https.request(options, res => {
            res.setEncoding('utf8');

            let json = '';
            res.on('data', chunk => json += chunk);
            res.on('end', () => {
                switch (res.statusCode) {
                    case 201:
                        console.log('...GitHub status updated...');
                        resolve();
                        break;
                    default:
                        console.error('...GitHub status update failed...');
                        console.error(`...HTTP ${res.statusCode}...`);
                        console.error(json);
                        reject(new Error('GitHub status update failed!'));
                }
            });
        });

        // Generic request error handling
        req.on('error', e => reject(e));

        req.write(json);
        req.end();
    }));
}

function postNotification(data) {
    return (new Promise((resolve, reject) => {
        console.log(`...Posting build status notification...`);

        sns.publish({
            TopicArn: process.env.CI_STATUS_TOPIC_ARN,
            Message: JSON.stringify({ callback: data })
        }, (err, data) => {
            if (err) {
                console.error('...Status notification posted...');
                reject(e);
            } else {
                console.log('...Status notification posted...');
                resolve();
            }
        });
    }));
}

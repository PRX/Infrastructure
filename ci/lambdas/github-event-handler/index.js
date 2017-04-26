// Invoked by: SNS Subscription
// Returns: Error or status message
//
// Handles GitHub events that have been forwarded from the webhook endpoint.
// This function handles the start of the build process for master branches and
// pull requests (for repositories that are designed to work with CodeBuild).
// Broadly, it does the following:
// 1. Check to make sure this event should trigger a build
// 2. Trigger a CodeBuild with the current code
// 3. Send a notification that the build is starting (for Slack/etc)
// 4. Set the GitHub status to 'pending' for the sha

const url = require('url');
const https = require('https');
const AWS = require('aws-sdk');

const codebuild = new AWS.CodeBuild({apiVersion: '2016-10-06'});
const sns = new AWS.SNS({apiVersion: '2010-03-31'});

const USER_AGENT = 'PRX/Infrastructure (github-event-handler)';

exports.handler = (event, context, callback) => {
    try {
        main(event, context, callback);
    } catch(e) {
        console.error('Unhandled exception!');
        callback(e);
    }
};

function main(event, context, callback) {
    const messageAttributes = event.Records[0].Sns.MessageAttributes;
    const githubEvent = messageAttributes.githubEvent.Value;
    const githubDeliveryId = messageAttributes.githubDeliveryId.Value;

    const json = event.Records[0].Sns.Message;
    const payload = JSON.parse(json);

    console.log(`Received message for event: ${githubEvent}...`);

    switch (githubEvent) {
        case 'push':
            handlePushEvent(payload, callback);
            break;
        case 'pull_request':
            handlePullRequestEvent(payload, callback);
            break;
        default:
            console.log('...Ignoring this event type!');
            callback(null);
    }
}

// Push events will get delivered for any branch. For pushes to pull requests,
// there will be an additional `pull_request` event that we will use to trigger
// the build, so this only needs to proceed if the event is for the master
// branch.
// https://developer.github.com/v3/activity/events/types/#pushevent
function handlePushEvent(event, callback) {
    console.log('...Handling push event...');

    if (event.ref !== 'refs/heads/master') {
        // Blackhole all push events not on master
        console.log('...Ignoring this push!');
        callback(null);
    } else {
        console.log('...Push event was for master branch...');
        checkCodeBuildSupport(event, callback);
    }
}

// We'll want to trigger a build when a pull request is: 'opened', 'reopened',
// or 'synchronized'
// https://developer.github.com/v3/activity/events/types/#pullrequestevent
function handlePullRequestEvent(event, callback) {
    console.log('...Handling pull_request event...');

    const action = event.action;
    const triggers = ['opened', 'reopened', 'synchronize'];

    if (triggers.indexOf(action) === -1) {
        // Blackhole events that aren't code changes
        console.log('...Ignoring this pull request action!');
        callback(null);
    } else {
        console.log(`...With action: ${action}...`);
        checkCodeBuildSupport(event, callback);
    }
}

// Hits the GitHub contents API to determine if the commit that triggered this
// event supports the PRX CI system, by looking for a .prxci file
// https://developer.github.com/v3/repos/contents/#get-contents
function checkCodeBuildSupport(event, callback) {
    console.log(`...Checking for CodeBuild support...`);

    // Get request properties
    const api = 'api.github.com';
    const repo = event.repository.full_name;
    const path = '.prxci';
    const ref = event.after || event.pull_request.head.sha;

    // Setup request options
    const apiUrl = `https://${api}/repos/${repo}/contents/${path}?ref=${ref}`;
    const options = url.parse(apiUrl);
    options.method = 'GET';
    options.headers = {
        'Authorization': `token ${process.env.GITHUB_ACCESS_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': USER_AGENT
    };

    // Request with response handler
    console.log(`...Calling contents API: ${apiUrl}...`);
    let req = https.request(options, res => {
        res.setEncoding('utf8');

        let json = '';
        res.on('data', chunk => json += chunk);
        res.on('end', () => {
            switch (res.statusCode) {
                case 200:
                    console.log('...Found CodeBuild support...');
                    triggerBuild(event, callback);
                    break;
                case 404:
                    console.log('...No CodeBuild support!');
                    callback(null);
                    break;
                default:
                    console.error(`...Request failed ${res.statusCode}!`);
                    console.error(json);
                    callback(new Error('Contents request failed!'));
            }
        });
    });

    // Generic request error handling
    req.on('error', e => callback(e));

    req.write('');
    req.end();
}

// `startBuild` returns a Build object
// https://docs.aws.amazon.com/codebuild/latest/APIReference/API_Build.html
function triggerBuild(event, callback) {
    codebuild.startBuild({

    }, (err, data) => {
        if (err) {
            console.error('...CodeBuild failed to start!');
            callback(err);
        } else {
            console.error('...CodeBuild started...');

            const status = updateGitHubStatus(event);
            const notification = postNotification(event);

            Promise.all([status, notification])
                .then(() => {
                    console.log('...Post-build actions finished!');
                    callback(null);
                })
                .catch(e => {
                    console.error('...Post-build actions failed!');
                    callback(e);
                });
        }
    });
}

// Note: The response to this request should be a 201
// https://developer.github.com/v3/repos/statuses/#create-a-status
function updateGitHubStatus(event) {
    return (new Promise((resolve, reject) => {
        console.log(`...Updating GitHub status...`);

        // Get request properties
        const api = 'api.github.com';
        const repo = event.repository.full_name;
        const sha = event.after || event.pull_request.head.sha;

        const payload = {
            state: 'pending',
            target_url: 'https://example.com/build/status',
            description: 'The build is starting soon...',
            context: 'continuous-integration/prxci'
        };
        const json = JSON.stringify(payload);

        // Setup request options
        const apiUrl = `https://${api}/repos/${repo}/statuses/${sha}`;
        const options = url.parse(apiUrl);
        options.method = 'POST';
        options.headers = {
            'Authorization': `token ${process.env.GITHUB_ACCESS_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Length': Buffer.byteLength(json),
            'User-Agent': USER_AGENT
        };

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
                        resolve(event);
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

function postNotification(event) {
    return (new Promise((resolve, reject) => {
        console.log(`...Posting build status notification...`);
        resolve(event)

        // TODO This should send some structured data about the event and repo
        // so the subscribers to the topic can send quality notifications
        // sns.publish({
        //     TopicArn: process.env.CI_STATUS_TOPIC_ARN,
        //     Message: event.body,
        //     MessageAttributes: {
        //         githubEvent: {
        //             DataType: 'String',
        //             StringValue: event.headers['X-GitHub-Event']
        //         }
        //     }
        // }, (e, data) => e ? reject(e) : resolve(event));
    }));
}

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
const fs = require('fs');
const AWS = require('aws-sdk');

const codebuild = new AWS.CodeBuild({apiVersion: '2016-10-06'});
const sns = new AWS.SNS({apiVersion: '2010-03-31'});
const s3 = new AWS.S3({apiVersion: '2006-03-01'});

const USER_AGENT = 'PRX/Infrastructure (github-event-handler)';
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
    const sns = event.Records[0].Sns;

    const githubEvent = sns.MessageAttributes.githubEvent.Value;
    const githubEventObj = JSON.parse(sns.Message);

    console.log(`Received message for event: ${githubEvent}...`);

    switch (githubEvent) {
        case 'push':
            handlePushEvent(githubEventObj, callback);
            break;
        case 'pull_request':
            handlePullRequestEvent(githubEventObj, callback);
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

    switch (event.ref) {
      case 'refs/heads/master':
          console.log('...Push event was for master branch...');
          checkCodeBuildSupport(event, callback);
          break;
      default:
          // Blackhole all push events not on master
          console.log('...Ignoring this push!');
          callback(null);
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
    options.headers = GITHUB_HEADERS;

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
                    getSourceArchiveLink(event, callback);
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

// The zipball request returns a 301, and because I'm too lazy to install a
// better HTTP library, I'm just making a second request
function getSourceArchiveLink(event, callback) {
    console.log(`...Getting source code archive URL...`);

    // Get request properties
    const api = 'api.github.com';
    const repo = event.repository.full_name;
    const sha = event.after || event.pull_request.head.sha;

    // Setup request options
    const apiUrl = `https://${api}/repos/${repo}/zipball/${sha}`;
    const options = url.parse(apiUrl);
    options.method = 'GET';
    options.headers = GITHUB_HEADERS;

    // Request with response handler
    console.log(`...Calling archive link API: ${apiUrl}...`);
    let req = https.request(options, res => {
        res.setEncoding('utf8');

        let json = '';
        res.on('data', chunk => json += chunk);
        res.on('end', () => {
            switch (res.statusCode) {
                case 302:
                    console.log('...GitHub archive URL found...');
                    const location = res.headers.location;
                    getSourceArchive(location, event, callback);
                    break;
                default:
                    console.error('...GitHub status update failed...');
                    console.error(`...HTTP ${res.statusCode}...`);
                    console.error(json);
                    callback(new Error('GitHub archive link request failed!'));
            }
        });
    });

    // Generic request error handling
    req.on('error', e => reject(e));

    req.write('');
    req.end();
}

function getSourceArchive(location, event, callback) {
    console.log(`...Saving source archive...`);

    // Setup request options
    const options = url.parse(location);
    options.method = 'GET';
    options.headers = GITHUB_HEADERS;

    // Setup write stream
    const dest = `/tmp/${Date.now()}`;
    const file = fs.createWriteStream(dest);

    // Request with response handler
    let req = https.request(options, res => {
        if (res.statusCode !== 200) {
            console.error('...Source archive request failed!');
            callback(new Error('Could not get source archive'));
        } else {
            res.pipe(file);

            file.on('finish', () => {
                file.close(() => {
                    console.log('...Finished downloading archive...');
                    copyToS3(dest, event, callback);
                });
            });
        }
    });

    // Generic request error handling
    req.on('error', e => reject(e));

    // Generic file error handling
    file.on('error', e => { // Handle errors
        fs.unlink(dest);
        callback(e);
    });

    req.write('');
    req.end();
}

function copyToS3(file, event, callback) {
    console.log('...Copying archive to S3...');

    const params = {
        Bucket: process.env.SOURCE_ARCHIVE_BUCKET,
        Key: process.env.SOURCE_ARCHIVE_KEY,
        Body: fs.createReadStream(file)
    };

    s3.putObject(params, (err, data) => {
        if (err) {
            console.error('...S3 copy failed!');
            callback(err);
        } else {
            console.error('...Finished copying to S3...');
            triggerBuild(data.VersionId, event, callback)
        }
    });
}

// `startBuild` returns a Build object
// https://docs.aws.amazon.com/codebuild/latest/APIReference/API_Build.html
function triggerBuild(versionId, event, callback) {
    console.log('...Starting CodeBuild run...');

    codebuild.startBuild({
        projectName: process.env.CODEBUILD_PROJECT_NAME,
        sourceVersion: versionId
    }, (err, data) => {
        if (err) {
            console.error('...CodeBuild failed to start!');
            callback(err);
        } else {
            console.error('...CodeBuild started...');

            const status = updateGitHubStatus(event, data.build);
            const notification = postNotification(event, data.build);

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
function updateGitHubStatus(event, build) {
    return (new Promise((resolve, reject) => {
        console.log(`...Updating GitHub status...`);

        // Get request properties
        const api = 'api.github.com';
        const repo = event.repository.full_name;
        const sha = event.after || event.pull_request.head.sha;

        const arn = build.arn;
        const region = arn.split(':')[3];
        const buildId = arn.split('/')[1];
        const buildUrl = `https://${region}.console.aws.amazon.com/codebuild/home#/builds/${buildId}/view/new`;

        const payload = {
            state: 'pending',
            target_url: buildUrl,
            description: 'Build has started running in CodeBuild',
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

function postNotification(event, build) {
    return (new Promise((resolve, reject) => {
        console.log(`...Posting build status notification...`);

        sns.publish({
            TopicArn: process.env.CI_STATUS_TOPIC_ARN,
            Message: JSON.stringify({ event: event, build: build })
        }, (err, data) => {
            if (err) {
                console.error('...Status notification posted...');
                reject(e);
            } else {
                console.log('...Status notification posted...');
                resolve(event);
            }
        });
    }));
}

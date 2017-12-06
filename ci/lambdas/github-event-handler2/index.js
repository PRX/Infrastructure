// Invoked by: SNS Subscription
// Returns: Error or status message
//
// Handles GitHub events that have been forwarded from the webhook endpoint.
// This function handles the start of the build process for master branches and
// pull requests (for repositories that are designed to work with CodeBuild).
// Broadly, it does the following:
// 1. Check to make sure this event should trigger a build
// 2. Trigger a CodeBuild by copying current code to S3 (the CodeBuild source)
// 3. Send a notification that the build is starting (for Slack/etc)
// 4. Set the GitHub status to 'pending' for the sha
// This Lambda should not be considered to be entirely or even mostly
// responsible for the configuration of CodeBuild environment. It should only
//  worry about the parts of the configuration that result from the events
// the function is intended to handle.

const url = require('url');
const https = require('https');
const fs = require('fs');
const AWS = require('aws-sdk');

const codebuild = new AWS.CodeBuild({ apiVersion: '2016-10-06' });
const sns = new AWS.SNS({ apiVersion: '2010-03-31' });
const s3 = new AWS.S3({ apiVersion: '2006-03-01' });

const USER_AGENT = 'PRX/Infrastructure (github-event-handler)';
const GITHUB_HEADERS = {
    Authorization: `token ${process.env.GITHUB_ACCESS_TOKEN}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': USER_AGENT,
};

// Note: The response to this request should be a 201
// https://developer.github.com/v3/repos/statuses/#create-a-status
function updateGitHubStatus(event, build) {
    return (new Promise((resolve, reject) => {
        console.log('...Updating GitHub status...');

        // Get request properties
        const api = 'api.github.com';
        const repo = event.repository.full_name;
        const sha = event.after || event.pull_request.head.sha;

        const { arn } = build;
        const region = arn.split(':')[3];
        const buildId = arn.split('/')[1];
        const buildUrl = `https://${region}.console.aws.amazon.com/codebuild/home#/builds/${buildId}/view/new`;

        const payload = {
            state: 'pending',
            target_url: buildUrl,
            description: 'Build has started running in CodeBuild',
            context: 'continuous-integration/prxci',
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
        const req = https.request(options, (res) => {
            res.setEncoding('utf8');

            let json2 = '';
            res.on('data', (chunk) => {
                json2 += chunk;
            });
            res.on('end', () => {
                switch (res.statusCode) {
                    case 201:
                        console.log('...GitHub status updated...');
                        resolve(event);
                        break;
                    default:
                        console.error('...GitHub status update failed...');
                        console.error(`...HTTP ${res.statusCode}...`);
                        console.error(json2);
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
        console.log('...Posting build status notification...');

        sns.publish({
            TopicArn: process.env.CI_STATUS_TOPIC_ARN,
            Message: JSON.stringify({ event, build }),
        }, (err) => {
            if (err) {
                console.error('...Status notification posted...');
                reject(err);
            } else {
                console.log('...Status notification posted...');
                resolve(event);
            }
        });
    }));
}

// `startBuild` returns a Build object
// https://docs.aws.amazon.com/codebuild/latest/APIReference/API_Build.html
//
function triggerBuild(versionId, ciContentsResponse, event, callback) {
    console.log('...Starting CodeBuild run...');

    // ciContentsResponse is the JSON body response from a Contents API request
    // to GitHub for a buildspec.yml file in the project that triggered the
    // webhook event. It contains a base 64 encoded string which is the contents
    // of that file.
    const ghData = JSON.parse(ciContentsResponse);
    const buildspec = Buffer.from(ghData.content, 'base64').toString('utf8');

    // Only trigger builds for repositories where the buildspec appears to be
    // be designed for use with CI. Look for an `PRX_` string as a test.
    if (!buildspec.includes('PRX_')) {
        console.log('Skipping unsupported buildspec.yml');
        callback(null);
        return;
    }

    const commitRef = (event.after || event.pull_request.head.sha);

    const environmentVariables = [
        {
            name: 'PRX_REPO',
            value: event.repository.full_name,
        }, {
            name: 'PRX_COMMIT',
            value: commitRef,
        },
    ];

    if (event.pull_request) {
        // Pull requests are test-only builds. The pull request number is not
        // used by the build process, but needs to be passed along to the
        // callback for setting the GitHub status.

        const num = event.pull_request.number;
        environmentVariables.push({ name: 'PRX_GITHUB_PR', value: `${num}` });
        environmentVariables.push({ name: 'PRX_CI_PUBLISH', value: 'false' });
    } else {
        // All other events should be code pushes to the master branch. These
        // should get tested and published. The buildspec.yml file will contain
        // environment variables that allow the post_build.sh script to
        // determine where and how to handle successful builds (e.g. where to
        // push the code, etc).

        environmentVariables.push({ name: 'PRX_CI_PUBLISH', value: 'true' });
    }

    codebuild.startBuild({
        projectName: process.env.CODEBUILD_PROJECT_NAME,
        sourceVersion: versionId,
        buildspecOverride: buildspec,
        environmentVariablesOverride: environmentVariables,
    }, (err, data) => {
        if (err) {
            console.error('...CodeBuild failed to start!');
            console.error(err);
            callback(err);
        } else {
            console.log('...CodeBuild started...');

            const status = updateGitHubStatus(event, data.build);
            const notification = postNotification(event, data.build);

            Promise.all([status, notification])
                .then(() => {
                    console.log('...Post-build actions finished!');
                    callback(null);
                })
                .catch((e) => {
                    console.error('...Post-build actions failed!');
                    callback(e);
                });
        }
    });
}

function copyToS3(file, ciContentsResponse, event, callback) {
    console.log('...Copying archive to S3...');

    const params = {
        Bucket: process.env.CODEBUILD_SOURCE_ARCHIVE_BUCKET,
        Key: process.env.CODEBUILD_SOURCE_ARCHIVE_KEY,
        Body: fs.createReadStream(file),
    };

    s3.putObject(params, (err, data) => {
        if (err) {
            console.error('...S3 copy failed!');
            callback(err);
        } else {
            console.error('...Finished copying to S3...');
            triggerBuild(data.VersionId, ciContentsResponse, event, callback);
        }
    });
}

// Follows the redirect location from the previous request to the GitHub API
// for the zipball of a repo at a given commit hash
function getSourceArchive(location, ciContentsResponse, event, callback) {
    console.log('...Saving source archive...');

    // Setup request options
    const options = url.parse(location);
    options.method = 'GET';
    options.headers = GITHUB_HEADERS;
    options.headers['Content-Length'] = Buffer.byteLength('');

    // Setup write stream
    const dest = `/tmp/${Date.now()}`;
    const file = fs.createWriteStream(dest);

    // Request with response handler
    const req = https.request(options, (res) => {
        if (res.statusCode !== 200) {
            console.error('...Source archive request failed!');
            callback(new Error('Could not get source archive'));
        } else {
            res.pipe(file);

            file.on('finish', () => {
                file.close(() => {
                    console.log('...Finished downloading archive...');
                    copyToS3(dest, ciContentsResponse, event, callback);
                });
            });
        }
    });

    // Generic request error handling
    req.on('error', e => callback(e));

    // Generic file error handling
    file.on('error', (e) => { // Handle errors
        fs.unlink(dest);
        callback(e);
    });

    req.write('');
    req.end();
}

// The zipball request returns a 301, and because I'm too lazy to install a
// better HTTP library, I'm just making a second request
function getSourceArchiveLink(ciContentsResponse, event, callback) {
    console.log('...Getting source code archive URL...');

    // Get request properties
    const api = 'api.github.com';
    const repo = event.repository.full_name;
    const sha = event.after || event.pull_request.head.sha;

    // Setup request options
    const apiUrl = `https://${api}/repos/${repo}/zipball/${sha}`;
    const options = url.parse(apiUrl);
    options.method = 'GET';
    options.headers = GITHUB_HEADERS;
    options.headers['Content-Length'] = Buffer.byteLength('');

    // Request with response handler
    console.log(`...Calling archive link API: ${apiUrl}...`);
    const req = https.request(options, (res) => {
        res.setEncoding('utf8');

        let json = '';
        res.on('data', (chunk) => {
            json += chunk;
        });
        res.on('end', () => {
            switch (res.statusCode) {
                case 302:
                    console.log('...GitHub archive URL found...');
                    getSourceArchive(res.headers.location, ciContentsResponse, event, callback);
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
    req.on('error', e => callback(e));

    req.write('');
    req.end();
}

// Hits the GitHub contents API to determine if the commit that triggered this
// event supports the PRX CI system, by looking for a .prxci file
// https://developer.github.com/v3/repos/contents/#get-contents
function checkCodeBuildSupport(event, callback) {
    console.log('...Checking for CodeBuild support...');

    // Get request properties
    const api = 'api.github.com';
    const repo = event.repository.full_name;
    const path = 'buildspec.yml';
    const ref = event.after || event.pull_request.head.sha;

    // Setup request options
    const apiUrl = `https://${api}/repos/${repo}/contents/${path}?ref=${ref}`;
    const options = url.parse(apiUrl);
    options.method = 'GET';
    options.headers = GITHUB_HEADERS;
    options.headers['Content-Length'] = Buffer.byteLength('');

    // Request with response handler
    console.log(`...Calling contents API: ${apiUrl}...`);
    const req = https.request(options, (res) => {
        res.setEncoding('utf8');

        let json = '';
        res.on('data', (chunk) => {
            console.log(chunk);
            json += chunk;
        });
        res.on('end', () => {
            switch (res.statusCode) {
                case 200:
                    console.log('...Found CodeBuild support...');
                    getSourceArchiveLink(json, event, callback);
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

    req.setTimeout(1000, () => {
        console.log('========= request timed out');
    });

    // Generic request error handling
    req.on('error', e => callback(e));

    req.write('');
    req.end();
}

// We'll want to trigger a build when a pull request is: 'opened', 'reopened',
// or 'synchronized'
// https://developer.github.com/v3/activity/events/types/#pullrequestevent
function handlePullRequestEvent(event, callback) {
    console.log('...Handling pull_request event...');

    const { action } = event;
    const triggers = ['opened', 'reopened', 'synchronize'];

    if (triggers.includes(action)) {
        console.log(`...With action: ${action}...`);
        checkCodeBuildSupport(event, callback);
    } else {
        // Blackhole events that aren't code changes
        console.log('...Ignoring this pull request action!');
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

function main(event, context, callback) {
    const snsMsg = event.Records[0].Sns;

    const githubEvent = snsMsg.MessageAttributes.githubEvent.Value;
    const githubEventObj = JSON.parse(snsMsg.Message);

    console.log(`Received message for event: ${githubEvent}...`);
    callback(null);

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

exports.handler = (event, context, callback) => {
    try {
        main(event, context, callback);
    } catch (e) {
        console.error('Unhandled exception!');
        callback(e);
    }
};

// Invoked by: SNS Subscription
// Returns: Error or status message
//
// Handles GitHub events that have been forwarded from the webhook endpoint.
// This function handles the start of the build process for default branches and
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

const PR_ACTION_TRIGGERS = [
    'opened',
    'reopened',
    'synchronize',
    'ready_for_review',
];
const USER_AGENT = 'PRX/Infrastructure (github-event-handler)';
const GITHUB_HEADERS = {
    Authorization: `token ${process.env.GITHUB_ACCESS_TOKEN}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': USER_AGENT,
};

/**
 * Note: The response to this request should be a 201
 * https://docs.github.com/en/free-pro-team@latest/rest/reference/repos#statuses
 * @param {object} event
 * @param {object} build
 * @returns {Promise<object>}
 */
function updateGitHubStatus(event, build) {
    return new Promise((resolve, reject) => {
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
    });
}

/**
 * @param {object} event
 * @param {object} build
 * @returns {Promise<object>}
 */
function postNotification(event, build) {
    return sns
        .publish({
            TopicArn: process.env.CI_STATUS_TOPIC_ARN,
            Message: JSON.stringify({ event, build }),
        })
        .promise();
}

/**
 * `startBuild` returns a Build object
 * https://docs.aws.amazon.com/codebuild/latest/APIReference/API_Build.html
 * @param {string} versionId - The S3 version ID of the repository zip archive
 * @param {string} ciContentsResponse - The response from the GitHub repository contents API for buildspec.yml
 * @param {object} event
 */
async function triggerBuild(versionId, ciContentsResponse, event) {
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
        return;
    }

    const commitRef = event.after || event.pull_request.head.sha;

    const environmentVariables = [
        {
            name: 'PRX_REPO',
            value: event.repository.full_name,
        },
        {
            name: 'PRX_COMMIT',
            value: commitRef,
        },
    ];

    if (event.pull_request) {
        // Pull requests are test-only builds. The pull request number is not
        // used by the build process, but needs to be passed along to the
        // callback for setting the GitHub status.

        const num = event.pull_request.number;
        const branch = event.pull_request.head.ref;
        environmentVariables.push({ name: 'PRX_GITHUB_PR', value: `${num}` });
        environmentVariables.push({ name: 'PRX_BRANCH', value: branch });
        environmentVariables.push({ name: 'PRX_CI_PUBLISH', value: 'false' });
    } else {
        // All other events should be code pushes to the default branch. These
        // should get tested and published. The buildspec.yml file will contain
        // environment variables that allow the post_build.sh script to
        // determine where and how to handle successful builds (e.g. where to
        // push the code, etc).

        const branch = (event.ref || 'unknown').replace(/^refs\/heads\//, '');
        environmentVariables.push({ name: 'PRX_BRANCH', value: branch });
        environmentVariables.push({ name: 'PRX_CI_PUBLISH', value: 'true' });
    }

    const data = await codebuild
        .startBuild({
            projectName: process.env.CODEBUILD_PROJECT_NAME,
            sourceVersion: versionId,
            buildspecOverride: buildspec,
            environmentVariablesOverride: environmentVariables,
        })
        .promise();

    console.log('...CodeBuild started...');

    const status = updateGitHubStatus(event, data.build);
    const notification = postNotification(event, data.build);

    Promise.all([status, notification]);
}

/**
 * Copies a repository zip archive at the given path to S3
 * @param {string} path - The path of the file to copy to S3
 * @returns {string} The S3 version ID of the resulting object
 */
async function copyToS3(path) {
    console.log('...Copying archive to S3...');

    const params = {
        Bucket: process.env.CODEBUILD_SOURCE_ARCHIVE_BUCKET,
        Key: process.env.CODEBUILD_SOURCE_ARCHIVE_KEY,
        Body: fs.createReadStream(path),
    };

    const data = await s3.putObject(params).promise();
    return data.VersionId;
}

/**
 * Requests the URL to download a repository zip archive
 * https://docs.github.com/en/free-pro-team@latest/rest/reference/repos#download-a-repository-archive-zip
 * @param {object} event
 * @returns {Promise<string>} The URL of the zip archive
 */
function getSourceArchiveLink(event) {
    return new Promise((resolve, reject) => {
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
                        resolve(res.headers.location);
                        break;
                    default:
                        console.error(
                            '...GitHub archive link request failed...',
                        );
                        console.error(`...HTTP ${res.statusCode}...`);
                        console.error(json);
                        reject(
                            new Error('GitHub archive link request failed!'),
                        );
                }
            });
        });

        // Generic request error handling
        req.on('error', e => reject(e));

        req.write('');
        req.end();
    });
}

/**
 * Downloads the zip archive of a reposity to a temporary local file and
 * returns the file path
 * @param {object} event
 * @returns {Promise<string>} The local file path
 */
async function getSourceArchive(event) {
    const location = await getSourceArchiveLink(event);

    return new Promise((resolve, reject) => {
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
                reject(new Error('Could not get source archive'));
            } else {
                res.pipe(file);

                file.on('finish', () => {
                    file.close(() => {
                        console.log('...Finished downloading archive...');
                        resolve(dest);
                    });
                });
            }
        });

        // Generic request error handling
        req.on('error', e => reject(e));

        // Generic file error handling
        file.on('error', (e) => {
            // Handle errors
            fs.unlink(dest);
            reject(e);
        });

        req.write('');
        req.end();
    });
}

/**
 * Hits the GitHub repot contents API to determine if the commit that triggered
 * event supports the PRX CI system by looking for a buildspec.yml file
 * https://docs.github.com/en/free-pro-team@latest/rest/reference/repos#contents
 * @param {object} event
 * @returns {Promise<string>} The JSON response
 */
function getBuildspecContentJson(event) {
    return new Promise((resolve, reject) => {
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
                        resolve(json);
                        break;
                    case 404:
                        console.log('...No CodeBuild support!');
                        resolve(false);
                        break;
                    default:
                        console.error(`...Request failed ${res.statusCode}!`);
                        console.error(json);
                        reject(new Error('Contents request failed!'));
                }
            });
        });

        req.setTimeout(1000, () => {
            console.log('========= request timed out');
        });

        // Generic request error handling
        req.on('error', e => reject(e));

        req.write('');
        req.end();
    });
}

async function handleCiEvent(event) {
    const buildspecContentJson = await getBuildspecContentJson(event);

    if (buildspecContentJson) {
        const filePath = await getSourceArchive(event);
        const versionId = await copyToS3(filePath);
        await triggerBuild(versionId, buildspecContentJson, event);
    }
}

/**
 * We'll want to trigger a build when actions on the pull request represent
 * a change that requires CI, such as opening, synchornizing, or moving from
 * draft to ready for review.
 * https://docs.github.com/en/free-pro-team@latest/developers/webhooks-and-events/webhook-events-and-payloads#pull_request
 * @param {object} event
 */
function handlePullRequestEvent(event) {
    console.log('...Handling pull_request event...');

    if (PR_ACTION_TRIGGERS.includes(event.action)) {
        console.log(`...With action: ${event.action}...`);
        handleCiEvent(event);
    }
}

/**
 * Push events will get delivered for any branch. For pushes to pull requests,
 * there will be an additional `pull_request` event that we will use to trigger
 * the build, so this only needs to proceed if the event is for the default
 * branch.
 * https://docs.github.com/en/free-pro-team@latest/developers/webhooks-and-events/webhook-events-and-payloads#push
 * @param {object} event
 */
function handlePushEvent(event) {
    console.log('...Handling push event...');

    if (event.ref === `refs/heads/${event.repository.default_branch}`) {
        console.log('...Push event was for default branch...');
        handleCiEvent(event);
    }
}

/**
 * @param {object} event
 */
exports.handler = async (event) => {
    const snsMsg = event.Records[0].Sns;

    const githubEvent = snsMsg.MessageAttributes.githubEvent.Value;
    const githubEventObj = JSON.parse(snsMsg.Message);

    console.log(`Received message for event: ${githubEvent}...`);

    switch (githubEvent) {
        case 'push':
            handlePushEvent(githubEventObj);
            break;
        case 'pull_request':
            handlePullRequestEvent(githubEventObj);
            break;
        default:
            console.log('...Ignoring this event type!');
    }
};

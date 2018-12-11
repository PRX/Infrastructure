// Invoked by: API Gateway
// Returns: Error, or API Gateway proxy response object
//
// When a user acts on an interactive message in Slack (eg., clicks a button),
// Slack will send a request to a callback This function handles those requests,
// such as for approving CloudFormation deploys through CodePipeline.
//
// This handles all requsts to the Slack app's Action URL, which includes
// interactive messages, as well as dialogs and perhaps other requests as well.

const querystring = require('querystring');
const crypto = require('crypto');
const url = require('url');
const https = require('https');

const aws = require('aws-sdk');
const s3 = new aws.S3({apiVersion: '2006-03-01'});
const codepipeline = new aws.CodePipeline({apiVersion: '2015-07-09'});
const sns = new aws.SNS({ apiVersion: '2010-03-31' });

const APPROVED = 'Approved';
const REJECTED = 'Rejected';

const CODEPIPELINE_MANUAL_APPROVAL_CALLBACK = 'codepipeline-approval-action';
const RELEASE_NOTES_DIALOG_CALLBACK = 'release-notes-dialog';
const ROLLBACK_VERSION_SELECTION_CALLBACK = 'rollback-version-selection-action';

const SLACK_API_DIALOG_OPEN = 'https://slack.com/api/dialog.open';

// Calls a method in the Slack Web API with a provided POST body. The payload
// argument is an object. If responseProperty is provided, rather than the
// entire response being resolved from the promise, only that property will be.
// https://api.slack.com/web
// https://api.slack.com/methods
function slackWebMethod(uri, responseProperty, payload) {
    return new Promise((resolve, reject) => {
        const urlencodedBody = querystring.stringify(payload);

        // Setup request options
        const options = url.parse(uri);
        options.method = 'POST';
        options.headers = {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(urlencodedBody),
        };

        const method = uri.split('/').pop();

        // Request with response handler
        console.log(`[Slack] Calling ${method}`);
        const req = https.request(options, (res) => {
            res.setEncoding('utf8');

            let json = '';
            res.on('data', (chunk) => { json += chunk; });
            res.on('end', () => {
                try {
                    const resPayload = JSON.parse(json);

                    if (resPayload.ok) {
                        console.error(`[Slack] ${method} ok`);
                        resolve(resPayload[responseProperty] || resPayload);
                    } else {
                        console.error(`[Slack] ${method} error`);
                        reject(new Error(resPayload.error));
                    }
                } catch (e) {
                    console.error(`[Slack] Error parsing ${method}`);
                    reject(e);
                }
            });
        });

        // Generic request error handling
        req.on('error', e => reject(e));

        req.write(urlencodedBody);
        req.end();
    });
}

exports.handler = (event, context, callback) => {
    try {
        processEvent(event, context, callback);
    } catch (e) {
        callback(e);
    }
};

function processEvent(event, context, callback) {
    const body = querystring.parse(event.body);

    // The JSON object response from Slack
    const payload = JSON.parse(body.payload);

    // Top-level properties of the message action response object
    const callbackId = payload.callback_id;

    // Slack signing secret
    const slackRequestTimestamp = event.headers['X-Slack-Request-Timestamp'];
    const basestring = ['v0', slackRequestTimestamp, event.body].join(':');
    const signingSecret = process.env.SLACK_SIGNING_SECRET;
    const slackSignature = event.headers['X-Slack-Signature'];
    const requestSignature = `v0=${crypto.createHmac('sha256', signingSecret).update(basestring).digest('hex')}`;

    if (requestSignature !== slackSignature) {
        // Bad request; bogus token
        callback(null, { statusCode: 400, headers: {}, body: null });
    } else {
        // Handle each callback ID appropriately
        switch (callbackId) {
            case CODEPIPELINE_MANUAL_APPROVAL_CALLBACK:
                handleReleaseButtons(payload, callback);
                break;
            case ROLLBACK_VERSION_SELECTION_CALLBACK:
                handleRollbackCallback(payload, callback);
                break;
            case RELEASE_NOTES_DIALOG_CALLBACK:
                handleReleaseNotesDialog(payload, callback);
                break;
            default:
                // Unknown message callback
                callback(null, { statusCode: 400, headers: {}, body: null });
        }
    }
}

function handleReleaseNotesDialog(payload, callback) {
    console.log(JSON.stringify(payload));

    sns.publish({
        TopicArn: process.env.SLACK_MESSAGE_RELAY_TOPIC_ARN,
        Message: JSON.stringify({
            channel: '#tech-releases',
            username: 'Release Notes',
            icon_emoji: ':rabbit:',
            text: `<@${payload.user.id}>: ${payload.submission.release_notes}`,
        }),
    }, () => {
        callback(null, { statusCode: 200, headers: {}, body: null });
    });

}

function handleRollbackCallback(payload, callback) {
    const action = payload.actions[0];

    switch (action.name) {
        case 'selection':
            triggerRollback(payload, callback)
            break;
        default:
            cancelRollback(payload, callback);
    }
}

function triggerRollback(payload, callback) {
    const action = payload.actions[0];
    const versionId = action.selected_options[0].value;

    const configBucket = process.env.INFRASTRUCTURE_CONFIG_BUCKET;
    const configKey = process.env.INFRASTRUCTURE_CONFIG_STAGING_KEY;
    const sourceUrl = `${configBucket}/${configKey}?versionId=${versionId}`;

    s3.copyObject({
        Bucket: configBucket,
        CopySource: encodeURI(sourceUrl),
        Key: configKey
    }, (e, data) => {
        if (e) {
            console.error(e);
            callback(null, { statusCode: 400, headers: {}, body: null });
        } else {
            const msg = {
                text: `Rolling back to config version: ${versionId}`
            };

            const body = JSON.stringify(msg);
            callback(null, { statusCode: 200, headers: {}, body: body });
        }
    });
}

function cancelRollback(payload, callback) {
    const msg = {
        text: '_Rollback canceled_'
    };

    const body = JSON.stringify(msg);
    callback(null, { statusCode: 200, headers: {}, body: body });
}

// This will get called for both the Approve and Approve With Notes buttons.
// Both will trigger an IMMEDIATE deploy, but the Aw/N button will also open a
// dialog prompting the user for release notes related to the deploy. (The
// reason the deploy is not delayed until after the release notes dialog is
// because of the added complexity with updating the message in Slack to
// reflect the deployment with the indirection introduced with the dialog. It
// is possible, but was not done to save time.)
function handleReleaseButtons(payload, callback) {
    const action = payload.actions[0];

    // The manual approval notifications params need to be extracted from
    // the action value, where they are stored as stringified JSON data.
    const extractedParams = JSON.parse(action.value);

    // We're going to immediately update the message that triggered the
    // action based on the action taken and the result of that action.
    // We'll use the original message as a starting point, but need to
    // remove some unnecessary properties before sending it back
    const attachment = payload.original_message.attachments[0];
    delete attachment.actions;
    delete attachment.id;
    delete attachment.callback_id;

    // Build the params that get sent back to CodePipeline to approve or
    // reject the pipeline
    const approvalParams = {
        pipelineName: extractedParams.pipelineName,
        stageName: extractedParams.stageName,
        actionName: extractedParams.actionName,
        token: extractedParams.token,
        result: {
            status: extractedParams.value,
            summary: 'Handled by Ike'
        },
    };

    codepipeline.putApprovalResult(approvalParams, (err, data) => {
        if (err) {
            // There was an error making the putApprovalResult request to
            // CodePipeline, so the user should be notified that their
            // action was not successful
            const body = JSON.stringify({ test: `Error: ${err}` });
            callback(null, { statusCode: 200, headers: {}, body: body });
        } else {
            // The putApprovalResult request was successful, so the message
            // in Slack should be updated to remove the buttons

            const msg = { text: '', attachments: [attachment] };

            switch (extractedParams.value) {
                case REJECTED:
                    attachment.text = attachment.text + `\n*<@${payload.user.id}> rejected this deploy*`;
                    attachment.color = '#de0e0e';
                    break;
                case APPROVED:
                    attachment.text = attachment.text + `\n:white_check_mark: *<@${payload.user.id}> approved this deploy*`;
                    attachment.color = '#15da34';
                    break;
                default:
                    attachment.text = attachment.text + `\nUnknown action by <@${payload.user.id}>`;
                    attachment.color = '#cd0ede';
            }

            // The message to replace the one that included the Release buttons
            const body = JSON.stringify(msg);

            // If the Approve With Notes button was pressed open a dialog,
            // otherwise we're done
            if (action.name !== 'notes') {
                callback(null, { statusCode: 200, headers: {}, body: body });
            } else {
                slackWebMethod(SLACK_API_DIALOG_OPEN, null, {
                    trigger_id: payload.trigger_id,
                    token: process.env.SLACK_ACCESS_TOKEN,
                    dialog: JSON.stringify({
                        callback_id: RELEASE_NOTES_DIALOG_CALLBACK,
                        state: action.value,
                        title: 'Release Notes',
                        submit_label: 'Post',
                        elements: [
                            {
                                type: 'textarea',
                                label: 'Release notes',
                                name: 'release_notes',
                                hint: 'These will be posted in #tech-releases.',
                            },
                        ],
                    }),
                }).then(res => {
                    callback(null, { statusCode: 200, headers: {}, body: body });
                });
            }
        }
    });
}

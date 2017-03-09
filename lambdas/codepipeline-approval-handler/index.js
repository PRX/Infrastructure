'use strict';

const url = require('url');
const https = require('https');
const querystring = require('querystring');

const aws = require('aws-sdk');
const codepipeline = new aws.CodePipeline({apiVersion: '2015-07-09'});

const APPROVED = 'Approved';
const REJECTED = 'Rejected';

exports.handler = (event, context, callback) => {
    try {
        processEvent(event, context, callback);
    } catch (e) {
        callback(e);
    }
};

const processEvent = (event, context, callback) => {
    const body = querystring.parse(event.body);
    const payload = JSON.parse(body.payload);
    const action = payload.actions[0];

    if (payload.token !== process.env.SLACK_VERIFICATION_TOKEN) {
        // Bad request; bogus token
        callback(null, { statusCode: 400, headers: {}, body: null });
    } else {
        // We're going to immediately update the message that triggered the
        // action based on the action taken and the result of that action.
        // We'll use the original message as a starting point, but need to
        // remove some unnecessary properties before sending it back
        const attachment = payload.original_message.attachments[0];
        delete attachment.actions;
        delete attachment.id;

        // The manual approval notifications params need to be extracted from
        // the callback_id, where they are stored as stringified JSON data.
        const extractedParams = JSON.parse(attachment.callback_id);
        delete attachment.callback_id;

        // Build the params that get sent back to CodePipeline to approve or
        // reject the pipeline
        const approvalParams = {
            pipelineName: extractedParams.pipelineName,
            stageName: extractedParams.stageName,
            actionName: extractedParams.actionName,
            token: extractedParams.token,
            result: {
                status: (action.value === REJECTED ? REJECTED : APPROVED),
                summary: 'Handled by Ike'
            },
        };

        codepipeline.putApprovalResult(approvalParams, (err, data) => {
            if (err) {
                // There was an error making the putApprovalResult request to
                // CodePipeline, so the user should be notified that their
                // action was not successful
                const newBody = JSON.stringify({
                  test: `There was an error: ${err}`
                });

                callback(null, { statusCode: 200, headers: {}, body: newBody });
            } else {
                // The putApprovalResult request was successful, so the message
                // in Slack should be updated to remove the buttons

                const msg = { text: '', attachments: [attachment] };

                switch (action.value) {
                    case REJECTED:
                        msg.text = `*Rejected* by ${payload.user.name}`;
                        attachment.color = '#de0e0e';
                        break;
                    case APPROVED:
                        msg.text = `*Approved* by ${payload.user.name}`;
                        attachment.color = '#de0e0e';
                        break;
                    default:
                        msg.text = `*Unknown action!*`;
                        attachment.color = '#cd0ede';
                }

                const newBody = JSON.stringify(msg);
                callback(null, { statusCode: 200, headers: {}, body: newBody });
            }
        });
    }
};

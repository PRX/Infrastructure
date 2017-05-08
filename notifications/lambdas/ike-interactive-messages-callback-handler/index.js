const url = require('url');
const https = require('https');
const querystring = require('querystring');

const aws = require('aws-sdk');
const codepipeline = new aws.CodePipeline({apiVersion: '2015-07-09'});

const APPROVED = 'Approved';
const REJECTED = 'Rejected';

const CODEPIPELINE_MANUAL_APPROVAL_CALLBACK = 'codepipeline-approval-action';

exports.handler = (event, context, callback) => {
    try {
        processEvent(event, context, callback);
    } catch (e) {
        callback(e);
    }
};

const processEvent = (event, context, callback) => {
    const body = querystring.parse(event.body);

    // The JSON object response from Slack
    const payload = JSON.parse(body.payload);

    // Top-level properties of the message action response object
    const action = payload.actions[0];
    const callbackId = payload.callback_id;
    const token = payload.token;

    if (payload.token !== process.env.SLACK_VERIFICATION_TOKEN) {
        // Bad request; bogus token
        callback(null, { statusCode: 400, headers: {}, body: null });
    } else {
        // Handle each callback ID appropriately
        switch (callbackId) {
            case CODEPIPELINE_MANUAL_APPROVAL_CALLBACK:
                handleCodePipelineApproval(payload, callback);
                break;
            default:
                // Unknown message callback
                callback(null, { statusCode: 400, headers: {}, body: null });
        }
    }
};

const handleCodePipelineApproval = (payload, callback) => {
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
                    attachment.text = attachment.text + `\n*@${payload.user.name} rejected this deploy*`;
                    attachment.color = '#de0e0e';
                    break;
                case APPROVED:
                    attachment.text = attachment.text + `\n:white_check_mark: *@${payload.user.name} approved this deploy*`;
                    attachment.color = '#15da34';
                    break;
                default:
                    attachment.text = attachment.text + `\nUnknown action by @${payload.user.name}`;
                    attachment.color = '#cd0ede';
            }

            const body = JSON.stringify(msg);
            callback(null, { statusCode: 200, headers: {}, body: body });
        }
    });
}

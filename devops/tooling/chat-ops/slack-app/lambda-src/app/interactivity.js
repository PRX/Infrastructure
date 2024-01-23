const querystring = require('querystring');
const cfInvalidate = require('./things/cloudfront-invalidations');
const pipelineExec = require('./things/codepipeline-executions');
const pipelineTransitions = require('./things/codepipeline-transitions');
const pipelineApproval = require('./things/codepipeline-approval');

const SLACK_PAYLOAD_TYPE_BLOCK_ACTIONS = 'block_actions';
const SLACK_PAYLOAD_TYPE_VIEW_SUBMISSION = 'view_submission';
const SLACK_PAYLOAD_TYPE_VIEW_CLOSED = 'view_closed';

/**
 * Block action payloads are always disambiguated by action_id`.
 *
 * Payloads should be forwarded to the appropriate module based on the
 * action_id prefix. Each module should implement a handleBlockActionPayload
 * method.
 * @param {*} payload
 */
async function handleBlockActionPayload(payload) {
  const actionId = payload.actions[0].action_id;

  if (actionId.startsWith('cloudformation-invalidation_')) {
    await cfInvalidate.handleBlockActionPayload(payload);
  } else if (actionId.startsWith('codepipeline-execution_')) {
    await pipelineExec.handleBlockActionPayload(payload);
  } else if (actionId.startsWith('codepipeline-transitions_')) {
    await pipelineTransitions.handleBlockActionPayload(payload);
  } else if (actionId.startsWith('codepipeline-approval_')) {
    await pipelineApproval.handleBlockActionPayload(payload);
  }
}

/**
 * View submission payloads are always disambiguated by callback_id
 *
 * Payloads should be forwarded to the appropriate module based on the
 * callback_id prefix. Each module should implement a handleViewSubmissionPayload
 * method.
 * @param {*} payload
 */
async function handleViewSubmissionPayload(payload) {
  const callbackId = payload.view.callback_id;

  if (callbackId.startsWith('cloudformation-invalidation_')) {
    await cfInvalidate.handleViewSubmissionPayload(payload);
  } else if (callbackId.startsWith('codepipeline-execution_')) {
    await pipelineExec.handleViewSubmissionPayload(payload);
  } else if (callbackId.startsWith('codepipeline-transitions_')) {
    await pipelineTransitions.handleViewSubmissionPayload(payload);
  } else if (callbackId.startsWith('codepipeline-approval_')) {
    await pipelineApproval.handleViewSubmissionPayload(payload);
  }
}

module.exports = {
  // https://api.slack.com/reference/interaction-payloads/views
  // https://api.slack.com/reference/interaction-payloads/block-actions
  handler: async function handler(event, body) {
    const formdata = querystring.parse(body);
    // TODO
    // @ts-ignore
    const payload = JSON.parse(formdata.payload);

    switch (payload.type) {
      case SLACK_PAYLOAD_TYPE_BLOCK_ACTIONS:
        await handleBlockActionPayload(payload);
        return { statusCode: 200, headers: {}, body: '' };
      case SLACK_PAYLOAD_TYPE_VIEW_SUBMISSION:
        await handleViewSubmissionPayload(payload);
        return { statusCode: 200, headers: {}, body: '' };
      case SLACK_PAYLOAD_TYPE_VIEW_CLOSED:
        console.log('SLACK_PAYLOAD_TYPE_VIEW_CLOSED');
        return { statusCode: 200, headers: {}, body: '' };
      default:
        return { statusCode: 200, headers: {}, body: '' };
    }
  },
};

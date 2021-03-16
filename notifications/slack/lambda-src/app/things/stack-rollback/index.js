const { WebClient } = require('@slack/web-api');
const AWS = require('aws-sdk');
const Access = require('../../access');

const web = new WebClient(process.env.SLACK_ACCESS_TOKEN);

module.exports = {
  handleBlockActionPayload: async function handleBlockActionPayload(payload) {
    const actionId = payload.actions[0].action_id;

    switch (actionId) {
      // case 'codepipeline-transitions_open-model':
      //   await openModal(payload);
      //   break;
      default:
        break;
    }
  },
  handleViewSubmissionPayload: async function handleViewSubmissionPayload(
    payload,
  ) {
    const callbackId = payload.view.callback_id;

    switch (callbackId) {
      // case 'codepipeline-transitions_set-stage-state':
      //   await setTransitionState(payload);
      //   break;
      default:
        break;
    }
  },
};

const Reject = require('./reject');
const Approve = require('./approve');
const Annotate = require('./annotate');

module.exports = {
  handleBlockActionPayload: async function handleBlockActionPayload(payload) {
    const actionId = payload.actions[0].action_id;

    switch (actionId) {
      case 'codepipeline-approval_reject-deploy':
        await Reject.handleBlockActionPayload(payload);
        break;
      case 'codepipeline-approval_approve-deploy':
        await Approve.handleBlockActionPayload(payload);
        break;
      case 'codepipeline-approval_annotate-deploy':
        await Annotate.handleBlockActionPayload(payload);
        break;
      default:
        break;
    }
  },
  handleViewSubmissionPayload: async function handleViewSubmissionPayload(
    payload,
  ) {
    const callbackId = payload.view.callback_id;

    switch (callbackId) {
      case 'codepipeline-approval_reject-deploy':
        await Reject.handleViewSubmissionPayload(payload);
        break;
      case 'codepipeline-approval_annotate-deploy':
        await Annotate.handleViewSubmissionPayload(payload);
        break;
      default:
        break;
    }
  },
};

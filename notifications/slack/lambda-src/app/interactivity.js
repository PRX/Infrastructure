const querystring = require('querystring');

const SLACK_PAYLOAD_TYPE_BLOCK_ACTIONS = 'block_actions';
const SLACK_PAYLOAD_TYPE_VIEW_SUBMISSION = 'view_submission';
const SLACK_PAYLOAD_TYPE_VIEW_CLOSED = 'view_closed';

module.exports = {
  // https://api.slack.com/reference/interaction-payloads/views
  // https://api.slack.com/reference/interaction-payloads/block-actions
  handler: async function handler(event, body) {
    const formdata = querystring.parse(body);
    const payload = JSON.parse(formdata.payload);

    switch (payload.type) {
      case SLACK_PAYLOAD_TYPE_BLOCK_ACTIONS:
        console.log('SLACK_PAYLOAD_TYPE_BLOCK_ACTIONS');
        break;
      case SLACK_PAYLOAD_TYPE_VIEW_SUBMISSION:
        console.log('SLACK_PAYLOAD_TYPE_VIEW_SUBMISSION');
        break;
      case SLACK_PAYLOAD_TYPE_VIEW_CLOSED:
        console.log('SLACK_PAYLOAD_TYPE_VIEW_CLOSED');
        break;
      default:
        return { statusCode: 200, headers: {}, body: '' };
    }
  },
};

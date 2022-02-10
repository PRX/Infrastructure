const crypto = require('crypto');

const EventsApi = require('./events');
const Interactivity = require('./interactivity');

// Determines how to handle all Slack requests, and returns an HTTP response
// object (for API Gateway).
async function slackRequestResponse(event, body) {
  switch (event.routeKey) {
    case 'POST /v1/slack/events':
      return EventsApi.handler(event, body);
    case 'POST /v1/slack/interactive':
      return Interactivity.handler(event, body);
    default:
      console.log('Unexpected Slack request route');
      return { statusCode: 200, headers: {}, body: '' };
  }
}

module.exports = {
  handler: async function handler(event) {
    // Keep track of retry requests that Slack makes if certain conditions are
    // met (or not met)
    // https://api.slack.com/events-api#errors
    const retryNum = event.headers['x-slack-retry-num'];
    const retryReason = event.headers['x-slack-retry-reason'];

    if (retryNum || retryReason) {
      console.log(`Slack retries – Count: ${retryNum} Reason: ${retryReason}`);
    }

    // All Slack requests will have a signature that should be verified
    const slackSignature = event.headers['x-slack-signature'];

    if (!slackSignature) {
      console.log('Missing Slack signature');
      return { statusCode: 400, headers: {}, body: '' };
    }

    const body = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf-8')
      : event.body;

    const slackRequestTimestamp = event.headers['x-slack-request-timestamp'];
    const basestring = ['v0', slackRequestTimestamp, body].join(':');
    const signingSecret = process.env.SLACK_SIGNING_SECRET;
    const requestSignature = `v0=${crypto
      .createHmac('sha256', signingSecret)
      .update(basestring)
      .digest('hex')}`;

    if (requestSignature !== slackSignature) {
      console.log('Invalid Slack signature');
      return { statusCode: 400, headers: {}, body: '' };
    }

    console.log('Slack request verified');

    return slackRequestResponse(event, body);
  },
};

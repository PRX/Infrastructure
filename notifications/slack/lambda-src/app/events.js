const AppHome = require('./app-home');

const SLACK_PAYLOAD_TYPE_EVENT_CALLBACK = 'event_callback';
const SLACK_PAYLOAD_TYPE_URL_VERIFICATION = 'url_verification';

module.exports = {
  // Handles API payloads coming from the Slack Events API for any events
  // the Botzee app has subscribed to. Must return an HTTP response object.
  // https://api.slack.com/events-api#event_types
  // https://api.slack.com/events
  // https://api.slack.com/events-api#receiving_events
  handler: async function handler(event, body) {
    const payload = JSON.parse(body);

    if (payload.type === SLACK_PAYLOAD_TYPE_URL_VERIFICATION) {
      console.log('Responding to event URL challenge');
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ challenge: payload.challenge }),
      };
    }

    if (payload.type === SLACK_PAYLOAD_TYPE_EVENT_CALLBACK) {
      // This should handle all event types that the app is subscribed
      // to. Some discrete subscriptions share a type, e.g., message.im
      // and message.mpim both have a `message` type.
      switch (payload.event.type) {
        case 'app_home_opened':
          AppHome.handler(payload);
          break;
        default:
          console.log('Unhandled Event API event type');
      }
    }

    return { statusCode: 200, headers: {}, body: '' };
  },
};

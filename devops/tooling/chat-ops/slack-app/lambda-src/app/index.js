// const { WebClient } = require('@slack/web-api');

const SlackRequest = require('./slack_request');

// eslint-disable-next-line arrow-body-style
exports.handler = async (event) => {
  // if (event.source === 'aws.events') {
  //   return;
  // }

  // //
  // if (
  //   event.Records &&
  //   event.Records[0] &&
  //   event.Records[0].EventSource === 'aws:sns'
  // ) {
  //   const web = new WebClient(process.env.SLACK_ACCESS_TOKEN);

  //   await web.chat.postMessage(JSON.parse(event.Records[0].Sns.Message));
  //   return;
  // }

  return SlackRequest.handler(event);
};

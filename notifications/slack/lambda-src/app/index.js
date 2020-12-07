const SlackRequest = require('./slack_request');

exports.handler = async (event) => {
  if (event.source === 'aws.events') {}

  //
  if (event.Records && event.Records[0] && event.Records[0].EventSource === 'aws:sns') {
    const { WebClient } = require('@slack/web-api');
    const web = new WebClient(process.env.SLACK_ACCESS_TOKEN);

        await web.chat.postMessage(JSON.parse(event.Records[0].Sns.Message));
    return;
  }

  return await SlackRequest.handler(event);
};

const SlackRequest = require('./slack_request');

exports.handler = async (event) => {
  if (event.source === 'aws.events') {}

  if (event.source === 'aws:sns') {
    const { WebClient } = require('@slack/web-api');
    const web = new WebClient(process.env.SLACK_ACCESS_TOKEN);

    await web.chat.postMessage({
      channel: 'CHZTAGBM2',
      username: 'Santa',
      icon_emoji: ':santa:',
      text: 'Ho ho ho'
    });

    return;
  }

  return await SlackRequest.handler(event);
};

/**
 * This Lambda function is subscribed to SNS topics, EventBridge buses, and
 * other message services. It expects that any message data it receives from
 * those sources is a fully-formed Slack message payload, and relays that
 * payload to Slack via the chat.postMessage Web API method [1].
 *
 * 1. https://api.slack.com/methods/chat.postMessage
 */

const { WebClient } = require('@slack/web-api');

const web = new WebClient(process.env.SLACK_ACCESS_TOKEN);

exports.handler = async (event) => {
  if (event.Records && event.Records[0] && event.Records[0].EventSource === 'aws:sns') {
    const msg = JSON.parse(event.Records[0].Sns.Message);
    msg.channel = '#sandbox2';
    // await web.chat.postMessage(msg);
  }
};

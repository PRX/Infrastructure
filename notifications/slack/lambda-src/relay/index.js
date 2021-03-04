/**
 * This Lambda function is subscribed to SNS topics, EventBridge buses, and
 * other message services. It expects that any message data it receives from
 * those sources is a fully-formed Slack message payload, and relays that
 * payload to Slack via the chat.postMessage Web API method [1].
 *
 * 1. https://api.slack.com/methods/chat.postMessage
 */

/** @typedef { import('aws-lambda').SNSEvent } SNSEvent */
/** @typedef { import('@slack/web-api').ChatPostMessageArguments } ChatPostMessageArguments */

const { WebClient } = require('@slack/web-api');

const web = new WebClient(process.env.SLACK_ACCESS_TOKEN);

/**
 * @param {SNSEvent} event
 * @returns {Promise<void>}
 */
exports.handler = async (event) => {
  if (event?.Records?.[0]?.EventSource === 'aws:sns') {
    /** @type {ChatPostMessageArguments} */
    const msg = JSON.parse(event.Records[0].Sns.Message);
    await web.chat.postMessage(msg);
  }
};

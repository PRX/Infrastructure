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

import { WebClient } from '@slack/web-api';

const web = new WebClient(process.env.SLACK_ACCESS_TOKEN);

// TODO event param should be type SNSEvent|ChatPostMessageArguments
/**
 * @param {*} event
 * @returns {Promise<void>}
 */
export const handler = async (event) => {
  if (event?.Records?.[0]?.EventSource === 'aws:sns') {
    /** @type {ChatPostMessageArguments} */
    const msg = JSON.parse(event.Records[0].Sns.Message);
    console.log(event.Records[0].Sns.Message);
    await web.chat.postMessage(msg);

    // Watch for any messages coming through a non-canonical topic, and
    // forward them to a different channel for identification
    if (
      event.Records[0].Sns.TopicArn !== process.env.CANONICAL_RELAY_TOPIC_ARN
    ) {
      msg.channel = '#sandbox2';
      await web.chat.postMessage(msg);
    }
  } else {
    // If the event didn't come through SNS, assume that it's a raw Slack
    // message payload. This is true when messages are sent via the EventBridge
    // custom bus.
    console.log(JSON.stringify(event));
    const msg = event;
    await web.chat.postMessage(msg);
  }
};

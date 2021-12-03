/**
 * This Lambda function is subscribed to SNS topics, EventBridge buses, and
 * other message services. It expects that any message data it receives from
 * those sources is a fully-formed Slack message payload, and relays that
 * payload to Slack via the chat.postMessage Web API method [1].
 *
 * 1. https://api.slack.com/methods/chat.postMessage
 */

/** @typedef {String} JSONString */

/**
 * @typedef {Object} EventBridgeCloudWatchAlarmsEventDetailState
 * @property {!String} reason
 * @property {!JSONString} [reasonData]
 * @property {!String} timestamp
 * @property {!('OK'|'ALARM'|'INSUFFICIENT_DATA')} value
 */

/**
 * @typedef {Object} EventBridgeCloudWatchAlarmsEventDetailConfigurationMetricStatMetric
 * @property {String} name
 * @property {String} namespace
 * @property {Object.<string, string>} dimensions
 */

/**
 * @typedef {Object} EventBridgeCloudWatchAlarmsEventDetailConfigurationMetricStat
 * @property {Number} period
 * @property {String} stat
 * @property {EventBridgeCloudWatchAlarmsEventDetailConfigurationMetricStatMetric} metric
 */

/**
 * @typedef {Object} EventBridgeCloudWatchAlarmsEventDetailConfigurationMetric
 * @property {String} id
 * @property {EventBridgeCloudWatchAlarmsEventDetailConfigurationMetricStat} metricStat
 */

/**
 * @typedef {Object} EventBridgeCloudWatchAlarmsEventDetailConfiguration
 * @property {String} description
 * @property {EventBridgeCloudWatchAlarmsEventDetailConfigurationMetric[]} metrics
 */

/**
 * @typedef {Object} EventBridgeCloudWatchAlarmsEventDetail
 * @property {String} alarmName
 * @property {EventBridgeCloudWatchAlarmsEventDetailState} previousState
 * @property {EventBridgeCloudWatchAlarmsEventDetailState} state
 * @property {EventBridgeCloudWatchAlarmsEventDetailConfiguration} configuration
 */

/** @typedef { import('aws-lambda').EventBridgeEvent<'CloudWatch Alarm State Change', EventBridgeCloudWatchAlarmsEventDetail> } EventBridgeCloudWatchAlarmsEvent */

const AWS = require('aws-sdk');
const color = require('./color');
const builder = require('./builder');
const channels = require('./channels');

const sns = new AWS.SNS({
  apiVersion: '2010-03-31',
  region: process.env.SLACK_MESSAGE_RELAY_SNS_TOPIC_ARN.split(':')[3],
});

/**
 * @param {EventBridgeCloudWatchAlarmsEvent} event
 * @returns {Promise<void>}
 */
exports.handler = async (event) => {
  try {
    console.log(JSON.stringify(event));

    // Ignore some alarms based on their name
    if (
      event.detail.alarmName.includes('AS:In') ||
      event.detail.alarmName.includes('AS:Out') ||
      event.detail.alarmName.includes('TargetTracking') ||
      event.detail.alarmName.includes('Production Pollers Low CPU Usage')
    ) {
      return;
    }

    const blocks = await builder.blocks(event);
    const fallback = await builder.fallback(event);

    await sns
      .publish({
        TopicArn: process.env.SLACK_MESSAGE_RELAY_SNS_TOPIC_ARN,
        Message: JSON.stringify({
          username: 'Amazon CloudWatch Alarms',
          icon_emoji: ':ops-cloudwatch-alarm:',
          channel: channels.channel(event),
          attachments: [
            {
              color: color.value(event),
              fallback,
              blocks,
            },
          ],
        }),
      })
      .promise();
  } catch (error) {
    console.log(error);

    await sns
      .publish({
        TopicArn: process.env.SLACK_MESSAGE_RELAY_SNS_TOPIC_ARN,
        Message: JSON.stringify({
          username: 'Amazon CloudWatch Alarms',
          icon_emoji: ':ops-cloudwatch-alarm:',
          channel: '#ops-warn',
          text: [
            'The following CloudWatch alarm event was not handled successfully:',
            `\n\n*Event ID:* \`${event.id}\`\n\n`,
            '```',
            JSON.stringify(event),
            '```',
          ].join(''),
        }),
      })
      .promise();
  }
};

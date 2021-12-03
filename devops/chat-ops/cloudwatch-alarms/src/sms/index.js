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
const regions = require('./regions');

const sns = new AWS.SNS({
  apiVersion: '2010-03-31',
  region: process.env.FATAL_SMS_CONTACT_LIST_SNS_TOPIC_ARN.split(':')[3],
});

/**
 * @param {EventBridgeCloudWatchAlarmsEvent} event
 * @returns {Promise<void>}
 */
exports.handler = async (event) => {
  console.log(JSON.stringify(event));

  if (event.detail.alarmName.startsWith('FATAL')) {
    const region = regions.descriptor(event.region);

    await sns
      .publish({
        TopicArn: process.env.FATAL_SMS_CONTACT_LIST_SNS_TOPIC_ARN,
        Message: `${event.detail.state} | ${region} » ${event.detail.alarmName}`,
      })
      .promise();
  }
};

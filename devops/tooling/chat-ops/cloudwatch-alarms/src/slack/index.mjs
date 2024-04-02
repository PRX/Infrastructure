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

import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';

import { value as colorValue } from './color.mjs';
import { channel } from './channels.mjs';
import {
  blocks as buildBlocks,
  fallback as buildFallback,
} from './builder.mjs';

const eventbridge = new EventBridgeClient({ apiVersion: '2015-10-07' });

/**
 * @param {EventBridgeCloudWatchAlarmsEvent} event
 * @returns {Promise<void>}
 */
export const handler = async (event) => {
  try {
    console.log(JSON.stringify(event));

    // Ignore some alarms based on their name
    if (
      event.detail.alarmName.includes('AS:In') ||
      event.detail.alarmName.includes('AS:Out') ||
      event.detail.alarmName.includes('TargetTracking') ||
      event.detail.alarmName.includes('ScaleInAlarm') ||
      event.detail.alarmName.includes('ScaleOutAlarm') ||
      event.detail.alarmName.includes('Production Pollers Low CPU Usage')
    ) {
      return;
    }

    const blocks = await buildBlocks(event);
    const fallback = await buildFallback(event);

    await eventbridge.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'org.prx.cloudwatch-alarms',
            DetailType: 'Slack Message Relay Message Payload',
            Detail: JSON.stringify({
              username: 'Amazon CloudWatch Alarms',
              icon_emoji: ':ops-cloudwatch-alarm:',
              channel: channel(event),
              attachments: [
                {
                  color: colorValue(event),
                  fallback,
                  blocks,
                },
              ],
            }),
          },
        ],
      }),
    );
  } catch (error) {
    console.log(error);

    await eventbridge.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'org.prx.cloudwatch-alarms',
            DetailType: 'Slack Message Relay Message Payload',
            Detail: JSON.stringify({
              username: 'Amazon CloudWatch Alarms',
              icon_emoji: ':ops-cloudwatch-alarm:',
              channel: 'G2QHC2N7K', // #ops-warn
              text: [
                'The following CloudWatch alarm event was not handled successfully:',
                `\n\n*Event ID:* \`${event.id}\`\n\n`,
                '```',
                JSON.stringify(event),
                '```',
              ].join(''),
            }),
          },
        ],
      }),
    );
  }
};

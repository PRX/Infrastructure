/** @typedef {import('./index.mjs').EventBridgeCloudWatchAlarmsEvent} EventBridgeCloudWatchAlarmsEvent */
/** @typedef {import('@aws-sdk/client-cloudwatch').DescribeAlarmsOutput} DescribeAlarmsOutput */
/** @typedef {import('@aws-sdk/client-cloudwatch').DescribeAlarmHistoryOutput} DescribeAlarmHistoryOutput */

import { detailLines as okDetailLines } from './builder-ok.mjs';
import { detailLines as alarmDetailLines } from './builder-alarm.mjs';

import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import {
  CloudWatchClient,
  DescribeAlarmHistoryCommand,
  DescribeAlarmsCommand,
} from '@aws-sdk/client-cloudwatch';
import { alarmConsoleUrl } from './urls.mjs';
import regions from './regions.mjs';

const sts = new STSClient({ apiVersion: '2011-06-15' });

/**
 * Returns the alarm name with the suffix portion (anything at the end
 * contained by parens) removed. E.g., `Name (foo)` becomes `Name`
 * @param {String} alarmName
 * @returns String
 */
function cleanName(alarmName) {
  return alarmName
    .replace(/\>/g, '&gt;')
    .replace(/\</g, '&lt;')
    .replace(/\([A-Za-z0-9 _\-]+\)$/, '')
    .replace(/^(FATAL|ERROR|WARN|INFO|CRITICAL|MAJOR|MINOR)/, '')
    .trim();
}

/**
 * Returns the standard message title format for an alarm
 * e.g., OK | Ohio » Cleaned_alarm_name
 * @param {EventBridgeCloudWatchAlarmsEvent} event
 * @returns {String}
 */
function title(event) {
  const name = event.detail.alarmName;
  const region = regions(event.region);
  return `${event.detail.state.value} | ${region} » ${cleanName(name)}`;
}

/**
 * Returns a CloudWatch SDK client with credentials for the account where an
 * alarm originated
 * @param {EventBridgeCloudWatchAlarmsEvent} event
 * @returns {Promise<CloudWatchClient>}
 */
async function cloudWatchClient(event) {
  const accountId = event.account;
  const roleName = process.env.CROSS_ACCOUNT_CLOUDWATCH_ALARM_IAM_ROLE_NAME;

  const role = await sts.send(
    new AssumeRoleCommand({
      RoleArn: `arn:aws:iam::${accountId}:role/${roleName}`,
      RoleSessionName: 'notifications_lambda_reader',
    }),
  );

  return new CloudWatchClient({
    apiVersion: '2010-08-01',
    region: event.region,
    credentials: {
      accessKeyId: role.Credentials.AccessKeyId,
      secretAccessKey: role.Credentials.SecretAccessKey,
      sessionToken: role.Credentials.SessionToken,
    },
  });
}

/**
 * @param {EventBridgeCloudWatchAlarmsEvent} event
 * @param {DescribeAlarmsOutput} desc
 * @param {DescribeAlarmHistoryOutput} history
 * @returns {Promise<String[]>}
 */
async function detailLines(event, desc, history, cloudWatchClient) {
  switch (event.detail.state.value) {
    case 'INSUFFICIENT_DATA':
      return ['Details not implemented for `INSUFFICIENT_DATA`'];
    case 'OK':
      return await okDetailLines(event, desc, history, cloudWatchClient);
    case 'ALARM':
      return await alarmDetailLines(event, desc, history);
    default:
      return [];
  }
}

/**
 * Returns the notification title as fallback text
 * @param {EventBridgeCloudWatchAlarmsEvent} event
 * @returns {Promise<String>}
 */
export async function fallback(event) {
  return title(event);
}
/**
 * Returns all the Slack message blocks that will make up the content of the
 * alarm notification being sent to Slack. The structure is roughly:
 * - Linked title
 * - Details about the new alarm state (cause, duration, etc)
 * - (For ALARM only) The full text description of the alarm
 * @param {EventBridgeCloudWatchAlarmsEvent} event
 * @returns {Promise<any[]>}
 */

export async function blocks(event) {
  const blox = [];

  const cloudwatch = await cloudWatchClient(event);

  // Fetch the full description of the alarm
  const desc = await cloudwatch.send(
    new DescribeAlarmsCommand({
      AlarmNames: [event.detail.alarmName],
    }),
  );
  // Fetch all state transitions from the last 24 hours
  const historyStart = new Date();
  historyStart.setUTCHours(-24);
  const history = await cloudwatch.send(
    new DescribeAlarmHistoryCommand({
      AlarmName: event.detail.alarmName,
      HistoryItemType: 'StateUpdate',
      StartDate: historyStart,
      EndDate: new Date(),
      MaxRecords: 100,
    }),
  );
  // Linked title block
  blox.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*<${alarmConsoleUrl(event)}|${title(event)}>*`,
    },
  });

  const lines = [];

  lines.push(...(await detailLines(event, desc, history, cloudwatch)));

  let text = lines.join('\n');

  // Text blocks within attachments have a 3000 character limit. If the text
  // is too large, try removing the vertical annotations from the CloudWatch
  // Alarms URL, since they can be long if there have been many recent alarms
  // if (text.length > 3000) {
  //   console.info(
  //     JSON.stringify({
  //       textLength: text.length,
  //       msg: 'Vertical annotations being truncated',
  //     }),
  //   );
  //   text = text.replace(/(~vertical.*?\)\)\))/, ')');
  // }

  // If the text is still too long, remove all annotations
  if (text.length > 3000) {
    console.info(
      JSON.stringify({
        textLength: text.length,
        msg: 'All annotations being truncated',
      }),
    );
    text = text.replace(/(~annotations.*?\)\)\))/, '');
  }

  // If the text is still too long, brute force it down to 3000 characters
  if (text.length > 3000) {
    text = text.substring(0, 3000);
  }

  blox.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text,
    },
  });

  // Include a block with the alarm's full text description for ALARM states
  if (
    event.detail.state.value === 'ALARM' &&
    event.detail.configuration?.description
  ) {
    blox.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: event.detail.configuration.description,
      },
    });
  }

  return blox;
}

/** @typedef {import('./index').EventBridgeCloudWatchAlarmsEvent} EventBridgeCloudWatchAlarmsEvent */

const AWS = require('aws-sdk');
const regions = require('./regions');
const ok = require('./builder-ok');
const alarm = require('./builder-alarm');
const urls = require('./urls');

const sts = new AWS.STS({ apiVersion: '2011-06-15' });

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
    .replace(/\([A-Za-z0-9_\-]+\)$/, '')
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
  const region = regions.descriptor(event.region);
  return `${event.detail.state.value} | ${region} » ${cleanName(name)}`;
}

/**
 * Returns a CloudWatch SDK client with credentials for the account where an
 * alarm originated
 * @param {EventBridgeCloudWatchAlarmsEvent} event
 */
async function cloudWatchClient(event) {
  const accountId = event.account;
  const roleName = process.env.CROSS_ACCOUNT_CLOUDWATCH_ALARM_IAM_ROLE_NAME;

  const role = await sts
    .assumeRole({
      RoleArn: `arn:aws:iam::${accountId}:role/${roleName}`,
      RoleSessionName: 'notifications_lambda_reader',
    })
    .promise();

  return new AWS.CloudWatch({
    apiVersion: '2010-08-01',
    region: event.region,
    credentials: new AWS.Credentials(
      role.Credentials.AccessKeyId,
      role.Credentials.SecretAccessKey,
      role.Credentials.SessionToken,
    ),
  });
}

/**
 * @param {EventBridgeCloudWatchAlarmsEvent} event
 * @param {AWS.CloudWatch.DescribeAlarmsOutput} desc
 * @param {AWS.CloudWatch.DescribeAlarmHistoryOutput} history
 * @returns {Promise<String[]>}
 */
async function detailLines(event, desc, history) {
  switch (event.detail.state.value) {
    case 'INSUFFICIENT_DATA':
      return ['Details not implemented for `INSUFFICIENT_DATA`'];
    case 'OK':
      return await ok.detailLines(event, desc, history);
    case 'ALARM':
      return await alarm.detailLines(event, desc, history);
    default:
      return [];
  }
}

module.exports = {
  /**
   * Returns all the Slack message blocks that will make up the content of the
   * alarm notification being sent to Slack. The structure is roughly:
   * - Linked title
   * - Details about the new alarm state (cause, duration, etc)
   * - (For ALARM only) The full text description of the alarm
   * @param {EventBridgeCloudWatchAlarmsEvent} event
   * @returns {Promise<any[]>}
   */
  async blocks(event) {
    const blox = [];

    const cloudwatch = await cloudWatchClient(event);

    // Fetch the full description of the alarm
    const desc = await cloudwatch
      .describeAlarms({ AlarmNames: [event.detail.alarmName] })
      .promise();

    // Fetch all state transitions from the last 24 hours
    const historyStart = new Date();
    historyStart.setUTCHours(-24);
    const history = await cloudwatch
      .describeAlarmHistory({
        AlarmName: event.detail.alarmName,
        HistoryItemType: 'StateUpdate',
        StartDate: historyStart,
        EndDate: new Date(),
        MaxRecords: 100,
      })
      .promise();

    // Linked title block
    blox.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*<${urls.alarmConsole(event)}|${title(event)}>*`,
      },
    });

    const lines = [];

    lines.push(...(await detailLines(event, desc, history)));

    let text = lines.join('\n');

    // Text blocks within attachments have a 3000 character limit. If the text
    // is too large, try removing the annotations from the CloudWatch Alarms
    // URL, since they can be long if there have been many recent alarms
    if (text.length > 3000) {
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
  },
};

/** @typedef { import('@aws-sdk/client-cloudwatch').AlarmType } AlarmType */
/** @typedef { import('@aws-sdk/client-cloudwatch').StateValue } StateValue */

import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import {
  CloudWatchClient,
  DescribeAlarmsCommand,
} from '@aws-sdk/client-cloudwatch';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import regions from './regions.mjs';
import { alarmConsole } from './urls.mjs';

const sts = new STSClient({ apiVersion: '2011-06-15' });
const eventbridge = new EventBridgeClient({ apiVersion: '2015-10-07' });

async function cloudWatchClient(accountId, region) {
  const roleName = process.env.CROSS_ACCOUNT_CLOUDWATCH_ALARM_IAM_ROLE_NAME;

  const role = await sts.send(
    new AssumeRoleCommand({
      RoleArn: `arn:aws:iam::${accountId}:role/${roleName}`,
      RoleSessionName: 'reminders_lambda_reader',
    }),
  );

  return new CloudWatchClient({
    apiVersion: '2010-08-01',
    region: region,
    credentials: {
      accessKeyId: role.Credentials.AccessKeyId,
      secretAccessKey: role.Credentials.SecretAccessKey,
      sessionToken: role.Credentials.SessionToken,
    },
  });
}

/**
 *
 * @param {CloudWatchClient} cloudWatchClient
 * @param {string} nextToken
 * @returns {Promise<Object>}
 */
async function describeAllAlarms(cloudWatchClient, nextToken) {
  /** @type {AlarmType[]} */
  const alarmTypes = ['CompositeAlarm', 'MetricAlarm'];

  /** @type {StateValue} */
  const stateValue = 'ALARM';

  const params = {
    StateValue: stateValue,
    AlarmTypes: alarmTypes,
    ...(nextToken && { NextToken: nextToken }),
  };

  const data = await cloudWatchClient.send(new DescribeAlarmsCommand(params));

  const results = {
    CompositeAlarms: [],
    MetricAlarms: [],
  };

  if (data.CompositeAlarms) {
    results.CompositeAlarms.push(...data.CompositeAlarms);
  }

  if (data.MetricAlarms) {
    results.MetricAlarms.push(...data.MetricAlarms);
  }

  if (data.NextToken) {
    const more = await describeAllAlarms(cloudWatchClient, data.NextToken);

    if (more) {
      results.CompositeAlarms.push(...more.CompositeAlarms);
      results.MetricAlarms.push(...more.MetricAlarms);
    }
  }

  return results;
}

function cleanName(alarmName) {
  return alarmName
    .replace(/\>/g, '&gt;')
    .replace(/\</g, '&lt;')
    .replace(/\([A-Za-z0-9_\-]+\)$/, '')
    .replace(/^(FATAL|ERROR|WARN|INFO|CRITICAL|MAJOR|MINOR)/, '')
    .trim();
}

function title(alarmDetail) {
  const name = alarmDetail.AlarmName;
  const region = regions(alarmDetail.AlarmArn.split(':')[3]);
  return `${alarmDetail.StateValue} | ${region} » ${cleanName(name)}`;
}

function started(reasonData) {
  if (reasonData?.startDate || reasonData?.evaluatedDatapoints?.length) {
    const now = +new Date();

    const startedAt =
      reasonData.startDate ||
      reasonData.evaluatedDatapoints
        .map((d) => d.timestamp)
        .sort((a, b) => b - a)[0];
    const startTime = Date.parse(startedAt);

    const dif = now - startTime;
    const difSec = dif / 1000;

    let duration = difSec;
    let durationUnit = 'seconds';

    if (difSec >= 86400) {
      duration = Math.round(difSec / 86400);
      durationUnit = 'days';
    } else if (difSec >= 3600) {
      duration = Math.round(difSec / 3600);
      durationUnit = 'hours';
    } else if (difSec >= 60) {
      duration = Math.round(difSec / 60);
      durationUnit = 'minutes';
    }

    return `*Started:* ${duration} ${durationUnit} ago`;
  }
}

function filterByName(alarm) {
  return !(
    alarm.AlarmName.includes('AS:In') ||
    alarm.AlarmName.includes('AS:Out') ||
    alarm.AlarmName.includes('TargetTracking') ||
    alarm.AlarmName.includes('ScaleInAlarm') ||
    alarm.AlarmName.includes('ScaleOutAlarm') ||
    alarm.AlarmName.includes('Production Pollers Low CPU Usage')
  );
}

function filterByDuration(alarm) {
  if (alarm.EstimatedDuration) {
    return alarm.EstimatedDuration > 3600; // 1 hour
  }

  return true;
}

function injectDuration(alarm) {
  if (alarm.StateReasonData) {
    const reasonData = JSON.parse(alarm.StateReasonData);

    if (reasonData?.startDate || reasonData?.evaluatedDatapoints?.length) {
      const now = +new Date();

      const startedAt =
        reasonData.startDate ||
        reasonData.evaluatedDatapoints
          .map((d) => d.timestamp)
          .sort((a, b) => b - a)[0];
      const startTime = Date.parse(startedAt);

      const dif = now - startTime;
      const difSec = dif / 1000;

      alarm.EstimatedDuration = difSec;
    }
  }

  return alarm;
}

function sortByDuration(a, b) {
  if (a.EstimatedDuration && b.EstimatedDuration) {
    return b.EstimatedDuration - a.EstimatedDuration;
  }

  return -1;
}

export const handler = async (event) => {
  console.log(JSON.stringify(event));

  const alarms = {
    CompositeAlarms: [],
    MetricAlarms: [],
  };

  for (const accountId of process.env.SEARCH_ACCOUNTS.split(',')) {
    for (const region of process.env.SEARCH_REGIONS.split(',')) {
      const cloudwatch = await cloudWatchClient(accountId, region);

      const data = await describeAllAlarms(cloudwatch, undefined);

      alarms.CompositeAlarms.push(...data.CompositeAlarms);
      alarms.MetricAlarms.push(
        ...data.MetricAlarms.filter(filterByName)
          .map(injectDuration)
          .filter(filterByDuration)
          .sort(sortByDuration),
      );
    }
  }

  console.log(JSON.stringify(alarms));

  const count = alarms.CompositeAlarms.length + alarms.MetricAlarms.length;

  const blocks = [];

  if (count === 0) {
    return;
  }

  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: ':stopwatch: Long-running Alarms',
      emoji: true,
    },
  });

  blocks.push(
    ...alarms.MetricAlarms.map((a) => {
      const lines = [`*<${alarmConsole(a)}|${title(a)}>*`];

      if (a.StateReasonData) {
        const reasonData = JSON.parse(a.StateReasonData);
        lines.push(started(reasonData));
      }

      return {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: lines.join('\n'),
        },
      };
    }),
  );

  console.log(blocks);

  await eventbridge.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: 'org.prx.cloudwatch-alarm-reminders',
          DetailType: 'Slack Message Relay Message Payload',
          Detail: JSON.stringify({
            username: 'Amazon CloudWatch Alarms',
            icon_emoji: ':ops-cloudwatch-alarm:',
            channel: 'G2QH6NMEH', // #ops-error
            attachments: [
              {
                color: '#a30200',
                fallback: `There are *${count}* long-running alarms`,
                blocks,
              },
            ],
          }),
        },
      ],
    }),
  );
};

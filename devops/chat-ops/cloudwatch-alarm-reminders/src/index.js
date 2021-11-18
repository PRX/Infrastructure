/**
 * TODO This Lambda function is subscribed to SNS topics, EventBridge buses, and
 * other message services. It expects that any message data it receives from
 * those sources is a fully-formed Slack message payload, and relays that
 * payload to Slack via the chat.postMessage Web API method [1].
 *
 * 1. https://api.slack.com/methods/chat.postMessage
 */

const AWS = require('aws-sdk');
const regions = require('./regions');
const urls = require('./urls');

const sns = new AWS.SNS({
  apiVersion: '2010-03-31',
  region: process.env.SLACK_MESSAGE_RELAY_SNS_TOPIC_ARN.split(':')[3],
});
const sts = new AWS.STS({ apiVersion: '2011-06-15' });

async function cloudWatchClient(accountId, region) {
  const roleName = process.env.CROSS_ACCOUNT_CLOUDWATCH_ALARM_IAM_ROLE_NAME;

  const role = await sts
    .assumeRole({
      RoleArn: `arn:aws:iam::${accountId}:role/${roleName}`,
      RoleSessionName: 'reminders_lambda_reader',
    })
    .promise();

  return new AWS.CloudWatch({
    apiVersion: '2010-08-01',
    region: region,
    credentials: new AWS.Credentials(
      role.Credentials.AccessKeyId,
      role.Credentials.SecretAccessKey,
      role.Credentials.SessionToken,
    ),
  });
}

async function describeAllAlarms(client, nextToken) {
  return new Promise((resolve, reject) => {
    const params = {
      StateValue: 'ALARM',
      AlarmTypes: ['CompositeAlarm', 'MetricAlarm'],
      ...(nextToken && { NextToken: nextToken }),
    };

    client.describeAlarms(params, async (error, data) => {
      if (error) {
        reject(error);
      } else {
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
          try {
            const more = await describeAllAlarms(client, data.NextToken);

            if (more) {
              results.CompositeAlarms.push(...more.CompositeAlarms);
              results.MetricAlarms.push(...more.MetricAlarms);
            }
          } catch (err) {
            reject(err);
          }
        }

        resolve(results);
      }
    });
  });
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
  const region = regions.descriptor(alarmDetail.AlarmArn.split(':')[3]);
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

exports.handler = async (event) => {
  console.log(JSON.stringify(event));

  const alarms = {
    CompositeAlarms: [],
    MetricAlarms: [],
  };

  for (const accountId of process.env.SEARCH_ACCOUNTS.split(',')) {
    for (const region of process.env.SEARCH_REGIONS.split(',')) {
      const cloudwatch = await cloudWatchClient(accountId, region);

      const data = await describeAllAlarms(cloudwatch);

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
      text: 'Long-running Alarms',
      emoji: true,
    },
  });

  blocks.push(
    ...alarms.MetricAlarms.map((a) => {
      const lines = [`*<${urls.alarmConsole(a)}|${title(a)}>*`];

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

  await sns
    .publish({
      TopicArn: process.env.SLACK_MESSAGE_RELAY_SNS_TOPIC_ARN,
      Message: JSON.stringify({
        username: 'Amazon CloudWatch Alarms',
        icon_emoji: ':ops-cloudwatch-alarm:',
        channel: '#sandbox2',
        attachments: [
          {
            color: '#a30200',
            fallback: `There are *${count}* long-running alarms`,
            blocks,
          },
        ],
      }),
    })
    .promise();
};

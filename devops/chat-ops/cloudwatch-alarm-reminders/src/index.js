/**
 * TODO This Lambda function is subscribed to SNS topics, EventBridge buses, and
 * other message services. It expects that any message data it receives from
 * those sources is a fully-formed Slack message payload, and relays that
 * payload to Slack via the chat.postMessage Web API method [1].
 *
 * 1. https://api.slack.com/methods/chat.postMessage
 */

const AWS = require('aws-sdk');

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

exports.handler = async (event) => {
  console.log(JSON.stringify(event));

  const alarms = [];

  for (const accountId of process.env.SEARCH_ACCOUNTS.split(',')) {
    for (const region of process.env.SEARCH_REGIONS.split(',')) {
      const cloudwatch = await cloudWatchClient(accountId, region);

      const data = await cloudwatch
        .describeAlarms({
          StateValue: 'ALARM',
          AlarmTypes: ['CompositeAlarm', 'MetricAlarm'],
        })
        .promise();

      alarms.push(...data.MetricAlarms.map((a) => a.AlarmName));
    }
  }

  await sns
    .publish({
      TopicArn: process.env.SLACK_MESSAGE_RELAY_SNS_TOPIC_ARN,
      Message: JSON.stringify({
        username: 'Amazon CloudWatch Alarms',
        icon_emoji: ':ops-cloudwatch-alarm:',
        channel: '#sandbox2',
        text: alarms.join(', '),
      }),
    })
    .promise();
};

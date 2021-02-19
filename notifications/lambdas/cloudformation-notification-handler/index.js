// Invoked by: SNS Subscription
// Returns: Error or status message
//
// Receives notifications related to CloudFormation stack changes, and prepares
// Slack messages. for them. The messages are sent to the Slack Message Relay
// SNS topic in order to be sent to Slack. Messages about the stack being
// updated directly are sent to the info channel, and other messages are sent
// to the debug channel

const AWS = require('aws-sdk');

const sns = new AWS.SNS({ apiVersion: '2010-03-31' });

const SLACK_DEBUG_CHANNEL = '#ops-debug';
const SLACK_INFO_CHANNEL = '#ops-info';
const SLACK_ICON = ':ops-cloudformation:';
const SLACK_USERNAME = 'AWS CloudFormation';

// These colors match events in the CloudFormation console
function colorForResourceStatus(status) {
  const green = [
    'CREATE_COMPLETE',
    'ROLLBACK_COMPLETE',
    'UPDATE_COMPLETE',
    'UPDATE_ROLLBACK_COMPLETE',
  ];

  const yellow = [
    'CREATE_IN_PROGRESS',
    'DELETE_IN_PROGRESS',
    'REVIEW_IN_PROGRESS',
    'ROLLBACK_IN_PROGRESS',
    'UPDATE_IN_PROGRESS',
    'UPDATE_COMPLETE_CLEANUP_IN_PROGRESS',
  ];

  const red = [
    'CREATE_FAILED',
    'DELETE_FAILED',
    'ROLLBACK_FAILED',
    'UPDATE_ROLLBACK_FAILED',
    'UPDATE_ROLLBACK_IN_PROGRESS',
    'UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS',
  ];

  const grey = ['DELETE_COMPLETE'];

  if (green.includes(status)) {
    return 'good';
  } else if (yellow.includes(status)) {
    return 'warning';
  } else if (red.includes(status)) {
    return 'danger';
  } else if (grey.includes(status)) {
    return '#AAAAAA';
  }

  return '#000000';
}

function messageForEvent(event) {
  const note = event.Records[0].Sns.Message;

  // Each event includes information about the stack where the change is
  // happening
  const stackId = note.match(/StackId='([a-zA-Z0-9-:/]+)'\n/)[1];
  const stackName = note.match(/StackName='([a-zA-Z0-9-]+)'\n/)[1];
  const timestamp = note.match(/Timestamp='([0-9TZ.:-]+)'\n/)[1];

  // And information about the resource that is actually changing
  const resourceType = note.match(/ResourceType='([a-zA-Z0-9-:]+)'\n/)[1];
  const resourceId = note.match(/LogicalResourceId='(.+)'\n/)[1];
  const resourceStatus = note.match(/ResourceStatus='([a-zA-Z_]+)'\n/)[1];
  const resourceReason = note.match(/ResourceStatusReason='(.*)'\n/)[1];

  const region = stackId.split(':')[3];
  const stackUrl = `https://${region}.console.aws.amazon.com/cloudformation/home#/stack/detail?stackId=${stackId}`;

  const channel =
    stackName === resourceId ? SLACK_INFO_CHANNEL : SLACK_DEBUG_CHANNEL;

  return {
    channel,
    username: SLACK_USERNAME,
    icon_emoji: SLACK_ICON,
    attachments: [
      {
        color: colorForResourceStatus(resourceStatus),
        footer: `${resourceStatus} – ${region}`,
        author_name: stackName,
        author_link: stackUrl,
        ts: Math.floor(Date.parse(timestamp) / 1000),
        mrkdwn_in: ['text'],
        fields: [
          {
            title: resourceType,
            short: false,
            value: resourceId,
          },
        ],
        text: resourceReason ? `_${resourceReason}_` : '',
        fallback: `${resourceStatus}: ${stackName}:::${resourceId}`,
      },
    ],
  };
}

exports.handler = async (event) => {
  const message = messageForEvent(event);
  await sns
    .publish({
      TopicArn: process.env.SLACK_MESSAGE_RELAY_TOPIC_ARN,
      Message: JSON.stringify(message),
    })
    .promise();
};

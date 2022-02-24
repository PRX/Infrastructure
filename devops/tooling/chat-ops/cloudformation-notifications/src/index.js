// Invoked by: SNS Subscription
// Returns: Error or status message
//
// Receives notifications related to CloudFormation stack changes, and prepares
// Slack messages. for them. The messages are sent to the Slack Message Relay
// SNS topic in order to be sent to Slack. Messages about the stack being
// updated directly are sent to the info channel, and other messages are sent
// to the debug channel
//
// These notifications may come from any region or any account.

const AWS = require('aws-sdk');

const sns = new AWS.SNS({
  apiVersion: '2010-03-31',
  region: process.env.SLACK_MESSAGE_RELAY_SNS_TOPIC_ARN.split(':')[3],
});

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
  }

  if (yellow.includes(status)) {
    return 'warning';
  }

  if (red.includes(status)) {
    return 'danger';
  }

  if (grey.includes(status)) {
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
  const physicalResourceId = note.match(/PhysicalResourceId='(.+)'\n/)[1];
  const resourceStatus = note.match(/ResourceStatus='([a-zA-Z_]+)'\n/)[1];
  const resourceReason = note.match(/ResourceStatusReason='(.*)'\n/)[1];

  const region = stackId.split(':')[3];
  const stackUrl = `https://${region}.console.aws.amazon.com/cloudformation/home#/stack/detail?stackId=${stackId}`;

  const msg = {
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

  const concerning = [
    'ROLLBACK_COMPLETE',
    'UPDATE_ROLLBACK_COMPLETE',
    'DELETE_IN_PROGRESS',
    'ROLLBACK_IN_PROGRESS',
    'CREATE_FAILED',
    'DELETE_FAILED',
    'ROLLBACK_FAILED',
    'UPDATE_ROLLBACK_FAILED',
    'UPDATE_ROLLBACK_IN_PROGRESS',
    'UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS',
  ];

  if (resourceStatus === 'DELETE_SKIPPED') {
    msg.channel = '#ops-delete-skipped';
    return msg;
  }

  // For root stacks, send all start, finish, and concerning status
  // notifications to INFO
  if (
    resourceType === 'AWS::CloudFormation::Stack' &&
    (resourceId.endsWith('root-staging') ||
      resourceId.endsWith('root-production')) &&
    (concerning.includes(resourceStatus) ||
      ['UPDATE_IN_PROGRESS', 'UPDATE_COMPLETE'].includes(resourceStatus))
  ) {
    msg.channel = SLACK_INFO_CHANNEL;
    msg.attachments[0].text = physicalResourceId;
    return msg;
  }

  // For everything that isn't a root stack, send any notifications that
  // include a reason to DEBUG. Reasons are most often provided when there is
  // an issue ("resources failed to create", "handler returned message", etc).
  // But some nominal updates do include reasons.
  // Certain irrelevant reasons are filtered out.
  if (
    resourceReason &&
    ![
      'User Initiated',
      'Transformation succeeded',
      'Resource creation Initiated',
      'Requested update required the provider to create a new physical resource',
      'Requested update requires the creation of a new physical resource; hence creating one.',
    ].includes(resourceReason)
  ) {
    msg.channel = SLACK_DEBUG_CHANNEL;
    return msg;
  }

  return;
}

exports.handler = async (event) => {
  console.log(JSON.stringify(event));
  const message = messageForEvent(event);

  if (message) {
    await sns
      .publish({
        TopicArn: process.env.SLACK_MESSAGE_RELAY_SNS_TOPIC_ARN,
        Message: JSON.stringify(message),
      })
      .promise();
  }
};

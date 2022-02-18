// Invoked by: SNS Subscription
// Returns: Error or status message
//
// Receives notifications related to CloudFormation stack changes, and prepares
// Slack messages. for them. The messages are sent to the Slack Message Relay
// SNS topic in order to be sent to Slack. Messages about the stack being
// updated directly are sent to the info channel, and other messages are sent
// to the debug channel

const AWS = require('aws-sdk');

const sns = new AWS.SNS({
  apiVersion: '2010-03-31',
  region: process.env.SLACK_MESSAGE_RELAY_TOPIC_ARN.split(':')[3],
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

  if (resourceType === 'AWS::CloudFormation::Stack') {
    // For notifications about Stack resources
    if (
      resourceId.endsWith('root-staging') ||
      resourceId.endsWith('root-production')
    ) {
      // For root stacks…
      if (
        concerning.includes(resourceStatus) ||
        ['UPDATE_IN_PROGRESS', 'UPDATE_COMPLETE'].includes(resourceStatus)
      ) {
        // Send only select notifications to INFO
        // Under normal circumstances, this will just be the UPDATE and COMPLETE notifications
        msg.channel = SLACK_INFO_CHANNEL;
        return msg;
      }
    } else {
      // For non-root stacks
      if (concerning.includes(resourceStatus)) {
        // Send all concerning status to DEBUG
        msg.channel = SLACK_DEBUG_CHANNEL;
        return msg;
      } else {
        // For non-concerning statuses
        if (resourceReason) {
          // If there's a reason
          if (
            !['User Initiated', 'Transformation succeeded'].includes(
              resourceReason,
            )
          ) {
            // And the reason is NOT from the well-known list
            // send to DEBUG
            msg.channel = SLACK_DEBUG_CHANNEL;
            return msg;
          }
          return;
        } else {
          // If there no reason, never send it
          return;
        }
      }
    }
  } else {
    // For all non-stack resources
    if (concerning.includes(resourceStatus)) {
      // For notifications about concerning statuses
      if (resourceReason && resourceReason !== 'User Initiated') {
        // Send notifications with abnormal reasons to DEBUG
        msg.channel = SLACK_DEBUG_CHANNEL;
        return msg;
      }
    }
  }

  return;
}

exports.handler = async (event) => {
  console.log(JSON.stringify(event));
  const message = messageForEvent(event);

  if (message) {
    await sns
      .publish({
        TopicArn: process.env.SLACK_MESSAGE_RELAY_TOPIC_ARN,
        Message: JSON.stringify(message),
      })
      .promise();
  }
};

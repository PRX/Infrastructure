const regions = require('./regions');
const accounts = require('./accounts');

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
    'UPDATE_FAILED',
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

exports.message = function (event) {
  // Each event includes information about the stack where the change is
  // happening. These will be present on both stack status and resource status
  // events.
  const stackId = event.detail['stack-id'];
  const timestamp = event.time;

  // Extract the stack name from the stack ID
  const stackName = stackId.split(':stack/')[1].split('/')[0];

  // Both stack status and resource status events will have a status and reason
  const status = event.detail['status-detals'].status;
  const statusReason = event.detail['status-detals']['status-reason'];

  // For resource status events, there will also be information about the
  // resource that is changing
  // And information about the resource that is actually changing
  const resourceType = event.detail['resource-type'];
  const logicalResourceId = event.detail['logical-resource-id'];
  const physicalResourceId = event.detail['physical-resource-id'];

  const region = event.region;
  const stackUrl = `https://${region}.console.aws.amazon.com/cloudformation/home#/stack/detail?stackId=${stackId}`;

  const regionNickname = regions(region);
  const accountNickname = accounts(event.account);
  const header = [
    `*<${stackUrl}|${accountNickname} - ${regionNickname} » ${stackName}>*`,
    resourceType
      ? `Resource Status Change: ${status} for ${resourceType}`
      : `Stack Status Change: ${status}`,
  ].join('\n');

  const fallback = resourceType
    ? `${accountNickname} - ${regionNickname} » ${resourceType} ${logicalResourceId} in ${stackName} is now ${status}`
    : `${accountNickname} - ${regionNickname} » Stack ${stackName} is now ${status}`;

  const msg = {
    username: SLACK_USERNAME,
    icon_emoji: SLACK_ICON,
    attachments: [
      {
        color: colorForResourceStatus(status),
        fallback,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: header,
            },
          },
          // {
          //   type: 'section',
          //   text: {
          //     type: 'mrkdwn',
          //     text: 'Pipeline execution has started.',
          //   },
          // },
        ],
      },
    ],
  };
};

import regions from './regions.mjs';
import accounts from './accounts.mjs';

const SLACK_DEBUG_CHANNEL = 'G2QHC11SM'; // #ops-debug
const SLACK_INFO_CHANNEL = 'G2QHBL6UX'; // #ops-info
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
    return '#2eb886';
  }

  if (yellow.includes(status)) {
    return '#f4f323';
  }

  if (red.includes(status)) {
    return '#a30200';
  }

  if (grey.includes(status)) {
    return '#AAAAAA';
  }

  return '#000000';
}

const concerning = [
  'ROLLBACK_COMPLETE',
  'UPDATE_ROLLBACK_COMPLETE',
  'DELETE_IN_PROGRESS',
  'ROLLBACK_IN_PROGRESS',
  'CREATE_FAILED',
  'DELETE_FAILED',
  'UPDATE_FAILED',
  'ROLLBACK_FAILED',
  'UPDATE_ROLLBACK_FAILED',
  'UPDATE_ROLLBACK_IN_PROGRESS',
  'UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS',
];

export default function message(event) {
  // Each event includes information about the stack where the change is
  // happening. These will be present on both stack status and resource status
  // events.
  const stackId = event.detail['stack-id'];

  // Extract the stack name from the stack ID
  const stackName = stackId.split(':stack/')[1].split('/')[0];

  // Both stack status and resource status events will have a status and reason
  const status = event.detail['status-details'].status;
  const statusReason = event.detail['status-details']['status-reason'];

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
      ? `Resource Status Change: *${status}* for \`${resourceType}\``
      : `Stack Status Change: *${status}*`,
  ].join('\n');

  const fallback = resourceType
    ? `${accountNickname} - ${regionNickname} » ${resourceType} ${logicalResourceId} in ${stackName} is now ${status}`
    : `${accountNickname} - ${regionNickname} » Stack ${stackName} is now ${status}`;

  const msg = {
    username: SLACK_USERNAME,
    icon_emoji: SLACK_ICON,
    channel: '#sandbox2',
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
        ],
      },
    ],
  };

  // DELETE_SKIPPED events are funnelled to a specific Slack channel so they
  // can be cleaned up if necessary
  if (status === 'DELETE_SKIPPED') {
    msg.channel = '#ops-delete-skipped';
    msg.attachments[0].blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: physicalResourceId
          ? `Physical ID: \`${physicalResourceId}\``
          : 'No physical ID',
      },
    });

    return msg;
  }

  // For Spire root stacks, send all start, finish, and concerning status
  // notifications to INFO
  // For stack status events, send all start, finish, and concerning
  // notifications to the INFO channel
  if (
    !resourceType &&
    (stackName.endsWith('root-staging') ||
      stackName.endsWith('root-production')) &&
    (concerning.includes(status) ||
      ['UPDATE_IN_PROGRESS', 'UPDATE_COMPLETE'].includes(status))
  ) {
    msg.channel = SLACK_INFO_CHANNEL;
    // return msg;
    return;
  }

  // For other stacks, send finish and concerning notifications to DEBUG
  if (
    !resourceType &&
    (concerning.includes(status) || ['UPDATE_COMPLETE'].includes(status)) &&
    !stackName.includes('infrastructure-cd-root-')
  ) {
    msg.channel = SLACK_DEBUG_CHANNEL;
    return msg;
  }

  // For everything that isn't a root stack, send any notifications that
  // include a reason to DEBUG. Reasons are most often provided when there is
  // an issue ("resources failed to create", "handler returned message", etc).
  // But some nominal updates do include reasons.
  // Certain irrelevant reasons are filtered out.
  if (
    statusReason &&
    ![
      'User Initiated',
      'Transformation succeeded',
      'Resource creation Initiated',
      'Requested update required the provider to create a new physical resource',
      'Requested update requires the creation of a new physical resource; hence creating one.',
    ].includes(statusReason)
  ) {
    msg.channel = SLACK_DEBUG_CHANNEL;
    return msg;
  }

  return;
}

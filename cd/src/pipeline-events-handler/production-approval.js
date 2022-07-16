/**
 * This Lambda receives messages generated by a CodePipeline manual approval
 * action, via SNS. It sends a Slack message with information about the
 * pending approval along with actions (buttons) to take from within Slack
 * to approve or reject the release.
 */

/**
 * @typedef { import('aws-lambda').SNSEvent } SNSEvent
 * @typedef { import('@slack/web-api').ChatPostMessageArguments } ChatPostMessageArguments
 */

const AWS = require('aws-sdk');
const regions = require('./etc/regions');
const urls = require('./etc/urls');
const pipelineNames = require('./etc/pipeline-names');
const deltas = require('./deltas/deltas');

const sns = new AWS.SNS({
  apiVersion: '2010-03-31',
  region: process.env.SLACK_MESSAGE_RELAY_TOPIC_ARN.split(':')[3],
});

/**
 * Constructs a Slack message payload with information about stack parameter
 * changes, and interactive buttons to approve or reject a deploy
 * @param {CodePipelineApprovalNotification} approvalNotification
 * @returns {Promise<ChatPostMessageArguments>}
 */
async function buildMessage(approvalNotification) {
  const { approval } = approvalNotification;

  /** @type {CodePipelineApprovalCustomData} */
  const customData = JSON.parse(approval.customData);
  const { StackName, ChangeSetName, AccountId, PipelineExecutionId } =
    customData;

  // A bunch of values that will be required to fulfill the action are stuffed
  // into the actions' values as JSON. This object should match the parameters
  // for codepipeline.putApprovalResult().
  /** @type {AWS.CodePipeline.PutApprovalResultInput} */
  const approvalParams = {
    pipelineName: approval.pipelineName,
    stageName: approval.stageName,
    actionName: approval.actionName,
    token: approval.token,
    result: {
      status: '',
      summary: '',
    },
  };

  // The summary gets overridden before the approval result is sent, so this
  // is just a convenient place to pass some extra values, albeit a bit
  // hacky
  const summaryData = `${approvalNotification.region},${AccountId}`;

  // These get Object.assigned below to the approvalParams
  /** @type {AWS.CodePipeline.ApprovalResult} */
  const approvedResult = { status: 'Approved', summary: summaryData };
  /** @type {AWS.CodePipeline.ApprovalResult} */
  const rejectedResult = { status: 'Rejected', summary: summaryData };

  const regionName = regions(process.env.AWS_REGION);
  const pipelineName = pipelineNames(approval.pipelineName);

  // The DevOps Slack app handles the button actions from this message, and is
  // designed to rewrite parts of the message, so it expects a specific message
  // payload structure. If this message changes, the reject/approve/annotate/etc
  // handlers may need to be updated as well.
  return {
    username: 'AWS CodePipeline',
    icon_emoji: ':ops-codepipeline:',
    channel: `#ops-deploys-${approvalNotification.region}`,
    attachments: [
      {
        color: '#0a4a74',
        fallback: `${regionName} ${pipelineName} Approve the production change set deltas`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: [
                `*<${urls.executionConsoleUrl(
                  process.env.AWS_REGION,
                  pipelineName,
                  PipelineExecutionId,
                )}|${regionName} » ${pipelineName}>*`,
                `*Execution ID:* \`${PipelineExecutionId}\``,
              ].join('\n'),
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: 'Production stack change set has been created, and needs approval.',
            },
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: 'Approve',
                  emoji: true,
                },
                style: 'primary',
                value: JSON.stringify(
                  Object.assign(approvalParams, { result: approvedResult }),
                ),
                action_id: 'codepipeline-approval_approve-deploy',
                confirm: {
                  title: {
                    type: 'plain_text',
                    text: 'Production Deploy Approval',
                  },
                  text: {
                    type: 'mrkdwn',
                    text: 'Are you sure you want to approve this CloudFormation change set for the production stack? Approval will trigger an immediate update to the production stack!',
                  },
                  confirm: {
                    type: 'plain_text',
                    text: 'Approve',
                  },
                  deny: {
                    type: 'plain_text',
                    text: 'Cancel',
                  },
                },
              },
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: 'Approve with notes',
                  emoji: true,
                },
                value: JSON.stringify(
                  Object.assign(approvalParams, { result: approvedResult }),
                ),
                action_id: 'codepipeline-approval_annotate-deploy',
              },
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: 'Reject',
                  emoji: true,
                },
                style: 'danger',
                value: JSON.stringify(
                  Object.assign(approvalParams, { result: rejectedResult }),
                ),
                action_id: 'codepipeline-approval_reject-deploy',
              },
            ],
          },
          {
            type: 'divider',
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: await deltas.parameterDeltaText(StackName, ChangeSetName),
            },
          },
        ],
      },
    ],
  };
}

/**
 * Publishes a Slack message to the relay SNS topic with information about a
 * pending CodePipeline deploy action, with interactive buttons to approve or
 * reject the deploy.
 * @param {SNSEvent} event
 * @returns {Promise<void>}
 */
exports.handler = async (event) => {
  console.log(JSON.stringify(event));

  /** @type {CodePipelineApprovalNotification} */
  const approvalNotification = JSON.parse(event.Records[0].Sns.Message);

  const slackMessage = await buildMessage(approvalNotification);

  await sns
    .publish({
      TopicArn: process.env.SLACK_MESSAGE_RELAY_TOPIC_ARN,
      Message: JSON.stringify(slackMessage),
    })
    .promise();
};

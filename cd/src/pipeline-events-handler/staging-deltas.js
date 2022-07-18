const AWS = require('aws-sdk');
const regions = require('./etc/regions');
const urls = require('./etc/urls');
const pipelineNames = require('./etc/pipeline-names');
const deltas = require('./deltas/deltas');
const { emoji } = require('./etc/execution-emoji');

const codepipeline = new AWS.CodePipeline({ apiVersion: '2015-07-09' });

/**
 * @typedef { import('aws-lambda').SNSEvent } SNSEvent
 * @typedef { import('@slack/web-api').ChatPostMessageArguments } ChatPostMessageArguments
 */

const sns = new AWS.SNS({
  apiVersion: '2010-03-31',
  region: process.env.SLACK_MESSAGE_RELAY_TOPIC_ARN.split(':')[3],
});

/**
 * @param {SNSEvent} event
 * @returns {Promise<void>}
 */
exports.handler = async (event) => {
  console.log(JSON.stringify(event));

  /** @type {CodePipelineApprovalNotification} */
  const approvalNotification = JSON.parse(event.Records[0].Sns.Message);
  const { approval } = approvalNotification;

  /** @type {CodePipelineApprovalCustomData} */
  const customData = JSON.parse(approval.customData);
  const { StackName, ChangeSetName, AccountId, PipelineExecutionId } =
    customData;

  const regionName = regions(process.env.AWS_REGION);
  const pipelineName = pipelineNames(approval.pipelineName);

  await sns
    .publish({
      TopicArn: process.env.SLACK_MESSAGE_RELAY_TOPIC_ARN,
      Message: JSON.stringify({
        channel: `#ops-deploys-${approvalNotification.region}`,
        username: 'AWS CodePipeline',
        icon_emoji: ':ops-codepipeline:',
        attachments: [
          {
            color: '#2576b4',
            fallback: `${regionName} ${pipelineName} Review the staging change set deltas`,
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
                    `*Execution ID:* \`${PipelineExecutionId}\` ${emoji(
                      PipelineExecutionId,
                    )}`,
                  ].join('\n'),
                },
              },
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: [
                    'Staging stack change set has been created, and automatically approved.',
                  ].join('\n'),
                },
              },
              {
                type: 'divider',
              },
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: await deltas.parameterDeltaText(
                    StackName,
                    ChangeSetName,
                  ),
                },
              },
            ],
          },
        ],
      }),
    })
    .promise();

  await codepipeline
    .putApprovalResult({
      pipelineName: approval.pipelineName,
      stageName: approval.stageName,
      actionName: approval.actionName,
      token: approval.token,
      result: {
        status: 'Approved',
        summary: 'Automatically approved',
      },
    })
    .promise();
};

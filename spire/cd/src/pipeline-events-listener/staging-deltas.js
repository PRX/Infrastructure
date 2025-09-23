const {
  EventBridgeClient,
  PutEventsCommand,
} = require('@aws-sdk/client-eventbridge');
const { CodePipeline } = require('@aws-sdk/client-codepipeline');
const regions = require('./etc/regions');
const urls = require('./etc/urls');
const pipelineNames = require('./etc/pipeline-names');
const deltas = require('./deltas/deltas');
const { emoji } = require('./etc/execution-emoji');

const eventbridge = new EventBridgeClient({ apiVersion: '2015-10-07' });
const codepipeline = new CodePipeline({ apiVersion: '2015-07-09' });

/**
 * @typedef { import('aws-lambda').SNSEvent } SNSEvent
 * @typedef { import('@slack/web-api').ChatPostMessageArguments } ChatPostMessageArguments
 */

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

  const region = process.env.AWS_REGION;
  const pipeline = approval.pipelineName;
  const execId = PipelineExecutionId;

  const regionNickname = regions(region);
  const pipelineNickname = pipelineNames(pipeline);
  const pipelineUrl = urls.executionConsoleUrl(region, pipeline, execId);
  const deepLinkRoleName = "AdministratorAccess";
  const urlEncodedPipelineUrl = encodeURIComponent(pipelineUrl);
  const deepPipelineUrl = `https://d-906713e952.awsapps.com/start/#/console?account_id=${AccountId}&role_name=${deepLinkRoleName}&destination=${urlEncodedPipelineUrl}`;
  const icon = emoji(execId);
  const header = [
    `*<${pipelineUrl}|${regionNickname} » ${pipelineNickname}>*`,
    `*Execution ID:* \`${execId}\` ${icon}`,
  ].join('\n');

  const report = await deltas.report(StackName, ChangeSetName);

  await eventbridge.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: 'org.prx.spire-cd',
          DetailType: 'Slack Message Relay Message Payload',
          Detail: JSON.stringify({
            channel: `#ops-deploys-${approvalNotification.region}`,
            username: 'AWS CodePipeline',
            icon_emoji: ':ops-codepipeline:',
            attachments: [
              {
                color: '#2576b4',
                fallback: `${regionNickname} ${pipelineNickname} Review the staging change set deltas`,
                blocks: [
                  {
                    type: 'section',
                    text: {
                      type: 'mrkdwn',
                      text: header,
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
                      text: report.text,
                    },
                  },
                  {
                    type: 'context',
                    elements: [
                      {
                        type: 'mrkdwn',
                        text: `${report.hiddenDeltaCount} deltas were hidden. ${report.rawDeltaCount} parameters were unchanged or ignored.`,
                      },
                    ],
                  },
                ],
              },
            ],
          }),
        },
      ],
    }),
  );

  await codepipeline.putApprovalResult({
    pipelineName: approval.pipelineName,
    stageName: approval.stageName,
    actionName: approval.actionName,
    token: approval.token,
    result: {
      status: 'Approved',
      summary: 'Automatically approved',
    },
  });
};

const {
  EventBridgeClient,
  PutEventsCommand,
} = require('@aws-sdk/client-eventbridge');
const regions = require('../../etc/regions');
const urls = require('../../etc/urls');
const pipelineNames = require('../../etc/pipeline-names');
const { emoji } = require('../../etc/execution-emoji');

const eventbridge = new EventBridgeClient({ apiVersion: '2015-10-07' });

module.exports = async (event) => {
  const region = event.region;
  const pipeline = event.detail.pipeline;
  const execId = event.detail['execution-id'];

  const regionNickname = regions(region);
  const pipelineNickname = pipelineNames(pipeline);
  const pipelineUrl = urls.executionConsoleUrl(region, pipeline, execId);
  const deepLinkRoleName = "AdministratorAccess";
  const urlEncodedPipelineUrl = encodeURIComponent(pipelineUrl);
  const deepPipelineUrl = `https://d-906713e952.awsapps.com/start/#/console?account_id=${event.account}&role_name=${deepLinkRoleName}&destination=${urlEncodedPipelineUrl}`;
  const icon = emoji(execId);
  const header = [
    `*<${deepPipelineUrl}|${regionNickname} » ${pipelineNickname}>*`,
    `*Execution ID:* \`${execId}\` ${icon}`,
  ].join('\n');

  await eventbridge.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: 'org.prx.spire-cd',
          DetailType: 'Slack Message Relay Message Payload',
          Detail: JSON.stringify({
            channel: `#ops-deploys-${event.region}`,
            username: 'AWS CodePipeline',
            icon_emoji: ':ops-codepipeline:',
            attachments: [
              {
                color: '#a30200',
                fallback: `${regionNickname} ${pipelineNickname} has failed.`,
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
                        `${event.detail.stage} \`${event.detail.action}\` has failed.`,
                        `*Reason*: _${
                          event.detail?.['execution-result']?.[
                            'external-execution-summary'
                          ] || 'unknown'
                        }_`,
                      ].join('\n'),
                    },
                  },
                ],
              },
            ],
          }),
        },
      ],
    }),
  );
};

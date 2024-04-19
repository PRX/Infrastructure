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
  const url = urls.executionConsoleUrl(region, pipeline, execId);
  const icon = emoji(execId);
  const header = [
    `*<${url}|${regionNickname} » ${pipelineNickname}>*`,
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
                color: '#f4f323',
                fallback: `${regionNickname} ${pipelineNickname} has started.`,
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
                      text: 'Pipeline execution has started.',
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

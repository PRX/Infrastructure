const { SNS } = require('@aws-sdk/client-sns');
const regions = require('../../etc/regions');
const urls = require('../../etc/urls');
const pipelineNames = require('../../etc/pipeline-names');
const { emoji } = require('../../etc/execution-emoji');

const sns = new SNS({
  apiVersion: '2010-03-31',
  region: process.env.SLACK_MESSAGE_RELAY_TOPIC_ARN.split(':')[3],
});

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

  await sns.publish({
    TopicArn: process.env.SLACK_MESSAGE_RELAY_TOPIC_ARN,
    Message: JSON.stringify({
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
  });
};

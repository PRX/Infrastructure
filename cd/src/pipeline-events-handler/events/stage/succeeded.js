const AWS = require('aws-sdk');
const regions = require('../../etc/regions');
const urls = require('../../etc/urls');
const pipelineNames = require('../../etc/pipeline-names');

const sns = new AWS.SNS({
  apiVersion: '2010-03-31',
  region: process.env.SLACK_MESSAGE_RELAY_TOPIC_ARN.split(':')[3],
});

module.exports = async (event) => {
  const region = regions(event.region);
  const name = pipelineNames(event.detail.pipeline);

  if (['Staging', 'Production'].includes(event.detail.stage)) {
    const color = event.detail.stage === 'Production' ? '#2eb886' : '#2576b4';

    await sns
      .publish({
        TopicArn: process.env.SLACK_MESSAGE_RELAY_TOPIC_ARN,
        Message: JSON.stringify({
          channel: `#ops-deploys-${event.region}`,
          username: 'AWS CodePipeline',
          icon_emoji: ':ops-codepipeline:',
          attachments: [
            {
              color,
              fallback: `${region} ${name} ${event.detail.stage} stage has succeeded.`,
              blocks: [
                {
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: [
                      `*<${urls.executionConsoleUrl(
                        event.region,
                        event.detail.pipeline,
                        event.detail['execution-id'],
                      )}|${region} » ${name}>*`,
                      `*Execution ID:* \`${event.detail['execution-id']}\``,
                    ].join('\n'),
                  },
                },
                {
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: [`${event.detail.stage} stage has succeeded.`].join(
                      '\n',
                    ),
                  },
                },
              ],
            },
          ],
        }),
      })
      .promise();
  }
};

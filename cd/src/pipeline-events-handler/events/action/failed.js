const AWS = require('aws-sdk');
const regions = require('../../etc/regions');
const urls = require('../../etc/urls');
const pipelineNames = require('../../etc/pipeline-names');
const { emoji } = require('../../etc/execution-emoji');

const sns = new AWS.SNS({
  apiVersion: '2010-03-31',
  region: process.env.SLACK_MESSAGE_RELAY_TOPIC_ARN.split(':')[3],
});

module.exports = async (event) => {
  const region = regions(event.region);
  const name = pipelineNames(event.detail.pipeline);

  await sns
    .publish({
      TopicArn: process.env.SLACK_MESSAGE_RELAY_TOPIC_ARN,
      Message: JSON.stringify({
        channel: `#ops-deploys-${event.region}`,
        username: 'AWS CodePipeline',
        icon_emoji: ':ops-codepipeline:',
        attachments: [
          {
            color: '#a30200',
            fallback: `${region} ${name} has failed.`,
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
                    `*Execution ID:* \`${
                      event.detail['execution-id']
                    }\` ${emoji(event.detail['execution-id'])}`,
                  ].join('\n'),
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
    })
    .promise();
};

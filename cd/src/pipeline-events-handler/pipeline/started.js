const AWS = require('aws-sdk');
const regions = require('../regions');
const urls = require('../urls');

const sns = new AWS.SNS({
  apiVersion: '2010-03-31',
  region: process.env.SLACK_MESSAGE_RELAY_TOPIC_ARN.split(':')[3],
});

module.exports = async (event) => {
  const region = regions(event.region);

  await sns
    .publish({
      TopicArn: process.env.SLACK_MESSAGE_RELAY_TOPIC_ARN,
      Message: JSON.stringify({
        channel: '#sandbox2',
        username: 'AWS CodePipeline',
        icon_emoji: ':ops-codepipeline:',
        attachments: [
          {
            color: '#f4f323',
            fallback: `${region} core CD pipeline has started.`,
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `*<${urls.executionConsoleUrl}|${region} » Core CD Pipeline>*`,
                },
              },
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: [
                    'Pipeline execution has started.',
                    `*Execution ID:* \`${event.detail['execution-id']}\``,
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

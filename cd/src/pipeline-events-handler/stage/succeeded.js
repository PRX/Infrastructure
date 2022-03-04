const AWS = require('aws-sdk');
const regions = require('../regions');
const urls = require('../urls');

const sns = new AWS.SNS({
  apiVersion: '2010-03-31',
  region: process.env.SLACK_MESSAGE_RELAY_TOPIC_ARN.split(':')[3],
});

module.exports = async (event) => {
  const region = regions(event.region);

  if (['Staging', 'Production'].includes(event.detail.stage)) {
    await sns
      .publish({
        TopicArn: process.env.SLACK_MESSAGE_RELAY_TOPIC_ARN,
        Message: JSON.stringify({
          channel: '#ops-deploys',
          username: 'AWS CodePipeline',
          icon_emoji: ':ops-codepipeline:',
          attachments: [
            {
              color: '#2eb886',
              fallback: `${region} core CD ${event.detail.stage} stage has succeeded.`,
              blocks: [
                {
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: `*<${urls.executionConsoleUrl(
                      event,
                    )}|${region} » Core CD Pipeline>*`,
                  },
                },
                {
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: [
                      `${event.detail.stage} stage has succeeded.`,
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
  }
};

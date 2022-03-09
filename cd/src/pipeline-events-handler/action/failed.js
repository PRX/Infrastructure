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
              color: '#a30200',
              fallback: `${region} core CD pipeline has failed.`,
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
                      `${event.detail.stage} \`${event.detail.action}\` has failed.`,
                      `*Execution ID:* \`${event.detail['execution-id']}\``,
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
  }
};
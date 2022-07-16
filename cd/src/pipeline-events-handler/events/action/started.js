const AWS = require('aws-sdk');
const regions = require('../../etc/regions');
const urls = require('../../etc/urls');

const sns = new AWS.SNS({
  apiVersion: '2010-03-31',
  region: process.env.SLACK_MESSAGE_RELAY_TOPIC_ARN.split(':')[3],
});

/**
 * Runs when the production deploy approval action starts, meaning it's
 * waiting for approval. It should send a Slack message with buttons to
 * approve or reject the deploy
 * @param {*} event
 */
async function productionDeployApproval(event) {
  const region = regions(event.region);

  await sns.publish({
    TopicArn: process.env.SLACK_MESSAGE_RELAY_TOPIC_ARN,
    Message: JSON.stringify({
      channel: `#ops-deploys-${event.region}`,
      username: 'AWS CodePipeline',
      icon_emoji: ':ops-codepipeline:',
      attachments: [
        {
          color: '#2eb886',
          fallback: `${region} core CD production deploy needs approval.`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*<${urls.executionConsoleUrl(
                  event.region,
                  event.detail.pipeline,
                  event.detail['execution-id'],
                )}|${region} » Core CD Pipeline>*`,
              },
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: [
                  `Prod deploy needs approval`,
                  `TKTKTKTK parameter delta`,
                  `*Execution ID:* \`${event.detail['execution-id']}\``,
                ].join('\n'),
              },
            },
          ],
        },
      ],
    }),
  });
}

module.exports = async (event) => {
  if (
    event.detail.stage === 'Production' &&
    event.detail.action === 'ApproveChangeSet'
  ) {
    await productionDeployApproval(event);
  }
};

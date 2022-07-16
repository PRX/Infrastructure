const AWS = require('aws-sdk');
const regions = require('../../etc/regions');
const urls = require('../../etc/urls');

const sns = new AWS.SNS({
  apiVersion: '2010-03-31',
  region: process.env.SLACK_MESSAGE_RELAY_TOPIC_ARN.split(':')[3],
});

/**
 * Runs when the staging CreateStagingChangeSet action has succeeded, which
 * happens immeidately before a staging deploy starts. This is effectively a
 * notification that a staging deploy is starting
 * @param {*} event
 */
async function stagingChangesSetDelta(event) {
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
          fallback: `${region} core CD staging deploy is starting.`,
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
                  `Staging deploy is starting`,
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
    event.detail.stage === 'Staging' &&
    event.detail.action === 'CreateStagingChangeSet'
  ) {
    await stagingChangesSetDelta(event);
  }
};

/**
 * Invoked by: EventBridge rule
 *
 * Sends messages to Slack with build status info based on the details of a
 * CodeBuild state change event that triggered the Lambda function. Some
 * information may also be requested from the GitHub API to supplement the
 * details that are included in the CodeBuild event.
 */

const AWS = require('aws-sdk');

const sns = new AWS.SNS({ apiVersion: '2010-03-31' });
const color = require('./color');
const builder = require('./builder');

async function buildAttachments(event) {
  const blocks = await builder.blocks(event);

  return [
    {
      color: color.value(event),
      blocks,
    },
  ];
}

exports.handler = async (event) => {
  console.log(JSON.stringify(event));

  const attachments = await buildAttachments(event);

  await sns
    .publish({
      TopicArn: process.env.SLACK_MESSAGE_RELAY_TOPIC_ARN,
      Message: JSON.stringify({
        channel: '#ops-builds',
        username: 'AWS CodeBuild',
        icon_emoji: ':ops-codebuild:',
        attachments,
      }),
    })
    .promise();
};

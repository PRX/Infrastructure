/**
 * Invoked by: EventBridge rule
 *
 * Sends messages to Slack with build status info based on the details of a
 * CodeBuild state change event that triggered the Lambda function. Some
 * information may also be requested from the GitHub API to supplement the
 * details that are included in the CodeBuild event.
 */

import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { statusBlocks } from './builder.mjs';
import { statusColor } from './color.mjs';

const sns = new SNSClient({
  apiVersion: '2010-03-31',
  region: process.env.SLACK_MESSAGE_RELAY_TOPIC_ARN.split(':')[3],
});

async function buildAttachments(event) {
  const blocks = await statusBlocks(event);

  return [
    {
      color: statusColor(event),
      // TODO fallback: '',
      blocks,
    },
  ];
}

export const handler = async (event) => {
  console.log(JSON.stringify(event));

  const attachments = await buildAttachments(event);

  await sns.send(
    new PublishCommand({
      TopicArn: process.env.SLACK_MESSAGE_RELAY_TOPIC_ARN,
      Message: JSON.stringify({
        channel: 'G5C36JDUY', // #ops-build
        username: 'AWS CodeBuild',
        icon_emoji: ':ops-codebuild:',
        attachments,
      }),
    }),
  );
};

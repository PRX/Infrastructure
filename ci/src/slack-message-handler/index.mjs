/**
 * Invoked by: EventBridge rule
 *
 * Sends messages to Slack with build status info based on the details of a
 * CodeBuild state change event that triggered the Lambda function. Some
 * information may also be requested from the GitHub API to supplement the
 * details that are included in the CodeBuild event.
 */

import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import { statusBlocks } from './builder.mjs';
import { statusColor } from './color.mjs';

const eventbridge = new EventBridgeClient({ apiVersion: '2015-10-07' });

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

  await eventbridge.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: 'org.prx.ci',
          DetailType: 'Slack Message Relay Message Payload',
          Detail: JSON.stringify({
            channel: 'G5C36JDUY', // #ops-build
            username: 'AWS CodeBuild',
            icon_emoji: ':ops-codebuild:',
            attachments,
          }),
        },
      ],
    }),
  );
};

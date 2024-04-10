import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';

const eventbridge = new EventBridgeClient({ apiVersion: '2015-10-07' });

export const handler = async (event) => {
  console.log(JSON.stringify(event));

  await eventbridge.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: 'org.prx.health-events',
          DetailType: 'Slack Message Relay Message Payload',
          Detail: JSON.stringify({
            channel: 'G2QH13X62', // #ops-fatal
            username: 'AWS CloudTrail',
            icon_emoji: ':ops-cloudtrail:',
            text: `Root account event detected - ${event.account} ${event['detail-type']} ${event.region} ${event.detail.eventName}`,
          }),
        },
      ],
    }),
  );
};

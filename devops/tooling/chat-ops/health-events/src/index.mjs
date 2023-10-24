import { SNS, PublishCommand } from '@aws-sdk/client-sns';

const sns = new SNS({
  region: process.env.SLACK_MESSAGE_RELAY_SNS_TOPIC_ARN.split(':')[3],
});

const GREEN = '#2eb886';
const RED = '#a30200';

function timeSince(date) {
  let seconds = Math.floor((+new Date() - date) / 1000);

  let interval = seconds / 86400;
  if (interval > 1) {
    return Math.floor(interval) + ' days';
  }
  interval = seconds / 3600;
  if (interval > 1) {
    return Math.floor(interval) + ' hours';
  }
  interval = seconds / 60;
  if (interval > 1) {
    return Math.floor(interval) + ' minutes';
  }
  return Math.floor(seconds) + ' seconds';
}

export const handler = async (event) => {
  console.log(
    JSON.stringify({
      msg: 'Input event',
      event,
    }),
  );

  const region = event.detail.eventRegion;
  const service = event.detail.service;
  const code = event.detail.eventTypeCode;
  const category = event.detail.eventTypeCategory;
  const scope = event.detail.eventScopeCode;
  const startTs = Date.parse(event.detail.startTime);
  const status = event.detail.statusCode;
  const description = event.detail.eventDescription[0].latestDescription;

  if (scope === 'PUBLIC' && category === 'issue') {
    const color = status === 'closed' ? GREEN : RED;

    await sns.send(
      new PublishCommand({
        TopicArn: process.env.SLACK_MESSAGE_RELAY_SNS_TOPIC_ARN,
        Message: JSON.stringify({
          username: 'AWS Health Events',
          icon_emoji: ':ops-aws-health:',
          channel: 'G2QHC2N7K', // #ops-warn
          attachments: [
            {
              color,
              fallback: event.detail.eventTypeCode,
              blocks: [
                {
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: [
                      `*Service:* ${service}`,
                      `*Region:* ${region}`,
                      `*Event Code:* ${code}`,
                      '\n',
                      `*Started:* ${timeSince(new Date(startTs))} ago`,
                      '\n',
                      description,
                    ].join('\n'),
                  },
                },
              ],
            },
          ],
        }),
      }),
    );
  }
};

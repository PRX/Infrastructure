import { SNS, PublishCommand } from '@aws-sdk/client-sns';

const sns = new SNS({ region: process.env.AWS_REGION });

export const handler = async (event) => {
  sns.send(
    new PublishCommand({
      TopicArn: process.env.SLACK_MESSAGE_RELAY_SNS_TOPIC_ARN,
      Message: JSON.stringify({
        username: 'AWS Health Events',
        icon_emoji: ':ops-aws-health:',
        channel: 'G2QHC2N7K', // #ops-warn
        attachments: [
          {
            color: '#a30200',
            fallback: event.eventArn.eventTypeCode,
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: event.eventArn.eventDescription[0].latestDescription,
                },
              },
            ],
          },
        ],
      }),
    }),
  );
};

const { WebClient } = require('@slack/web-api');

async function publishOpsView(userId, hash) {
  const web = new WebClient(process.env.SLACK_ACCESS_TOKEN);
  await web.views.publish({
    user_id: userId,
    view: {
      type: 'home',
      blocks: [
        // CloudFormation
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: 'AWS CloudFormation',
            emoji: true,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'If you need to remove a file from CloudFront edge caches before it expires, you can manually <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Invalidation.html|invalidate> the file from edge caches.',
          },
          accessory: {
            type: 'button',
            style: 'primary',
            text: {
              type: 'plain_text',
              text: 'Create invalidation',
              emoji: true,
            },
            action_id: 'cloudformation-invalidation_open-model',
          },
        },

        // CodePipeline
        { type: 'divider' },
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: 'AWS CodePipeline',
            emoji: true,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'When a pipeline execution starts, it runs a revision through every stage and action in the pipeline. You can manually rerun the most recent revision through the pipeline.',
          },
          accessory: {
            type: 'button',
            style: 'primary',
            text: {
              type: 'plain_text',
              text: 'Start pipeline execution',
              emoji: true,
            },
            action_id: 'codepipeline-execution_open-model',
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'Transitions are links between pipeline stages that can be disabled or enabled. They are enabled by default. When you re-enable a disabled transition, the latest revision runs through the remaining stages of the pipeline unless more than 30 days have passed. Pipeline execution won’t resume for a transition that has been disabled more than 30 days unless a new change is detected or you manually rerun the pipeline. ',
          },
          accessory: {
            type: 'button',
            style: 'primary',
            text: {
              type: 'plain_text',
              text: 'Toggle pipeline transitions',
              emoji: true,
            },
            action_id: 'codepipeline-transitions_open-model',
          },
        },
      ],
    },
    hash,
  });
}

// async function publishReaderView(userId, hash) {};

async function publishDefaultView(userId, hash) {
  const web = new WebClient(process.env.SLACK_ACCESS_TOKEN);
  await web.views.publish({
    user_id: userId,
    view: {
      type: 'home',
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: `PRX DevOps Dashboard` },
        },
        {
          type: 'section',
          text: {
            type: 'plain_text',
            text: ":lock: You don't have access to this app.",
          },
        },
      ],
    },
    hash,
  });
}

module.exports = {
  handler: async function handler(payload) {
    const userId = payload.event.user;
    const { tab } = payload.event;

    console.log('App Home opened');

    // No-op on messages
    if (tab === 'messages') {
      console.log('Ignore messages tab');
      return;
    }

    if (tab === 'home') {
      let hash;
      if (payload.event.view && payload.event.view.hash) {
        hash = payload.event.view.hash;
      }

      if (process.env.DEVOPS_SLACK_USER_IDS.split(',').includes(userId)) {
        await publishOpsView(userId, hash);
      } else {
        await publishDefaultView(userId, hash);
      }
    }
  },
};

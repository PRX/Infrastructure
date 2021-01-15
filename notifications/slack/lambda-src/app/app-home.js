const { WebClient } = require('@slack/web-api');

async function publishOpsView(userId, hash) {
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
            text: 'Charts and graphs and stuff',
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              action_id: 'cloudformation-invalidation_open-model',
              text: {
                type: 'plain_text',
                text: 'Pipeline deploy',
                emoji: true,
              },
              style: 'primary',
            },
          ],
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
            text: "You don't have access to this app.",
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

      if (['U0256R4CM'].includes(userId)) {
        await publishOpsView(userId, hash);
      } else {
        await publishDefaultView(userId, hash);
      }
    }
  },
};

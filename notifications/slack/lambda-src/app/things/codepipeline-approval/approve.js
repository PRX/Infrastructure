const { WebClient } = require('@slack/web-api');
const AWS = require('aws-sdk');

const web = new WebClient(process.env.SLACK_ACCESS_TOKEN);
const codepipeline = new AWS.CodePipeline({ apiVersion: '2015-07-09' });

module.exports = {
  handleBlockActionPayload: async function handleBlockActionPayload(payload) {
    const action = payload.actions[0];
    const approvalParams = JSON.parse(action.value);

    // TODO Include user name
    approvalParams.result.summary = 'No details were provided';

    await codepipeline.putApprovalResult(approvalParams).promise();

    const history = await web.conversations.history({
      limit: 1,
      inclusive: true,
      channel: payload.channel.id,
      latest: payload.message.ts,
    });

    const msg = history.messages[0];

    msg.blocks[0].text.text = 'Production deploy approved ✅';
    msg.blocks[1].text.text = msg.blocks[1].text.text.replace(
      'is awaiting manual approval',
      'has been approved',
    );
    msg.blocks.pop();
    msg.blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `✅ <@${payload.user.id}> approved this release.`,
      },
    });

    await web.chat.update({
      channel: payload.channel.id,
      ts: payload.message.ts,
      text: msg.text.replace(
        'is awaiting manual approval',
        'has been approved',
      ),
      blocks: msg.blocks,
    });
  },
};

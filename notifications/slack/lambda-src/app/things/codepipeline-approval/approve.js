const { WebClient } = require('@slack/web-api');
const Access = require('../../access');
const AWS = require('aws-sdk');

const web = new WebClient(process.env.SLACK_ACCESS_TOKEN);

module.exports = {
  /**
   * Handles a release approval without notes, but sending the approval to
   * CodePipeline and update the Slack message
   * @param {*} payload
   */
  handleBlockActionPayload: async function handleBlockActionPayload(payload) {
    const action = payload.actions[0];
    const approvalParams = JSON.parse(action.value);

    const pipelineRegion = approvalParams.result.summary.split(',')[0];
    const pipelineAccountId = approvalParams.result.summary.split(',')[1];

    approvalParams.result.summary = 'No details were provided';

    // Assume a role in the selected account that has permission to
    // putApprovalResult
    const role = await Access.devopsRole(pipelineAccountId);

    const codepipeline = new AWS.CodePipeline({
      apiVersion: '2019-03-26',
      region: pipelineRegion,
      accessKeyId: role.Credentials.AccessKeyId,
      secretAccessKey: role.Credentials.SecretAccessKey,
      sessionToken: role.Credentials.SessionToken,
    });

    await codepipeline.putApprovalResult(approvalParams).promise();

    // Get the message that included the approval notification/button
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

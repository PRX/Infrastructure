const { WebClient } = require('@slack/web-api');
const Access = require('../../access');
const { CodePipeline } = require('@aws-sdk/client-codepipeline');

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

    const codepipeline = new CodePipeline({
      apiVersion: '2019-03-26',
      region: pipelineRegion,
      credentials: {
        accessKeyId: role.Credentials.AccessKeyId,
        secretAccessKey: role.Credentials.SecretAccessKey,
        sessionToken: role.Credentials.SessionToken,
      },
    });

    await codepipeline.putApprovalResult(approvalParams);

    // Get the message that included the approval notification/button
    const history = await web.conversations.history({
      limit: 1,
      inclusive: true,
      channel: payload.channel.id,
      latest: payload.message.ts,
    });

    const msg = history.messages[0];

    // These changes are made to the message constructed in the Spire CD
    // pipeline events handler Lambda, where the production approval message is
    // handled
    msg.attachments[0].color = '#2eb886';
    msg.attachments[0].blocks.splice(2, 1);
    msg.attachments[0].blocks[1].text.text = `✅ <@${payload.user.id}> approved this release.`;

    await web.chat.update({
      channel: payload.channel.id,
      ts: payload.message.ts,
      // @ts-ignore
      attachments: msg.attachments,
    });
  },
};

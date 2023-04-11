const { WebClient } = require('@slack/web-api');
const { CodePipeline } = require('@aws-sdk/client-codepipeline');
const Access = require('../../access');

const web = new WebClient(process.env.SLACK_ACCESS_TOKEN);
const codepipeline = new CodePipeline({ apiVersion: '2015-07-09' });

/**
 * Sends a Slack message with release notes
 * @param {String} userId - The Slack user ID of the person who approved the release
 * @param {String} notes - The release notes
 */
async function publishReleaseNotes(userId, notes) {
  await web.chat.postMessage({
    channel: '#tech-releases',
    username: 'Release Notes',
    icon_emoji: ':rabbit:',
    text: `<@${userId}>: ${notes}`,
  });
}

module.exports = {
  /**
   * Opens a modal to handle approval with release notes
   * @param {*} payload
   */
  handleBlockActionPayload: async function handleBlockActionPayload(payload) {
    const action = payload.actions[0];
    const metadata = JSON.parse(action.value);
    metadata.channelId = payload.channel.id;
    metadata.messageTs = payload.message.ts;

    await web.views.open({
      trigger_id: payload.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'codepipeline-approval_annotate-deploy',
        clear_on_close: true,
        private_metadata: JSON.stringify(metadata),
        title: {
          type: 'plain_text',
          text: 'Annotate Release',
        },
        submit: {
          type: 'plain_text',
          text: 'Release',
        },
        blocks: [
          {
            type: 'input',
            block_id: 'codepipeline-approval_annotate-deploy-summary',
            label: {
              type: 'plain_text',
              text: 'Release notes',
            },
            // hint: {
            //   type: 'plain_text',
            //   text:
            //     'Put each path on its own line. All paths must start with a slash. Paths may include wildcards (*), which must be the last character if included.',
            // },
            element: {
              type: 'plain_text_input',
              action_id: 'codepipeline-approval_annotate-deploy-summary',
              placeholder: {
                type: 'plain_text',
                text: '*Bug fixes* and _stability_ improvements',
              },
              multiline: true,
            },
          },
        ],
      },
    });
  },
  /**
   * Handles release notes modal submission, sending the approval result to
   * CodePipeline, updating the approval notification message in Slack, and
   * publishing the release notes
   * @param {*} payload
   */
  handleViewSubmissionPayload: async function handleViewSubmissionPayload(
    payload,
  ) {
    // Get the value from the modal's input block
    const { values } = payload.view.state;
    const block = values['codepipeline-approval_annotate-deploy-summary'];
    const action = block['codepipeline-approval_annotate-deploy-summary'];
    const { value } = action;

    const approvalParams = JSON.parse(payload.view.private_metadata);

    const pipelineRegion = approvalParams.result.summary.split(',')[0];
    const pipelineAccountId = approvalParams.result.summary.split(',')[1];

    approvalParams.result.summary = value;

    const channelId = approvalParams.channelId;
    const messageTs = approvalParams.messageTs;
    delete approvalParams.channelId;
    delete approvalParams.messageTs;

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
      channel: channelId,
      latest: messageTs,
    });

    // Update approval notification message in Slack
    const msg = history.messages[0];

    // These changes are made to the message constructed in the Spire CD
    // pipeline events handler Lambda, where the production approval message is
    // handled
    msg.attachments[0].color = '#2eb886';
    msg.attachments[0].blocks.splice(2, 1);
    msg.attachments[0].blocks[1].text.text = `✅ <@${payload.user.id}> approved this release with these notes:\n> ${value}`;

    await web.chat.update({
      channel: channelId,
      ts: messageTs,
      // @ts-ignore
      attachments: msg.attachments,
    });

    await publishReleaseNotes(payload.user.id, value);
  },
};

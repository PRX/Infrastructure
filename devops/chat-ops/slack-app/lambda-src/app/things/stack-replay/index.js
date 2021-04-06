const { WebClient } = require('@slack/web-api');
const AWS = require('aws-sdk');
const Access = require('../../access');

const web = new WebClient(process.env.SLACK_ACCESS_TOKEN);

async function s3lient(accountId) {
  // Assume a role in the selected account that has permission to
  // listObjectVersions
  const role = await Access.devopsRole(accountId);

  const s3 = new AWS.S3({
    apiVersion: '2006-03-01',
    accessKeyId: role.Credentials.AccessKeyId,
    secretAccessKey: role.Credentials.SecretAccessKey,
    sessionToken: role.Credentials.SessionToken,
  });

  return s3;
}

async function openModal(payload) {
  const s3 = await s3lient(process.env.PRX_LEGACY_ACCOUNT_ID);
  const versions = await s3
    .listObjectVersions({
      Bucket: process.env.INFRASTRUCTURE_CONFIG_BUCKET,
      Prefix: process.env.INFRASTRUCTURE_CONFIG_STAGING_KEY,
    })
    .promise();

  const now = Date.now();
  const range = 60 * 60 * 24 * 14 * 1000;
  const threshold = now - range;

  const currentVersion = versions.Versions[0];
  const currentVersionId = currentVersion.VersionId;
  const currentVersionInfo = `${currentVersionId}`;

  await web.views.open({
    trigger_id: payload.trigger_id,
    view: {
      type: 'modal',
      clear_on_close: true,
      private_metadata: JSON.stringify({
        currentVersionId,
        currentVersionInfo,
      }),
      title: {
        type: 'plain_text',
        text: 'Stack Replay',
      },
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'Replay a previous version of the staging stack parameters',
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Current version:* ${currentVersionInfo}`,
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'static_select',
              placeholder: {
                type: 'plain_text',
                text: 'Select template config version',
              },
              action_id: 'stack-replay_select-version',
              options: versions.Versions.filter((v) => {
                return +v.LastModified > threshold;
              }).map((v) => {
                const d = new Date(v.LastModified);
                const yy = d.getUTCFullYear();
                const mm = `0${d.getUTCMonth() + 1}`.substr(-2);
                const dd = `0${d.getUTCDate()}`.substr(-2);
                const hh = `0${d.getUTCHours()}`.substr(-2);
                const nn = `0${d.getUTCMinutes()}`.substr(-2);

                const id = `${v.VersionId.substring(0, 9)}…`;
                const time = `${yy}-${mm}-${dd} ${hh}:${nn}`;

                return {
                  text: {
                    type: 'plain_text',
                    text: `${id} ${time}`,
                  },
                  value: v.VersionId,
                };
              }),
            },
          ],
        },
      ],
    },
  });
}

async function versionSelected(payload) {
  const selectedOption = payload.actions[0].selected_option;

  const versionId = selectedOption.value;
  const versionInfo = selectedOption.text.text;

  const privateMetadata = JSON.parse(payload.view.private_metadata);
  privateMetadata.versionId = versionId;
  privateMetadata.versionInfo = versionInfo;

  const { currentVersionId, currentVersionInfo } = privateMetadata;

  await web.views.update({
    view_id: payload.view.id,
    hash: payload.view.hash,
    view: {
      type: 'modal',
      callback_id: 'stack-replay_replay-version',
      clear_on_close: true,
      private_metadata: JSON.stringify(privateMetadata),
      title: {
        type: 'plain_text',
        text: 'Stack Replay',
      },
      submit: {
        type: 'plain_text',
        text: 'Replay version',
      },
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'Replay a previous version of the staging stack parameters',
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Current version:* ${currentVersionInfo}`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Version:* ${versionInfo}`,
          },
        },
      ],
    },
  });
}

async function replayVersion(payload) {
  const privateMetadata = JSON.parse(payload.view.private_metadata);
  const { versionId } = privateMetadata;

  const configBucket = process.env.INFRASTRUCTURE_CONFIG_BUCKET;
  const configKey = process.env.INFRASTRUCTURE_CONFIG_STAGING_KEY;
  const sourceUrl = `${configBucket}/${configKey}?versionId=${versionId}`;

  const s3 = await s3lient(process.env.PRX_LEGACY_ACCOUNT_ID);
  await s3
    .copyObject({
      Bucket: configBucket,
      CopySource: encodeURI(sourceUrl).replace(/\+/g, '%2B'),
      Key: configKey,
    })
    .promise();

  await web.chat.postMessage({
    icon_emoji: ':ops-codepipeline:',
    username: 'AWS CopePipeline via DevOps',
    channel: '#sandbox2',
    text: `Replaying staging template config version ${versionId}`,
  });
}

module.exports = {
  handleBlockActionPayload: async function handleBlockActionPayload(payload) {
    const actionId = payload.actions[0].action_id;

    switch (actionId) {
      case 'stack-replay_open-model':
        await openModal(payload);
        break;
      case 'stack-replay_select-version':
        await versionSelected(payload);
        break;
      default:
        break;
    }
  },
  handleViewSubmissionPayload: async function handleViewSubmissionPayload(
    payload,
  ) {
    const callbackId = payload.view.callback_id;

    switch (callbackId) {
      case 'stack-replay_replay-version':
        await replayVersion(payload);
        break;
      default:
        break;
    }
  },
};

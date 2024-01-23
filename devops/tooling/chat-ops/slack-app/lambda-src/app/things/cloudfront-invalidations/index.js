const { WebClient } = require('@slack/web-api');
const { CloudFront } = require('@aws-sdk/client-cloudfront');
const Access = require('../../access');

const web = new WebClient(process.env.SLACK_ACCESS_TOKEN);

async function openModal(payload) {
  const accounts = await Access.orgAccounts();

  await web.views.open({
    trigger_id: payload.trigger_id,
    view: {
      type: 'modal',
      clear_on_close: true,
      title: {
        type: 'plain_text',
        text: 'CloudFront Invalidation',
      },
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'Invalidate files from CloudFront edge caches for a given distribution',
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'static_select',
              placeholder: {
                type: 'plain_text',
                text: 'Select AWS account',
              },
              action_id: 'cloudformation-invalidation_select-account',
              options: accounts.Accounts.sort((a, b) =>
                a.Name.localeCompare(b.Name),
              ).map((a) => ({
                text: {
                  type: 'plain_text',
                  text: a.Name,
                },
                value: `${a.Id}`,
              })),
            },
          ],
        },
      ],
    },
  });
}

async function selectAccount(payload) {
  const selectedOption = payload.actions[0].selected_option;

  const accountId = selectedOption.value;
  const accountName = selectedOption.text.text;

  // Assume a role in the selected account that has permission to
  // listDistributions
  const role = await Access.devopsRole(accountId);

  const cloudfront = new CloudFront({
    apiVersion: '2019-03-26',
    region: 'us-east-1',
    credentials: {
      accessKeyId: role.Credentials.AccessKeyId,
      secretAccessKey: role.Credentials.SecretAccessKey,
      sessionToken: role.Credentials.SessionToken,
    },
  });

  const distributions = await cloudfront.listDistributions({});

  await web.views.update({
    view_id: payload.view.id,
    hash: payload.view.hash,
    view: {
      type: 'modal',
      clear_on_close: true,
      private_metadata: JSON.stringify({ accountId, accountName }),
      title: {
        type: 'plain_text',
        text: 'CloudFront Invalidation',
      },
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'Invalidate files from CloudFront edge caches for a given distribution',
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Account:* ${accountName}`,
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'static_select',
              placeholder: {
                type: 'plain_text',
                text: 'Select CloudFront distribution',
              },
              action_id: 'cloudformation-invalidation_select-distribution',
              options: distributions.DistributionList.Items.map((d) => ({
                text: {
                  type: 'plain_text',
                  text: `${d.Id} (${
                    d.Aliases?.Items?.join(', ') || d.Comment
                  })`.substring(0, 75),
                },
                value: d.Id,
              })),
            },
          ],
        },
      ],
    },
  });
}

async function selectDistribution(payload) {
  const selectedOption = payload.actions[0].selected_option;

  const distributionId = selectedOption.value;
  const distributionSlug = selectedOption.text.text;

  const privateMetadata = JSON.parse(payload.view.private_metadata);
  privateMetadata.distributionId = distributionId;
  privateMetadata.distributionSlug = distributionSlug;

  const { accountName } = privateMetadata;

  await web.views.update({
    view_id: payload.view.id,
    hash: payload.view.hash,
    view: {
      type: 'modal',
      callback_id: 'cloudformation-invalidation_paths-to-invalidate',
      clear_on_close: true,
      private_metadata: JSON.stringify(privateMetadata),
      title: {
        type: 'plain_text',
        text: 'CloudFront Invalidation',
      },
      submit: {
        type: 'plain_text',
        text: 'Invalidate',
      },
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'Invalidate files from CloudFront edge caches for a given distribution',
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Account:* ${accountName}`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Distribution:* ${distributionSlug}`,
          },
        },
        {
          type: 'input',
          block_id: 'cloudformation-invalidation_paths-to-invalidate',
          label: {
            type: 'plain_text',
            text: 'Paths',
          },
          hint: {
            type: 'plain_text',
            text: 'Put each path on its own line. All paths must start with a slash. Paths may include wildcards (*), which must be the last character if included.',
          },
          element: {
            type: 'plain_text_input',
            action_id: 'cloudformation-invalidation_paths-to-invalidate',
            placeholder: {
              type: 'plain_text',
              text: '/images/image1.jpg\n/images/image2.*\n/audio/*',
            },
            multiline: true,
          },
        },
      ],
    },
  });
}

/**
 *
 * @param {string} accountId
 * @param {string} distributionId
 * @param {string[]} paths
 */
async function createInvalidation(accountId, distributionId, paths) {
  // Assume a role in the selected account that has permission to
  // createInvalidation
  const role = await Access.devopsRole(accountId);

  const cloudfront = new CloudFront({
    apiVersion: '2019-03-26',
    region: 'us-east-1',
    credentials: {
      accessKeyId: role.Credentials.AccessKeyId,
      secretAccessKey: role.Credentials.SecretAccessKey,
      sessionToken: role.Credentials.SessionToken,
    },
  });

  await cloudfront.createInvalidation({
    DistributionId: distributionId,
    InvalidationBatch: {
      CallerReference: `${+new Date()}`,
      Paths: {
        Quantity: paths.length,
        Items: paths,
      },
    },
  });
}

async function submitPaths(payload) {
  const { values } = payload.view.state;
  const block = values['cloudformation-invalidation_paths-to-invalidate'];
  const action = block['cloudformation-invalidation_paths-to-invalidate'];
  const { value } = action;

  const paths = value.split('\n');

  const privateMetadata = JSON.parse(payload.view.private_metadata);
  const { accountId, distributionId, distributionSlug } = privateMetadata;

  await createInvalidation(accountId, distributionId, paths);

  await web.chat.postMessage({
    icon_emoji: ':ops-cloudfront:',
    username: 'Amazon CloudFront via DevOps',
    channel: '#tech-devops',
    text: [
      `Invalidation created for \`${distributionId}\` with paths:`,
      paths.map((p) => `\`${p}\``).join('\n'),
      `_${distributionSlug}_`,
    ].join('\n'),
  });
}

module.exports = {
  handleBlockActionPayload: async function handleBlockActionPayload(payload) {
    const actionId = payload.actions[0].action_id;

    switch (actionId) {
      case 'cloudformation-invalidation_open-model':
        await openModal(payload);
        break;
      case 'cloudformation-invalidation_select-account':
        await selectAccount(payload);
        break;
      case 'cloudformation-invalidation_select-distribution':
        await selectDistribution(payload);
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
      case 'cloudformation-invalidation_paths-to-invalidate':
        await submitPaths(payload);
        break;
      default:
        break;
    }
  },
};

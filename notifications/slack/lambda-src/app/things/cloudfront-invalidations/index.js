const { WebClient } = require('@slack/web-api');
const AWS = require('aws-sdk');

const web = new WebClient(process.env.SLACK_ACCESS_TOKEN);
const sts = new AWS.STS({ apiVersion: '2011-06-15' });

async function openModal(payload) {
  // Assume a role within the Organization's management account that has
  // permission to `listAccounts`
  // This is NOT the DevOps shared access account, which exists in each account.
  // It's a different role that only exists in the management account.
  const role = await sts
    .assumeRole({
      RoleArn: process.env.AWS_ORGANIZATION_CROSS_ACCOUNT_SHARING_ROLE_ARN,
      RoleSessionName: 'devops_slack_app',
    })
    .promise();

  // The organizations endpoint only exists in us-east-1
  const organizations = new AWS.Organizations({
    apiVersion: '2016-11-28',
    region: 'us-east-1',
    accessKeyId: role.Credentials.AccessKeyId,
    secretAccessKey: role.Credentials.SecretAccessKey,
    sessionToken: role.Credentials.SessionToken,
  });

  const accounts = await organizations.listAccounts({}).promise();

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
            text:
              'Invalidate files from CloudFront edge caches for a given distribution',
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
              ).map((a) => {
                return {
                  text: {
                    type: 'plain_text',
                    text: a.Name,
                  },
                  value: `${a.Id}`,
                };
              }),
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
  const roleArn = `arn:aws:iam::${accountId}:role/${process.env.DEVOPS_CROSS_ACCOUNT_ACCESS_ROLE_NAME}`;
  const role = await sts
    .assumeRole({
      RoleArn: roleArn,
      RoleSessionName: 'devops_slack_app',
    })
    .promise();

  const cloudfront = new AWS.CloudFront({
    apiVersion: '2019-03-26',
    region: 'us-east-1',
    accessKeyId: role.Credentials.AccessKeyId,
    secretAccessKey: role.Credentials.SecretAccessKey,
    sessionToken: role.Credentials.SessionToken,
  });

  const distributions = await cloudfront.listDistributions({}).promise();

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
            text:
              'Invalidate files from CloudFront edge caches for a given distribution',
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
              options: distributions.DistributionList.Items.map((d) => {
                return {
                  text: {
                    type: 'plain_text',
                    text: `${d.Id} (${d.Aliases.Items.join(', ')})`.substring(
                      0,
                      75,
                    ),
                  },
                  value: d.Id,
                };
              }),
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
            text:
              'Invalidate files from CloudFront edge caches for a given distribution',
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
            text: `*Distributiion:* ${distributionSlug}`,
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
            text:
              'Put each path on its own line. All paths must start with a slash. Paths may include wildcards (*), which must be the last character if included.',
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
  const roleArn = `arn:aws:iam::${accountId}:role/${process.env.DEVOPS_CROSS_ACCOUNT_ACCESS_ROLE_NAME}`;
  const role = await sts
    .assumeRole({
      RoleArn: roleArn,
      RoleSessionName: 'devops_slack_app',
    })
    .promise();

  const cloudfront = new AWS.CloudFront({
    apiVersion: '2019-03-26',
    region: 'us-east-1',
    accessKeyId: role.Credentials.AccessKeyId,
    secretAccessKey: role.Credentials.SecretAccessKey,
    sessionToken: role.Credentials.SessionToken,
  });

  await cloudfront
    .createInvalidation({
      DistributionId: distributionId,
      InvalidationBatch: {
        CallerReference: `${+new Date()}`,
        Paths: {
          Quantity: paths.length,
          Items: paths,
        },
      },
    })
    .promise();
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
    channel: '#sandbox2',
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

const { WebClient } = require('@slack/web-api');
const AWS = require('aws-sdk');

const web = new WebClient(process.env.SLACK_ACCESS_TOKEN);
const cloudfront = new AWS.CloudFront({ apiVersion: '2019-03-26' });
const sts = new AWS.STS({ apiVersion: '2011-06-15' });

async function openModal(payload) {
  // Assume a role within the Organization's management account that has
  // permission to `listAccounts`
  // This is NOT the DevOps shared access account, which exists in each account.
  // It's a different role that only exists in the management account.
  const role = await sts.assumeRole({
    RoleArn: process.env.AWS_ORGANIZATION_CROSS_ACCOUNT_SHARING_ROLE_ARN,
    RoleSessionName: 'devops_slack_app',
  }).promise();

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
            text: 'Invalidate files from CloudFront edge caches for a given distribution',
          },
        }, {
          type: 'actions',
          elements: [
            {
              type: 'static_select',
              placeholder: {
                type: 'plain_text',
                text: 'Select AWS account'
              },
              action_id: 'cloudformation-invalidation_select-account',
              options: accounts.Accounts.sort((a, b) => a.Name.localeCompare(b.Name)).map(a => {
                return {
                  "text": {
                      "type": "plain_text",
                      "text": a.Name,
                  },
                  "value": `${a.Id}`
                };
              }),
            }
          ]
        }
      ],
    }
  });
}

async function selectAccount(payload) {
  const { selected_option } = payload.actions[0];

  const accountId = selected_option.value;
  const accountName = selected_option.text.text;

  // Assume a role in the selected account that has permission to
  // listDistributions
  const roleArn = `arn:aws:iam::${accountId}:role/${process.env.DEVOPS_CROSS_ACCOUNT_ACCESS_ROLE_NAME}`
  const role = await sts.assumeRole({
    RoleArn: roleArn,
    RoleSessionName: 'devops_slack_app',
  }).promise();

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
            text: 'Invalidate files from CloudFront edge caches for a given distribution',
          },
        }, {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Account:* ${accountName}`,
          },
        }, {
          type: 'actions',
          elements: [
            {
              type: 'static_select',
              placeholder: {
                type: 'plain_text',
                text: 'Select CloudFront distribution'
              },
              action_id: 'cloudformation-invalidation_select-distribution',
              options: distributions.DistributionList.Items.map(d => {
                return {
                  'text': {
                      'type': 'plain_text',
                      'text': `${d.Id} (${d.Aliases.Items.join(', ')})`,
                  },
                  'value': d.Id,
                }
              }),
            }
          ]
        }
      ],
    },
  });
}

async function selectDistribution(payload) {
  await web.views.update({
    view_id: payload.view.id,
    hash: payload.view.hash,
    view: {
      type: 'modal',
      callback_id: 'cloudformation-invalidation_paths-to-invalidate',
      clear_on_close: true,
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
        }, {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'THE SELECTED ACCOUNT',
          },
        }, {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'THE SELECTED DISTRIBUTION',
          },
        }, {
          type: 'input',
          block_id: 'cloudformation-invalidation_paths-to-invalidate',
          label: {
            type: 'plain_text',
            text: 'Paths'
          },
          element: {
            type: 'plain_text_input',
            action_id: 'cloudformation-invalidation_paths-to-invalidate',
            placeholder: {
              type: 'plain_text',
              text: '/images/image1.jpg'
            },
            multiline: true,

          }
        }
      ],
    },
  });
}

async function submitPaths(payload) {
  console.log(JSON.stringify(payload));
  console.log('PATHS SUBMITTED');

  const { values } = payload.view.state;
  const block = values['cloudformation-invalidation_paths-to-invalidate'];
  const action = block['cloudformation-invalidation_paths-to-invalidate'];
  const value = action.value;



  await createInvalidation(distributionId, paths);
}

/**
 *
 * @param {string} distributionId
 * @param {string[]} paths
 */
async function createInvalidation(distributionId, paths) {
  await cloudfront.createInvalidation({
    DistributionId: distributionId,
    InvalidationBatch: {
        CallerReference: `${+(new Date())}`,
        Paths: {
            Quantity: paths.length,
            Items: paths,
        },
    }
  }).promise();

  // TODO send a message about the invalidation
}

module.exports = {
  handleBlockActionPayload: async function handleBlockActionPayload(payload) {
    const { action_id } = payload.actions[0];

    switch (action_id) {
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
  handleViewSubmissionPayload: async function handleViewSubmissionPayload(payload) {
    const { callback_id } = payload.view;

    switch (callback_id) {
      case 'cloudformation-invalidation_paths-to-invalidate':
        await submitPaths(payload);
        break;
      default:
        break;
    }
  }
};

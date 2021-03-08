const { WebClient } = require('@slack/web-api');
const AWS = require('aws-sdk');
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
        text: 'CodePipeline Executions',
      },
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'Start a pipeline execution in CodePipelines',
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
              action_id: 'codepipeline-execution_select-account',
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

  const codepipeline = new AWS.CodePipeline({
    apiVersion: '2019-03-26',
    region: 'us-east-1',
    accessKeyId: role.Credentials.AccessKeyId,
    secretAccessKey: role.Credentials.SecretAccessKey,
    sessionToken: role.Credentials.SessionToken,
  });

  const pipelines = await codepipeline.listPipelines({}).promise();

  await web.views.update({
    view_id: payload.view.id,
    hash: payload.view.hash,
    view: {
      type: 'modal',
      clear_on_close: true,
      private_metadata: JSON.stringify({ accountId, accountName }),
      title: {
        type: 'plain_text',
        text: 'CodePipeline Executions',
      },
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'Start a pipeline execution in CodePipelines',
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
                text: 'Select CodePipeline pipeline',
              },
              action_id: 'codepipeline-execution_select-pipeline',
              options: pipelines.pipelines.map((p) => ({
                text: {
                  type: 'plain_text',
                  text: `${p.name}`.substring(0, 75),
                },
                value: p.name,
              })),
            },
          ],
        },
      ],
    },
  });
}

async function selectPipeline(payload) {
  const selectedOption = payload.actions[0].selected_option;

  const pipelineName = selectedOption.value;

  const privateMetadata = JSON.parse(payload.view.private_metadata);
  privateMetadata.pipelineName = pipelineName;

  const { accountName } = privateMetadata;

  await web.views.update({
    view_id: payload.view.id,
    hash: payload.view.hash,
    view: {
      type: 'modal',
      callback_id: 'codepipeline-execution_pipeline-to-start',
      clear_on_close: true,
      private_metadata: JSON.stringify(privateMetadata),
      title: {
        type: 'plain_text',
        text: 'CodePipeline Executions',
      },
      submit: {
        type: 'plain_text',
        text: 'Start Execution',
      },
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'Start a pipeline execution in CodePipelines',
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
            text: `*Pipeline:* ${pipelineName}`,
          },
        },
      ],
    },
  });
}

/**
 *
 * @param {string} accountId
 * @param {string} pipelineName
 */
async function startPipelineExecution(accountId, pipelineName) {
  // Assume a role in the selected account that has permission to
  // createInvalidation
  const role = await Access.devopsRole(accountId);

  const codepipeline = new AWS.CodePipeline({
    apiVersion: '2019-03-26',
    region: 'us-east-1',
    accessKeyId: role.Credentials.AccessKeyId,
    secretAccessKey: role.Credentials.SecretAccessKey,
    sessionToken: role.Credentials.SessionToken,
  });

  await codepipeline
    .startPipelineExecution({
      name: pipelineName,
    })
    .promise();
}

async function startPipeline(payload) {
  // const { values } = payload.view.state;
  // const block = values['cloudformation-invalidation_paths-to-invalidate'];
  // const action = block['cloudformation-invalidation_paths-to-invalidate'];
  // const { value } = action;

  const privateMetadata = JSON.parse(payload.view.private_metadata);
  const { accountId, pipelineName } = privateMetadata;

  await startPipelineExecution(accountId, pipelineName);

  await web.chat.postMessage({
    icon_emoji: ':ops-codepipeline:',
    username: 'AWS CopePipelines via DevOps',
    channel: '#sandbox2',
    text: [`Pipeline execution started for: \`${pipelineName}\``].join('\n'),
  });
}

module.exports = {
  handleBlockActionPayload: async function handleBlockActionPayload(payload) {
    const actionId = payload.actions[0].action_id;

    switch (actionId) {
      case 'codepipeline-execution_open-model':
        await openModal(payload);
        break;
      case 'codepipeline-execution_select-account':
        await selectAccount(payload);
        break;
      case 'codepipeline-execution_select-pipeline':
        await selectPipeline(payload);
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
      case 'codepipeline-execution_pipeline-to-start':
        await startPipeline(payload);
        break;
      default:
        break;
    }
  },
};

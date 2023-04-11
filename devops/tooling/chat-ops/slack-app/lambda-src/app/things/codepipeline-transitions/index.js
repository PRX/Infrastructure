const { WebClient } = require('@slack/web-api');
const { CodePipeline } = require('@aws-sdk/client-codepipeline');
const Access = require('../../access');

const web = new WebClient(process.env.SLACK_ACCESS_TOKEN);

async function codePipelineClient(accountId, region) {
  // Assume a role in the selected account that has permission to
  // listDistributions
  const role = await Access.devopsRole(accountId);

  const codepipeline = new CodePipeline({
    apiVersion: '2019-03-26',
    region: region,
    credentials: {
      accessKeyId: role.Credentials.AccessKeyId,
      secretAccessKey: role.Credentials.SecretAccessKey,
      sessionToken: role.Credentials.SessionToken,
    },
  });

  return codepipeline;
}

async function openModal(payload) {
  const accounts = await Access.orgAccounts();

  await web.views.open({
    trigger_id: payload.trigger_id,
    view: {
      type: 'modal',
      clear_on_close: true,
      title: {
        type: 'plain_text',
        text: 'CodePipeline Transitions',
      },
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'Enable or disable a transition between pipeline stages',
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
              action_id: 'codepipeline-transitions_select-account',
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

async function accountSelected(payload) {
  const selectedOption = payload.actions[0].selected_option;

  const accountId = selectedOption.value;
  const accountName = selectedOption.text.text;

  await web.views.update({
    view_id: payload.view.id,
    hash: payload.view.hash,
    view: {
      type: 'modal',
      clear_on_close: true,
      private_metadata: JSON.stringify({ accountId, accountName }),
      title: {
        type: 'plain_text',
        text: 'CodePipeline Transitions',
      },
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'Enable or disable a transition between pipeline stages',
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
                text: 'Select AWS region',
              },
              action_id: 'codepipeline-transitions_select-region',
              options: Access.regions().map((region) => ({
                text: {
                  type: 'plain_text',
                  text: `${region}`.substring(0, 75),
                },
                value: region,
              })),
            },
          ],
        },
      ],
    },
  });
}

async function regionSelected(payload) {
  const selectedOption = payload.actions[0].selected_option;

  const region = selectedOption.value;

  const privateMetadata = JSON.parse(payload.view.private_metadata);
  privateMetadata.region = region;

  const { accountId, accountName } = privateMetadata;

  const codepipeline = await codePipelineClient(accountId, region);
  const pipelines = await codepipeline.listPipelines({});

  await web.views.update({
    view_id: payload.view.id,
    hash: payload.view.hash,
    view: {
      type: 'modal',
      clear_on_close: true,
      private_metadata: JSON.stringify(privateMetadata),
      title: {
        type: 'plain_text',
        text: 'CodePipeline Transitions',
      },
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'Enable or disable a transition between pipeline stages',
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
            text: `*Region:* ${region}`,
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
              action_id: 'codepipeline-transitions_select-pipeline',
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

async function pipelineSelected(payload) {
  const selectedOption = payload.actions[0].selected_option;

  const pipelineName = selectedOption.value;

  const privateMetadata = JSON.parse(payload.view.private_metadata);
  privateMetadata.pipelineName = pipelineName;

  const { accountId, accountName, region } = privateMetadata;

  const codepipeline = await codePipelineClient(accountId, region);
  const pipelineState = await codepipeline.getPipelineState({
    name: pipelineName,
  });

  await web.views.update({
    view_id: payload.view.id,
    hash: payload.view.hash,
    view: {
      type: 'modal',
      clear_on_close: true,
      private_metadata: JSON.stringify(privateMetadata),
      title: {
        type: 'plain_text',
        text: 'CodePipeline Transitions',
      },
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'Enable or disable a transition between pipeline stages',
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
            text: `*Region:* ${region}`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Pipeline:* ${pipelineName}`,
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'static_select',
              placeholder: {
                type: 'plain_text',
                text: 'Select CodePipeline stage',
              },
              action_id: 'codepipeline-transitions_select-stage',
              options: pipelineState.stageStates.map((state) => ({
                text: {
                  type: 'plain_text',
                  text: `${state.stageName}: ${
                    state.inboundTransitionState.enabled ? 'On' : 'Disabled'
                  }`.substring(0, 75),
                },
                value: state.stageName,
              })),
            },
          ],
        },
      ],
    },
  });
}

async function stageSelected(payload) {
  const selectedOption = payload.actions[0].selected_option;

  const stageName = selectedOption.value;

  const privateMetadata = JSON.parse(payload.view.private_metadata);
  privateMetadata.stageName = stageName;

  const { accountId, accountName, region, pipelineName } = privateMetadata;

  const codepipeline = await codePipelineClient(accountId, region);
  const pipelineState = await codepipeline.getPipelineState({
    name: pipelineName,
  });

  const stageState = pipelineState.stageStates.find(
    (state) => state.stageName === stageName,
  );
  const inboundTransitionState = stageState.inboundTransitionState;

  privateMetadata.inboundTransitionStateEnabled =
    inboundTransitionState.enabled;

  // Only show these when the selected stage is currently ENABLED
  const disableBlocks = [
    {
      type: 'input',
      block_id: 'codepipeline-transitions_set-stage-state-reason',
      label: {
        type: 'plain_text',
        text: 'Reason for disabling',
      },
      element: {
        type: 'plain_text_input',
        action_id: 'codepipeline-transitions_set-stage-state-reason',
        placeholder: {
          type: 'plain_text',
          text: 'e.g., Holding for additional QA',
        },
        multiline: true,
      },
    },
  ];

  // Only show these when the selected stage is currently DISABLED
  const enableBlocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Reason:* ${inboundTransitionState.disabledReason}`,
      },
    },
  ];

  await web.views.update({
    view_id: payload.view.id,
    hash: payload.view.hash,
    view: {
      type: 'modal',
      callback_id: 'codepipeline-transitions_set-stage-state',
      clear_on_close: true,
      private_metadata: JSON.stringify(privateMetadata),
      title: {
        type: 'plain_text',
        text: 'CodePipeline Executions',
      },
      submit: {
        type: 'plain_text',
        text: inboundTransitionState.enabled ? 'Disable' : 'Enable',
      },
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'Enable or disable a transition between pipeline stages',
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
            text: `*Region:* ${region}`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Pipeline:* ${pipelineName}`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Stage:* ${stageName}`,
          },
        },
        ...(inboundTransitionState.enabled ? disableBlocks : enableBlocks),
      ],
    },
  });
}

async function setTransitionState(payload) {
  const privateMetadata = JSON.parse(payload.view.private_metadata);
  const {
    accountId,
    region,
    pipelineName,
    stageName,
    inboundTransitionStateEnabled,
  } = privateMetadata;

  const codepipeline = await codePipelineClient(accountId, region);

  const msg = {
    icon_emoji: ':ops-codepipeline:',
    username: 'AWS CopePipeline via DevOps',
    channel: '#tech-devops',
    text: '',
  };

  if (inboundTransitionStateEnabled) {
    // Stage is currently enabled; Disable it
    const { values } = payload.view.state;
    const block = values['codepipeline-transitions_set-stage-state-reason'];
    const action = block['codepipeline-transitions_set-stage-state-reason'];
    const { value } = action;

    const reason = value;
    await codepipeline.disableStageTransition({
      pipelineName,
      stageName,
      transitionType: 'Inbound',
      reason,
    });

    msg.text = `Pipeline stage transition for \`${pipelineName}\`:\`${stageName}\` has been disabled.\n> ${reason}`;
  } else {
    // Stage is currently enabled; Enable it
    await codepipeline.enableStageTransition({
      pipelineName,
      stageName,
      transitionType: 'Inbound',
    });

    msg.text = `Pipeline stage transition for \`${pipelineName}\`:\`${stageName}\` has been enabled.`;
  }

  await web.chat.postMessage(msg);
}

module.exports = {
  handleBlockActionPayload: async function handleBlockActionPayload(payload) {
    const actionId = payload.actions[0].action_id;

    switch (actionId) {
      case 'codepipeline-transitions_open-model':
        await openModal(payload);
        break;
      case 'codepipeline-transitions_select-account':
        await accountSelected(payload);
        break;
      case 'codepipeline-transitions_select-region':
        await regionSelected(payload);
        break;
      case 'codepipeline-transitions_select-pipeline':
        await pipelineSelected(payload);
        break;
      case 'codepipeline-transitions_select-stage':
        await stageSelected(payload);
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
      case 'codepipeline-transitions_set-stage-state':
        await setTransitionState(payload);
        break;
      default:
        break;
    }
  },
};

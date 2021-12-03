/**
 * @typedef { import('aws-lambda').SNSEvent } SNSEvent
 * @typedef { import('@slack/web-api').ChatPostMessageArguments } ChatPostMessageArguments
 */

/**
 * CodePipeline manual approval metadata
 * @typedef {Object} CodePipelineJobDataActionConfigurationConfiguration
 * @property {String} FunctionName
 * @property {String} UserParameters
 */

/**
 * CodePipeline manual approval metadata
 * @typedef {Object} CodePipelineJobDataActionConfiguration
 * @property {CodePipelineJobDataActionConfigurationConfiguration} configuration
 */

/**
 * CodePipeline manual approval metadata
 * @typedef {Object} CodePipelineJobDataInputArtifact
 * @property {String} name
 * @property {String} revision
 */

/**
 * CodePipeline manual approval metadata
 * @typedef {Object} CodePipelineJobData
 * @property {CodePipelineJobDataActionConfiguration} actionConfiguration
 * @property {CodePipelineJobDataInputArtifact[]} inputArtifacts
 */

/**
 * The payload develired as JSON data via SNS from a CodePipeline manual
 * approval action
 * @typedef {Object} CodePipelineJob
 * @property {String} id
 * @property {String} accountId
 * @property {CodePipelineJobData} data
 */

/**
 * A tuple containing a paremeter key and the old and new value for the
 * parameter
 * @typedef {[AWS.CloudFormation.ParameterKey, AWS.CloudFormation.ParameterValue|undefined, AWS.CloudFormation.ParameterValue|undefined]} ParameterDelta
 */

/**
 * An array of parameter deltas
 * @typedef {ParameterDelta[]} ParameterDeltas
 */

const AWS = require('aws-sdk');

const sns = new AWS.SNS({ apiVersion: '2010-03-31' });
const cloudformation = new AWS.CloudFormation({ apiVersion: '2010-05-15' });
const codepipeline = new AWS.CodePipeline({ apiVersion: '2015-07-09' });

/**
 * Returns all parameters that are the same between the stack and change set
 * @param {AWS.CloudFormation.Parameters} stackParameters
 * @param {AWS.CloudFormation.Parameters} changeSetParameters
 * @returns {AWS.CloudFormation.Parameters}
 */
function unchangedParameters(stackParameters, changeSetParameters) {
  return stackParameters.filter((p) => {
    return changeSetParameters.find(
      (s) =>
        s.ParameterKey === p.ParameterKey &&
        s.ParameterValue === p.ParameterValue,
    );
  });
}

/**
 * Returns all unique parameters present in either the stack parameters or the
 * change set parameters
 * @param {AWS.CloudFormation.Parameters} stackParameters
 * @param {AWS.CloudFormation.Parameters} changeSetParameters
 * @returns {AWS.CloudFormation.ParameterKey[]}
 */
function allParameterKeys(stackParameters, changeSetParameters) {
  return [
    ...new Set([
      ...stackParameters.map((p) => p.ParameterKey),
      ...changeSetParameters.map((p) => p.ParameterKey),
    ]),
  ];
}

/**
 * Returns the parameter deltas comparing the stack and change set parameters
 * in the form [parameter key, stack value, change set value]. If the parameter
 * is missing from the stack or change set, the value will be undefined.
 * @param {AWS.CloudFormation.Parameters} stackParameters
 * @param {AWS.CloudFormation.Parameters} changeSetParameters
 * @returns {ParameterDeltas}
 */
function parameterDeltas(stackParameters, changeSetParameters) {
  return allParameterKeys(stackParameters, changeSetParameters)
    .map((k) => {
      /** @type {ParameterDelta} */
      const delta = [
        k,
        stackParameters.find((p) => p.ParameterKey === k)?.ParameterValue,
        changeSetParameters.find((p) => p.ParameterKey === k)?.ParameterValue,
      ];
      return delta;
    })
    .filter((d) => d[1] !== d[2]);
}

/**
 * Builds a Slack markdown flavored string representing a specific parameter
 * value, based on the type of parameter (Git commit, Docker tag, etc)
 * @param {AWS.CloudFormation.ParameterKey} key
 * @param {AWS.CloudFormation.ParameterValue} value
 * @param {Boolean} noLinks
 * @returns {String}
 */
function parameterDeltasListValue(key, value, noLinks = false) {
  if (!value) {
    return;
  }

  if (noLinks) {
    return `\`${value}\``;
  }

  if (key === 'InfrastructureGitCommit') {
    const url = `https://github.com/PRX/Infrastructure/commit/${value}`;
    return `\`<${url}|${value.slice(0, 7)}>\``;
  }

  if (/dkr\.ecr/.test(value)) {
    const repo = value.match(/github\/([^:]+):/)[1];
    const commit = value.match(/:([0-9a-f]{40})$/)[1];

    const url = `https://github.com/${repo}/commit/${commit}`;
    return `\`<${url}|${commit.slice(0, 7)}>\``;
  }

  // Look for `GitHub/[CHARS]/[CHARS]/[HEX HASH]`
  if (/GitHub\/[^\/]+\/[^\/]+\/[a-f0-9]{40}/.test(value)) {
    const repo = value.match(/GitHub\/([^\/]+\/[^\/]+)/)[1];
    const commit = value.match(/\/([0-9a-f]{40})/)[1];

    const url = `https://github.com/${repo}/commit/${commit}`;
    return `\`<${url}|${commit.slice(0, 7)}>\``;
  }

  return `\`${value}\``;
}

/**
 * Returns an arrow emoji for use when listed parameter changes. The arrow may
 * behave differently depending on the type of parameter it is representing
 * @param {ParameterDelta} parameterDelta
 * @param {Boolean} noLinks
 * @returns {String}
 */
function parameterDeltasListArrow(parameterDelta, noLinks = false) {
  if (noLinks) {
    return '➡';
  }

  if (parameterDelta[0] === 'InfrastructureGitCommit') {
    const url = `https://github.com/PRX/Infrastructure/compare/${parameterDelta[1]}...${parameterDelta[2]}`;
    return `<${url}|➡>`;
  }

  if (
    /EcrImageTag/.test(parameterDelta[0]) &&
    parameterDelta[0] &&
    parameterDelta[1] &&
    parameterDelta[2]
  ) {
    const slug = parameterDelta[0].replace('EcrImageTag', '');
    const sha1 = parameterDelta[1].split(':')[1];
    const sha2 = parameterDelta[2].split(':')[1];
    const url = `https://github.com/PRX/${slug}.prx.org/compare/${sha1}...${sha2}`;
    return `<${url}|➡>`;
  }

  // Look for `GitHub/[CHARS]/[CHARS]/[HEX HASH]`
  if (
    parameterDelta[1] &&
    parameterDelta[2] &&
    /GitHub\/[^\/]+\/[^\/]+\/[a-f0-9]{40}/.test(parameterDelta[2])
  ) {
    const repo = parameterDelta[2].match(/GitHub\/([^\/]+\/[^\/]+)/)[1];

    const oldCommit = parameterDelta[1].match(/\/([0-9a-f]{40})/)[1];
    const newCommit = parameterDelta[2].match(/\/([0-9a-f]{40})/)[1];

    const url = `https://github.com/${repo}/compare/${oldCommit}...${newCommit}`;
    return `<${url}|➡>`;
  }

  return '➡';
}

/**
 * Returns a multi-line string describing the parameters that have changed
 * between a given stack and change set
 * @param {AWS.CloudFormation.Parameters} stackParameters
 * @param {AWS.CloudFormation.Parameters} changeSetParameters
 * @returns {String}
 */
function parameterDeltasList(stackParameters, changeSetParameters) {
  const deltas = parameterDeltas(stackParameters, changeSetParameters);
  const allowedDeltas = deltas.filter((d) => d[0] !== 'PipelineExecutionNonce');

  // Text blocks within attachments have a 3000 character limit. If the text is
  // too large, try creating the list without links to reduce the size.
  const withLinks = allowedDeltas
    .map((d) => {
      const oldValue = parameterDeltasListValue(d[0], d[1]) || '❔';
      const newValue = parameterDeltasListValue(d[0], d[2]) || '❌';
      const arrow = parameterDeltasListArrow(d);

      return `*${d[0]}*: ${oldValue} ${arrow} ${newValue}`;
    })
    .join('\n');

  if (withLinks.length < 2900) {
    return withLinks;
  } else {
    return allowedDeltas
      .map((d) => {
        const oldValue = parameterDeltasListValue(d[0], d[1]) || '❔';
        const newValue = parameterDeltasListValue(d[0], d[2]) || '❌';
        const arrow = parameterDeltasListArrow(d, true);

        return `*${d[0]}*: ${oldValue} ${arrow} ${newValue}`;
      })
      .join('\n');
  }
}

/**
 *
 * @param {CodePipelineJob} job
 * @returns {String}
 */
function deployId(job) {
  const repoArtifact = job.data.inputArtifacts.find((a) =>
    /InfrastructureRepo/.test(a.name),
  );
  const configArtifact = job.data.inputArtifacts.find((a) =>
    /TemplateConfig/.test(a.name),
  );

  const repoId = repoArtifact.revision.slice(0, 3);
  const configId = configArtifact.revision.slice(0, 3);

  return `${repoId}-${configId}`;
}

/**
 * Constructs a Slack message payload with information about change set.
 * @param {CodePipelineJob} job
 * @returns {Promise<ChatPostMessageArguments>}
 */
async function buildMessage(job) {
  const userParameters = JSON.parse(
    job.data.actionConfiguration.configuration.UserParameters,
  );

  const StackName = userParameters.StackName;
  const ChangeSetName = userParameters.ChangeSetName;

  // Get current stack parameter values
  const stacks = await cloudformation.describeStacks({ StackName }).promise();
  const stack = stacks.Stacks[0];

  // Get new parameter values from change set
  const changeSet = await cloudformation
    .describeChangeSet({ StackName, ChangeSetName })
    .promise();

  return {
    username: 'AWS CodePipeline',
    icon_emoji: ':ops-codepipeline:',
    channel: '#ops-deploys',
    text: `${deployId(job)} The pipeline's *${
      userParameters.Stage
    }* stage is deploying.`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${userParameters.Stage} deploy`,
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `\`${deployId(job)}\`The pipeline's *${
            userParameters.Stage
          }* stage is deploying.`,
        },
      },
      {
        type: 'divider',
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            'CloudFormation stack parameter changes:',
            parameterDeltasList(stack.Parameters, changeSet.Parameters),
          ].join('\n'),
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Excludes ${
              unchangedParameters(stack.Parameters, changeSet.Parameters).length
            } unchanged parameters`,
          },
        ],
      },
    ],
  };
}

/**
 * Publishes a Slack message to the relay SNS topic with information about a
 * CloudFormation change set. This is executed as an action within a
 * CodePipeline.
 * @param {SNSEvent} event
 * @returns {Promise<void>}
 */
exports.handler = async (event) => {
  console.log(JSON.stringify(event));

  /** @type {CodePipelineJob} */
  const job = event['CodePipeline.job'];

  try {
    const slackMessage = await buildMessage(job);

    await sns
      .publish({
        TopicArn: process.env.SLACK_MESSAGE_RELAY_TOPIC_ARN,
        Message: JSON.stringify(slackMessage),
      })
      .promise();

    await codepipeline.putJobSuccessResult({ jobId: job.id }).promise();
  } catch (error) {
    console.error(error);
    await codepipeline
      .putJobFailureResult({
        jobId: job.id,
        failureDetails: {
          message: `${error.name}: ${error.message}`,
          type: 'JobFailed',
        },
      })
      .promise();
  }
};

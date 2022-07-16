const AWS = require('aws-sdk');

const cloudformation = new AWS.CloudFormation({
  apiVersion: '2010-05-15',
  maxRetries: 10,
  retryDelayOptions: { base: 500 },
});

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
        (s.ParameterValue || s.ResolvedValue) ===
          (p.ParameterValue || s.ResolvedValue),
    );
  });
}

/**
 * Returns an array all unique parameters keys (strings) present in either the
 * stack parameters or the change set parameters
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
 *
 * When the value for the stack and change set are the same the parameter is
 * excluded.
 *
 * The resolved value for a parameter will be used if present, so for SSM-based
 * parameters, the delta is based on the value in Parameter Store, not the
 * actual parameter value.
 * @param {AWS.CloudFormation.Parameters} stackParameters
 * @param {AWS.CloudFormation.Parameters} changeSetParameters
 * @returns {ParameterDeltas}
 */
function parameterDeltas(stackParameters, changeSetParameters) {
  return allParameterKeys(stackParameters, changeSetParameters)
    .map((key) => {
      const stackParam = stackParameters.find((p) => p.ParameterKey === key);
      const stackParamValue =
        stackParam?.ResolvedValue || stackParam?.ParameterValue;

      const changeSetParam = changeSetParameters.find(
        (p) => p.ParameterKey === key,
      );
      const changeSetParamValue =
        changeSetParam?.ResolvedValue || changeSetParam?.ParameterValue;

      /** @type {ParameterDelta} */
      const delta = [key, stackParamValue, changeSetParamValue];
      return delta;
    })
    .filter((d) => d[1] !== d[2]);
}

/**
 * Builds a Slack markdown flavored string representing a specific parameter
 * value, based on the form of parameter value. It will contain a link to the
 * relevant commit in GitHub, so the repo and commit ID are extracted from the
 * value.
 *
 * Some values are Docker image tags like:
 * 111111111111.dkr.ecr.us-east-1.amazonaws.com/github/prx/my-repo:f4a8a88f7adafa4d2f268573672374af025a314
 *
 * Some values are S3 object names that contain GitHub info:
 * GitHub/PRX/my-repo/f4a8a88f7adafa4d2f268573672374af025a314.zip
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

  // The InfrastructureGitCommit parameter value is a just a commit hash,
  // so it is handled explicitly
  if (key === 'InfrastructureGitCommit') {
    const url = `https://github.com/PRX/Infrastructure/commit/${value}`;
    return `\`<${url}|${value.slice(0, 7)}>\``;
  }

  // Look for anything containing "dkr.ecr", which is an ECR Docker image tag
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
 * Returns an arrow emoji that is shown when displaying a parameter value that
 * has changed. The arrow will be a link to a diff in GitHub for the before and
 * after commits. The repo and commit IDs are extract from the parameter values
 * based on the form of the value.
 *
 * This is JUST the arrow, it doesn't affect what is arround the arrow in the
 * message, even though it deals with those values.
 *
 * Some values are Docker image tags like:
 * 111111111111.dkr.ecr.us-east-1.amazonaws.com/github/prx/my-repo:f4a8a88f7adafa4d2f268573672374af025a314
 *
 * Some values are S3 object names that contain GitHub info:
 * GitHub/PRX/my-repo/f4a8a88f7adafa4d2f268573672374af025a314.zip
 * @param {ParameterDelta} parameterDelta
 * @param {Boolean} noLinks
 * @returns {String}
 */
function parameterDeltasListArrow(parameterDelta, noLinks = false) {
  if (noLinks) {
    return '➡';
  }

  const parameterKey = parameterDelta[0];
  const beforeValue = parameterDelta[1];
  const afterValue = parameterDelta[2];

  // The InfrastructureGitCommit parameter value is a just a commit hash,
  // so it is handled explicitly
  if (parameterKey === 'InfrastructureGitCommit') {
    const url = `https://github.com/PRX/Infrastructure/compare/${beforeValue}...${afterValue}`;
    return `<${url}|➡>`;
  }

  // Look for anything containing "dkr.ecr", which is an ECR Docker image tag
  // TODO This doesn't check if the repo in before and after changed
  if (
    beforeValue &&
    afterValue &&
    /dkr\.ecr/.test(beforeValue) &&
    /dkr\.ecr/.test(afterValue)
  ) {
    const repo = afterValue.match(/github\/([^:]+):/)[1];

    const oldCommit = beforeValue.match(/:([0-9a-f]{40})$/)[1];
    const newCommit = afterValue.match(/:([0-9a-f]{40})$/)[1];

    const url = `https://github.com/${repo}/compare/${oldCommit}...${newCommit}`;
    return `<${url}|➡>`;
  }

  // Look for `GitHub/[CHARS]/[CHARS]/[HEX HASH]`
  // TODO This doesn't check if the repo in before and after changed
  if (
    beforeValue &&
    afterValue &&
    /GitHub\/[^\/]+\/[^\/]+\/[a-f0-9]{40}/.test(beforeValue) &&
    /GitHub\/[^\/]+\/[^\/]+\/[a-f0-9]{40}/.test(afterValue)
  ) {
    const repo = afterValue.match(/GitHub\/([^\/]+\/[^\/]+)/)[1];

    const oldCommit = beforeValue.match(/\/([0-9a-f]{40})/)[1];
    const newCommit = afterValue.match(/\/([0-9a-f]{40})/)[1];

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
  const allowedDeltas = deltas.filter(
    (d) => !['PipelineExecutionNonce', 'TemplateUrlBase'].includes(d[0]),
  );

  if (!allowedDeltas.length) {
    return 'This change set contained no meaningful parameter deltas.';
  }

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

module.exports = {
  async parameterDeltaText(stackName, changeSetName) {
    // Get current stack parameter values
    const stacks = await cloudformation
      .describeStacks({ StackName: stackName })
      .promise();
    const stack = stacks.Stacks[0];

    // Get new parameter values from change set
    const changeSet = await cloudformation
      .describeChangeSet({ StackName: stackName, ChangeSetName: changeSetName })
      .promise();

    return parameterDeltasList(stack.Parameters, changeSet.Parameters);
  },
};

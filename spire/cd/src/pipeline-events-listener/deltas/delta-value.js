/**
 * @typedef {import('@aws-sdk/client-cloudformation').Parameter["ParameterKey"]} ParameterKey
 * @typedef {import('@aws-sdk/client-cloudformation').Parameter["ParameterValue"]} ParameterValue
 */

/**
 * Builds a Slack markdown flavored string representing a specific parameter
 * value, based on the form of parameter value. It will contain a link to the
 * relevant commit in GitHub, so the repo and commit ID are extracted from the
 * value.
 *
 * Some values are Docker image tags like:
 * 111111111111.dkr.ecr.us-east-1.amazonaws.com/github/prx/my-repo:5dcaf25b333f251be26dc468d8b82887b6370534
 *
 * Some values are S3 object names that contain GitHub info:
 * GitHub/PRX/my-repo/5dcaf25b333f251be26dc468d8b82887b6370534.zip
 * @param {ParameterKey} key
 * @param {ParameterValue} value
 * @param {Boolean} noLinks
 * @returns {String}
 */
module.exports = function (key, value, noLinks = false) {
  if (value === '') {
    return '(Empty string)';
  }

  if (!value) {
    return '❌';
  }

  // The InfrastructureGitCommit parameter value is a just a commit hash,
  // so it is handled explicitly
  if (key === 'InfrastructureGitCommit') {
    const url = `https://github.com/PRX/Infrastructure/commit/${value}`;
    return `\`<${url}|${value.slice(0, 7)}>\``;
  }

  // Check if the value looks anything like:
  // github/org-name/repo-name/1234567890123456789012345678901234567890
  const gitHubMatch = value.match(/github\/(.*\/.*)[:\/]([0-9a-f]{40})/i);
  if (gitHubMatch) {
    const repo = gitHubMatch[1];
    const commit = gitHubMatch[2];

    const url = `https://github.com/${repo}/commit/${commit}`;
    const text = commit.slice(0, 7);

    return noLinks ? `\`${text}\`` : `\`<${url}|${text}>\``;
  }

  return `\`${value}\``;
};

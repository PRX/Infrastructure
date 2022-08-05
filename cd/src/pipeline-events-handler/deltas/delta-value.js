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
module.exports = function (key, value, noLinks = false) {
  if (value === '') {
    return '❔';
  }

  if (!value) {
    return '❌';
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
};

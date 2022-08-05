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
module.exports = function (parameterDelta, noLinks = false) {
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
};

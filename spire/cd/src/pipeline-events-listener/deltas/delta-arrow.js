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

  const parameterKey = parameterDelta.parameter;
  const beforeValue = parameterDelta.stackValue;
  const afterValue = parameterDelta.changeSetValue;

  // The InfrastructureGitCommit parameter value is a just a commit hash,
  // so it is handled explicitly
  if (parameterKey === 'InfrastructureGitCommit') {
    const url = `https://github.com/PRX/Infrastructure/compare/${beforeValue}...${afterValue}`;
    return `<${url}|➡>`;
  }

  if (beforeValue && afterValue) {
    const beforeGitHubMatch = beforeValue.match(
      /github\/(.*\/.*)[:\/]([0-9a-f]{40})/i,
    );
    const afterGitHubMatch = afterValue.match(
      /github\/(.*\/.*)[:\/]([0-9a-f]{40})/i,
    );

    if (beforeGitHubMatch && afterGitHubMatch) {
      const beforeRepo = beforeGitHubMatch[1];
      const afterRepo = afterGitHubMatch[1];

      if (beforeRepo === afterRepo) {
        const beforeCommit = beforeGitHubMatch[2];
        const afterCommit = afterGitHubMatch[2];

        const url = `https://github.com/${afterRepo}/compare/${beforeCommit}...${afterCommit}`;
        return `<${url}|➡>`;
      }
    }
  }

  return '➡';
};

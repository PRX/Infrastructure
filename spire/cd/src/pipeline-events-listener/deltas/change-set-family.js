/** @typedef {import('@aws-sdk/client-cloudformation').DescribeChangeSetOutput} DescribeChangeSetOutput */

const { CloudFormation } = require('@aws-sdk/client-cloudformation');
const { StandardRetryStrategy } = require('@aws-sdk/middleware-retry');

const MAXIMUM_ATTEMPTS = 6;
const MAXIMUM_RETRY_DELAY = 10000;
const customRetryStrategy = new StandardRetryStrategy(
  async () => MAXIMUM_ATTEMPTS,
  {
    delayDecider: (_, attempts) =>
      Math.floor(
        Math.min(MAXIMUM_RETRY_DELAY, Math.random() * 2 ** attempts * 1100),
      ),
  },
);

const cloudformation = new CloudFormation({
  apiVersion: '2010-05-15',
  maxAttempts: MAXIMUM_ATTEMPTS,
  retryStrategy: customRetryStrategy,
});

/**
 * @param {string} stackName
 * @param {string} changeSetName
 * @returns {Promise<DescribeChangeSetOutput[]>}
 */
async function changeSetFamily(stackName, changeSetName) {
  const changeSets = [];

  // Get the details of just the given change set
  const changeSet = await cloudformation.describeChangeSet({
    StackName: stackName,
    ChangeSetName: changeSetName,
  });

  // Add the parameters for the given stack to the object
  changeSets.push(changeSet);

  // Find any child resources for the given stack that indicate they also have
  // their own change set
  const changesWithChangeSets = changeSet.Changes.filter(
    (c) => c.ResourceChange?.ChangeSetId,
  );

  for (const change of changesWithChangeSets) {
    const nestedStackId = change.ResourceChange.PhysicalResourceId;
    const nestedChangeSetId = change.ResourceChange.ChangeSetId;

    const nestedChangeSets = await changeSetFamily(
      nestedStackId,
      nestedChangeSetId,
    );

    changeSets.push(...nestedChangeSets);
  }

  return changeSets;
}

module.exports = changeSetFamily;

const AWS = require('aws-sdk');

const cloudformation = new AWS.CloudFormation({
  apiVersion: '2010-05-15',
  maxRetries: 10,
  retryDelayOptions: { base: 500 },
});

/**
 * @param {string} stackName
 * @param {string} changeSetName
 * @returns {Promise<AWS.CloudFormation.DescribeChangeSetOutput[]>}
 */
async function changeSetFamily(stackName, changeSetName) {
  const changeSets = [];

  // Get the details of just the given change set
  const changeSet = await cloudformation
    .describeChangeSet({ StackName: stackName, ChangeSetName: changeSetName })
    .promise();

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

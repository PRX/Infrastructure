const AWS = require('aws-sdk');

const cloudformation = new AWS.CloudFormation({
  apiVersion: '2010-05-15',
  maxRetries: 10,
  retryDelayOptions: { base: 500 },
});

/**
 * @param {string} stackName
 * @returns {Promise<AWS.CloudFormation.Stack[]>}
 */
async function stackFamily(stackName) {
  const stacks = [];

  // Get the details of just the given stack
  const stackResp = await cloudformation
    .describeStacks({ StackName: stackName })
    .promise();
  const stack = stackResp.Stacks[0];

  // Add the stack details for given stack to the array
  stacks.push(stack);

  // Query all the resources in the given stack..
  const resourceList = await cloudformation
    .listStackResources({ StackName: stack.StackId })
    .promise();

  // ...and look for any child CloudFormation stacks
  const resourceSummaries = resourceList.StackResourceSummaries;
  const nestedStackSummaries = resourceSummaries.filter(
    (r) => r.ResourceType === 'AWS::CloudFormation::Stack',
  );

  // Then recursively look for more descendents in those child stacks
  for (const stackSummary of nestedStackSummaries) {
    const nestedStackId = stackSummary.PhysicalResourceId;
    const nestedStacks = await stackFamily(nestedStackId);

    stacks.push(...nestedStacks);
  }

  return stacks;
}

module.exports = stackFamily;

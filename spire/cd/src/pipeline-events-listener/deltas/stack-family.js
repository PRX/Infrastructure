/** @typedef {import('@aws-sdk/client-cloudformation').Stack} Stack */

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
 * @returns {Promise<Stack[]>}
 */
async function stackFamily(stackName) {
  const stacks = [];

  // Get the details of just the given stack
  const stackResp = await cloudformation.describeStacks({
    StackName: stackName,
  });
  const stack = stackResp.Stacks[0];

  // Add the stack details for given stack to the array
  stacks.push(stack);

  // Query all the resources in the given stack..
  const resourceList = await cloudformation.listStackResources({
    StackName: stack.StackId,
  });
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

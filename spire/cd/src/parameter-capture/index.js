/** @typedef {import('@aws-sdk/client-cloudformation').Stack} Stack */

const { CloudFormation } = require('@aws-sdk/client-cloudformation');
const { CodePipeline } = require('@aws-sdk/client-codepipeline');
const { S3 } = require('@aws-sdk/client-s3');
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
const codepipeline = new CodePipeline({ apiVersion: '2015-07-09' });
const s3 = new S3({ apiVersion: '2006-03-01' });

/**
 * Returns an array of all stacks that are related to some root stack through
 * nesting, including the root stack. The elements of the array are the objects
 * returned by describe-stacks.
 * @param {string} stackId
 * @returns {Promise<Stack[]>}
 */
async function getStackHierarchy(stackId) {
  const stackDesc = await cloudformation.describeStacks({ StackName: stackId });
  // Start with an array containing only the root stack
  let stacks = stackDesc.Stacks;

  // Query all the resources in the given stack..
  const resourceList = await cloudformation.listStackResources({
    StackName: stackId,
  });
  // ...and look for any child CloudFormation stacks
  const resourceSummaries = resourceList.StackResourceSummaries;
  const nestedStackSummaries = resourceSummaries.filter(
    (r) => r.ResourceType === 'AWS::CloudFormation::Stack',
  );

  // Then recursively look for more descendents in those child stacks
  for (const s of nestedStackSummaries) {
    const nestedStackId = s.PhysicalResourceId;
    const nestedStackFamily = await getStackHierarchy(nestedStackId);
    stacks = stacks.concat(nestedStackFamily);
  }

  return stacks;
}

/**
 * Returns an object, where each key is the name of a parameter in Parameter
 * Store, and each value is the value of that parameter at the time
 * CloudFormation resolved it. This includes all Parameter Store-based stack
 * parameters for all stacks in the array being passed in.
 * @param {Stack[]} stacks
 * @returns {Object}
 */
function getAllResolveParameters(stacks) {
  return stacks
    .reduce(
      (acc, cur) => [...acc, ...cur.Parameters.filter((p) => p.ResolvedValue)],
      [],
    )
    .reduce(
      (acc, cur) => ({ ...acc, [cur.ParameterValue]: cur.ResolvedValue }),
      {},
    );
}

exports.handler = async (event, context) => {
  const job = event['CodePipeline.job'];

  try {
    const rootStackName =
      job.data.actionConfiguration.configuration.UserParameters;

    const allStacks = await getStackHierarchy(rootStackName);
    const resolvedParams = getAllResolveParameters(allStacks);

    console.log(JSON.stringify(resolvedParams));

    // Snapshots are named with a timestamp, eg infra-staging/123456.json
    const iso8601 = new Date().toISOString();
    const key = `${rootStackName}/${iso8601}.json`;

    await s3.putObject({
      Bucket: process.env.INFRASTRUCTURE_SNAPSHOTS_BUCKET,
      Key: key,
      Body: JSON.stringify(resolvedParams),
    });

    await codepipeline.putJobSuccessResult({
      jobId: job.id,
    });
  } catch (error) {
    console.error(error);
    await codepipeline.putJobFailureResult({
      jobId: job.id,
      failureDetails: {
        message: `${error.name}: ${error.message}`,
        type: 'JobFailed',
        externalExecutionId: context.invokeid,
      },
    });
  }
};

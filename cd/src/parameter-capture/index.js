const AWS = require('aws-sdk');

const s3 = new AWS.S3({ apiVersion: '2006-03-01' });
const codepipeline = new AWS.CodePipeline({ apiVersion: '2015-07-09' });
const cloudformation = new AWS.CloudFormation({
  apiVersion: '2010-05-15',
  maxRetries: 5,
  retryDelayOptions: { base: 1100 },
});

const rootStackName = 'infrastructure-cd-root-staging';

/**
 * Returns an array of all stacks that are related to some root stack through
 * nesting, including the root stack. The elements of the array are the objects
 * returned by describe-stacks.
 * @param {*} stackId
 * @returns {Promise<AWS.CloudFormation.Stacks>}
 */
async function getStackFamily(stackId) {
  const stackDesc = await cloudformation
    .describeStacks({ StackName: stackId })
    .promise();

  // Start with an arry containing only the root stack
  let stacks = stackDesc.Stacks;

  // Query all the resources in the given stack, and look for any nested
  // CloudFormation stacks
  const resourceList = await cloudformation
    .listStackResources({ StackName: stackId })
    .promise();

  const resourceSummaries = resourceList.StackResourceSummaries;
  const nestedStackSummaries = resourceSummaries.filter(
    (r) => r.ResourceType === 'AWS::CloudFormation::Stack',
  );

  for (const s of nestedStackSummaries) {
    const nestedStackId = s.PhysicalResourceId;
    const nestedStackFamily = await getStackFamily(nestedStackId);
    stacks = stacks.concat(nestedStackFamily);
  }

  return stacks;
}

/**
 * Returns an object, where each key is the name of a parameter in Parameter
 * Store, and each value is the value of that parameter at the time
 * CloudFormation resolved it.
 * @param {AWS.CloudFormation.Stacks} stacks
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
    const allStacks = await getStackFamily(rootStackName);
    const resolvedParams = getAllResolveParameters(allStacks);

    // await s3
    //   .putObject({
    //     Bucket: process.env.INFRASTRUCTURE_SNAPSHOTS_BUCKET,
    //     Key: key,
    //     Body: JSON.stringify(resolvedParams),
    //   })
    //   .promise();

    await codepipeline
      .putJobSuccessResult({
        jobId: job.id,
      })
      .promise();
  } catch (error) {
    await codepipeline
      .putJobFailureResult({
        jobId: job.id,
        failureDetails: {
          message: JSON.stringify(error),
          type: 'JobFailed',
          externalExecutionId: context.invokeid,
        },
      })
      .promise();
  }
};

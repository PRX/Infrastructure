import {
  CloudFormationClient,
  DescribeStacksCommand,
  ListStackResourcesCommand,
} from '@aws-sdk/client-cloudformation';
import {
  CodePipelineClient,
  PutJobFailureResultCommand,
  PutJobSuccessResultCommand,
} from '@aws-sdk/client-codepipeline';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { StandardRetryStrategy } from '@aws-sdk/middleware-retry';

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

const cloudformationClient = new CloudFormationClient({
  apiVersion: '2010-05-15',
  maxAttempts: MAXIMUM_ATTEMPTS,
  retryStrategy: customRetryStrategy,
});
const codepipelineClient = new CodePipelineClient({ apiVersion: '2015-07-09' });
const s3Client = new S3Client({ apiVersion: '2006-03-01' });

const rootStackName = 'infrastructure-cd-root-staging';

/**
 * Returns an array of all stacks that are related to some root stack through
 * nesting, including the root stack. The elements of the array are the objects
 * returned by describe-stacks.
 * @param {*} stackId
 * @returns {Promise<AWS.CloudFormation.Stacks>}
 */
async function getStackFamily(stackId) {
  const stackDesc = await cloudformationClient.send(
    new DescribeStacksCommand({ StackName: stackId }),
  );

  // Start with an array containing only the root stack
  let stacks = stackDesc.Stacks;

  // Query all the resources in the given stack, and look for any nested
  // CloudFormation stacks
  const resourceList = await cloudformationClient.send(
    new ListStackResourcesCommand({ StackName: stackId }),
  );

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
 * CloudFormation resolved it. This includes all parameter store-based stack
 * parameters for all stacks in the array being passed in.
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

export const handler = async (event) => {
  const job = event['CodePipeline.job'];

  try {
    const allStacks = await getStackFamily(rootStackName);
    const resolvedParams = getAllResolveParameters(allStacks);

    console.log(JSON.stringify(resolvedParams));

    // Snapshots are named with a timestamp, eg staging/123456.json
    const env = 'dev';
    const ts = Date.now();
    const key = `${env}/${ts}.json`;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: process.env.INFRASTRUCTURE_SNAPSHOTS_BUCKET,
        Key: key,
        Body: JSON.stringify(resolvedParams),
      }),
    );

    await codepipelineClient.send(
      new PutJobSuccessResultCommand({
        jobId: job.id,
      }),
    );
  } catch (error) {
    await codepipelineClient.send(
      new PutJobFailureResultCommand({
        jobId: job.id,
        failureDetails: {
          message: JSON.stringify(error),
          type: 'JobFailed',
          externalExecutionId: context.invokeid,
        },
      }),
    );
  }
};

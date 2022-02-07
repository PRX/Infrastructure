const AWS = require('aws-sdk');
const cloudformation = new AWS.CloudFormation({
  apiVersion: '2010-05-15',
  maxRetries: 5,
  retryDelayOptions: { base: 1100 },
});

async function findDescendentStacks(StackName) {
  const stacks = [];

  const resources = await cloudformation
    .listStackResources({ StackName })
    .promise();

  for (const resource of resources.StackResourceSummaries) {
    if (resource.ResourceType === 'AWS::CloudFormation::Stack') {
      // stacks.push(resource);
      // stacks.push(...(await findDescendentStacks(resource.PhysicalResourceId)));
    }
  }

  return stacks;
}

const rootStackName = 'infrastructure-cd-root-staging';
// const rootStackName =
//   'infrastructure-cd-root-staging-Apps100AStack-E9M188QXWO6X-DovetailTrafficStack-5ODSF66NUSII';

exports.handler = async () => {
  const allStacks = await findDescendentStacks(rootStackName);
  allStacks.push({ PhysicalResourceId: rootStackName });
  console.log(`Found ${allStacks.length} stacks`);

  const capture = {};

  for (const stack of allStacks) {
    const desc = await cloudformation
      .describeStacks({ StackName: stack.PhysicalResourceId })
      .promise();
    console.log(JSON.stringify(desc.Stacks[0].Parameters));

    if (desc?.Stacks?.[0]?.Parameters?.length) {
      const params = desc.Stacks[0].Parameters;

      for (const param of params) {
        // ParameterKey   = MyStackParameter
        // ParameterValue = /prx/foo/bar/BAZ_ARN
        // ResolvedValue  = arn:aws:foo:us-east-1:123456:bar
        if (param.ResolvedValue) {
          if (
            Object.keys(capture).includes(param.ParameterValue) &&
            capture[param.ParameterValue] !== param.ResolvedValue
          ) {
            // Two references to the same parameter store parameter have
            // different values, which really shouldn't happen, and we don't
            // know which one should be captured
            throw 'Parameter value mismatch';
          }

          capture[param.ParameterValue] = param.ResolvedValue;
        }
      }
    }
  }

  console.log(capture);
};

/**
 * @typedef { import('aws-lambda').SNSEvent } SNSEvent
 */

const { StandardRetryStrategy } = require('@aws-sdk/middleware-retry');

const MAXIMUM_ATTEMPTS = 6;
const MAXIMUM_RETRY_DELAY = 10000;
const customRetryStrategy = new StandardRetryStrategy(
  async () => MAXIMUM_ATTEMPTS,
  {
    delayDecider: (_, attempts) =>
      Math.floor(
        Math.min(MAXIMUM_RETRY_DELAY, Math.random() * 2 ** attempts * 400),
      ),
  },
);

const { CloudFormation } = require('@aws-sdk/client-cloudformation');
const { CodePipeline } = require('@aws-sdk/client-codepipeline');

const cloudformation = new CloudFormation({
  apiVersion: '2010-05-15',
  retryStrategy: customRetryStrategy,
});
const codepipeline = new CodePipeline({ apiVersion: '2015-07-09' });

/**
 * Publishes a Slack message to the relay SNS topic with information about a
 * CloudFormation change set. This is executed as an action within a
 * CodePipeline.
 * @param {SNSEvent} event
 * @returns {Promise<void>}
 */
exports.handler = async (event) => {
  console.log(JSON.stringify(event));

  const job = event['CodePipeline.job'];

  try {
    const actionConfig = job.data.actionConfiguration;
    const userParamsJson = actionConfig.configuration.UserParameters;
    const userParams = JSON.parse(userParamsJson);

    const stackName = userParams.StackName;
    const changeSetName = userParams.ChangeSetName;
    const roleArn = userParams.RoleArn;
    const paramOverrides = userParams.Parameters;
    const templateUrlBase = paramOverrides.TemplateUrlBase;

    const changeSetParams = paramOverrides;
    const changeSetParamsArray = Object.keys(changeSetParams).map((k) => ({
      ParameterKey: k,
      ParameterValue: changeSetParams[k],
    }));

    let existingChangeSet;
    try {
      existingChangeSet = await cloudformation.describeChangeSet({
        StackName: stackName,
        ChangeSetName: changeSetName,
      });

      if (existingChangeSet?.ExecutionStatus === 'EXECUTE_IN_PROGRESS') {
        // Don't try to delete a change set that is currently executing. (I don't
        // know if that's even possible.)
        await codepipeline.putJobFailureResult({
          jobId: job.id,
          failureDetails: {
            message: `Can't delete in progress change set`,
            type: 'JobFailed',
          },
        });
        return;
      } else if (existingChangeSet?.ChangeSetId) {
        await cloudformation.deleteChangeSet({
          StackName: stackName,
          ChangeSetName: changeSetName,
        });
      }
    } catch (e) {}

    // createChangeSet returns immediately once the the request to make the
    // change set has been made; it doesn't wait for the change set to actually
    // get made.
    await cloudformation.createChangeSet({
      StackName: stackName,
      ChangeSetName: changeSetName,
      RoleARN: roleArn,
      Capabilities: [
        'CAPABILITY_IAM',
        'CAPABILITY_NAMED_IAM',
        'CAPABILITY_AUTO_EXPAND',
      ],
      TemplateURL: `${templateUrlBase}/spire/templates/root.yml`,
      Parameters: changeSetParamsArray,
      IncludeNestedStacks: true,
    });

    let changeSetDone = false;

    do {
      // Wait a few seconds
      await new Promise((resolve) => setTimeout(resolve, 20000));
      console.log('Waiting for change set…');

      // Check the creation status of the change set
      const status = await cloudformation.describeChangeSet({
        StackName: stackName,
        ChangeSetName: changeSetName,
      });
      if (status.Status === 'CREATE_COMPLETE') {
        // When it's created, the Lambda can stop running and the pipeline
        // can continue
        changeSetDone = true;
        console.log('Change set was created successfully');
        await codepipeline.putJobSuccessResult({
          jobId: job.id,
          outputVariables: {
            StackName: stackName,
            ChangeSetName: changeSetName,
          },
        });
        break;
      } else if (
        // If it's still creating, the Lambda needs to keep waiting
        ['CREATE_PENDING', 'CREATE_IN_PROGRESS'].includes(status.Status)
      ) {
        changeSetDone = false;
        continue;
      } else {
        // Any other status would mean something went bad with the change set
        // and the pipeline execution neesd to halt
        changeSetDone = true;
        console.log('Change set creation failed!');
        console.log(status.Status);
        console.log(status.StatusReason);
        await codepipeline.putJobFailureResult({
          jobId: job.id,
          failureDetails: {
            message: `${status.Status} - ${status.StatusReason}`,
            type: 'JobFailed',
          },
        });
        break;
      }
    } while (changeSetDone === false);
  } catch (error) {
    console.error(error);
    await codepipeline.putJobFailureResult({
      jobId: job.id,
      failureDetails: {
        message: `${error.name}: ${error.message}`,
        type: 'JobFailed',
      },
    });
  }
};

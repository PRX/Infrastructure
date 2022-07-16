const AWS = require('aws-sdk');
const codepipeline = new AWS.CodePipeline({ apiVersion: '2015-07-09' });

// Returns the value of the action's UserParameters (always a string) as an
// output variable called `value`. I.e., echoes the user parameter as a
// CodePipeline output so it can be referenced throughout the pipeline.
exports.handler = async (event) => {
  const job = event['CodePipeline.job'];

  try {
    const actionConfig = job.data.actionConfiguration;
    const echoValue = actionConfig.configuration.UserParameters;

    await codepipeline
      .putJobSuccessResult({
        jobId: job.id,
        outputVariables: { value: echoValue },
      })
      .promise();
  } catch (error) {
    console.error(error);
    await codepipeline
      .putJobFailureResult({
        jobId: job.id,
        failureDetails: {
          message: `${error.name}: ${error.message}`,
          type: 'JobFailed',
        },
      })
      .promise();
  }
};

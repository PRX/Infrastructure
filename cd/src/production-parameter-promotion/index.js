const AWS = require('aws-sdk');

const ssm = new AWS.SSM({ apiVersion: '2014-11-06' });
const codepipeline = new AWS.CodePipeline();

exports.handler = async (event) => {
  const job = event['CodePipeline.job'];

  try {
    console.log(JSON.stringify(event));

    // Staging parameters that match these patterns will have their values
    // copied to the equivalent production paramter. These parameters should
    // contain identifiers for deployable code artifacts, like Docker image
    // tags, or S3 object keys.
    const patterns = [/\/pkg\/docker-image-tag$/, /\/pkg\/s3-object-key$/];

    // Get all staging Spire parameters
    const stagingParameters = await ssm
      .getParametersByPath({ Path: '/prx/stag/Spire/' })
      .promise();

    // Get all production Spire parameters
    const productionParameters = await ssm
      .getParametersByPath({ Path: '/prx/prod/Spire/' })
      .promise();

    // Filter down to just the parameters matching the above patterns.
    const stagingPkgParameters = stagingParameters.Parameters.filter(
      (parameter) => {
        for (const pattern of patterns) {
          if (pattern.test(parameter.Name)) {
            return true;
          }
        }

        return false;
      },
    );

    // For each staging package parameter, check if the production value is
    // out-of-date and copy the staging value to production if necessary
    for (const stagingPkgParameter of stagingPkgParameters) {
      const prodName = stagingPkgParameter.Name.replace(
        /^\/prx\/stag/,
        '/prx/prod',
      );

      // Find the current production parameter that matches this staging
      // parameter
      const productionPkgParameter = productionParameters.Parameters.find(
        (p) => p.Name === prodName,
      );

      // If the staging and production values don't match, assume that the
      // production value is stale, and copy the staging value into the
      // production parameter
      if (stagingPkgParameter.Value !== productionPkgParameter.Value) {
        await ssm
          .putParameter({
            Name: prodName,
            Overwrite: true,
            Value: stagingPkgParameter.Value,
            Type: 'String',
          })
          .promise();
      }
    }

    await codepipeline.putJobSuccessResult({ jobId: job.id }).promise();
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

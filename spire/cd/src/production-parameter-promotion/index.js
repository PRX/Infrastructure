const { SSM } = require('@aws-sdk/client-ssm');
const { CodePipeline } = require('@aws-sdk/client-codepipeline');
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

const ssm = new SSM({
  apiVersion: '2014-11-06',
  maxAttempts: MAXIMUM_ATTEMPTS,
  retryStrategy: customRetryStrategy,
});
const codepipeline = new CodePipeline({ apiVersion: '2015-07-09' });

/**
 * Recursively pages through all Parameter Store parameters under a given path
 * @param {string} path
 */
async function getAllParametersByPath(path, nextToken) {
  return new Promise((resolve, reject) => {
    const params = {
      Path: path,
      Recursive: true,
      ...(nextToken && { NextToken: nextToken }),
    };

    ssm.getParametersByPath(params, async (error, data) => {
      if (error) {
        reject(error);
      } else {
        const results = { Parameters: [] };
        results.Parameters.push(...data.Parameters);

        if (data.NextToken) {
          try {
            const more = await getAllParametersByPath(path, data.NextToken);

            if (more) {
              results.Parameters.push(...more.Parameters);
            }
          } catch (error) {
            reject(error);
          }
        }

        resolve(results);
      }
    });
  });
}

exports.handler = async (event) => {
  const job = event['CodePipeline.job'];

  try {
    console.log(JSON.stringify(event));

    // Staging parameters that match these patterns will have their values
    // copied to the equivalent production parameter. These parameters should
    // contain identifiers for deployable code artifacts, like Docker image
    // tags, or S3 object keys.
    const patterns = [/\/pkg\/docker-image-tag$/, /\/pkg\/s3-object-key$/];

    // Get all staging Spire parameters
    const stagingParameters = await getAllParametersByPath('/prx/stag/Spire');
    console.log(
      `Found ${stagingParameters.Parameters.length} staging parameters`,
    );

    // Get all production Spire parameters
    const productionParameters =
      await getAllParametersByPath('/prx/prod/Spire');
    console.log(
      `Found ${productionParameters.Parameters.length} production parameters`,
    );

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
    console.log(
      `Found ${stagingPkgParameters.length} staging package parameters`,
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
      if (stagingPkgParameter.Value !== productionPkgParameter?.Value) {
        console.log(`Promoting value for: ${prodName}`);
        console.log(`>> Old: ${productionPkgParameter?.Value}`);
        console.log(`>> New: ${stagingPkgParameter.Value}`);
        await ssm.putParameter({
          Name: prodName,
          Overwrite: true,
          Value: stagingPkgParameter.Value,
          Type: 'String',
        });
      }
    }

    await codepipeline.putJobSuccessResult({ jobId: job.id });
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

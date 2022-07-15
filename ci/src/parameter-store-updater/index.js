const AWS = require('aws-sdk');

const ssm = new AWS.SSM({ apiVersion: '2014-11-06' });
const sns = new AWS.SNS({
  apiVersion: '2010-03-31',
  region: process.env.SLACK_MESSAGE_RELAY_TOPIC_ARN.split(':')[3],
});

/**
 * Updates a Parameter Store parameter with the given value, if the parameter
 * appears to be one that should be updated when new code artifacts are created
 * @param {string} parameterName
 * @param {string} parameterValue
 */
async function updateSsmParameter(parameterName, parameterValue) {
  if (parameterName.startsWith('/prx/stag/Spire/')) {
    console.log(`Setting: ${parameterName} = ${parameterValue}`);
    await ssm
      .putParameter({
        Name: parameterName,
        Value: parameterValue,
        Type: 'String',
        Overwrite: true,
      })
      .promise();

    await sns
      .publish({
        TopicArn: process.env.SLACK_MESSAGE_RELAY_TOPIC_ARN,
        Message: JSON.stringify({
          username: 'AWS CodeBuild',
          icon_emoji: ':ops-codebuild:',
          channel: '#ops-debug',
          text: `[SSM] Setting: ${parameterName} = ${parameterValue}`,
        }),
      })
      .promise();
  }
}

/**
 * @param {object} environmentVariables - All environment variables present in a build result
 * @param {string} parameterListKey - The name of an envionment variable whose value is a comma delimited list of Parameter Store parameter names
 * @param {string} parameterValueKey - The name of an environment variable whose value is the identifier of some newly-created code artifact (like an ECR image tag, or S3 object key)
 */
async function updateParameters(
  environmentVariables,
  parameterListKey,
  parameterValueKey,
) {
  // If the values for both environment variables are set, that means there is
  // a list of parameters to update, and a value to update them with.
  if (
    environmentVariables[parameterListKey]?.length &&
    environmentVariables[parameterValueKey]?.length
  ) {
    // Get the new value
    const newValue = environmentVariables[parameterValueKey];

    // Get the parameter names from the list
    const paramList = environmentVariables[parameterListKey];
    const paramNames = paramList.split(',');

    // Update each parameter with the new value
    for (const parameterName of paramNames) {
      await updateSsmParameter(parameterName, newValue);
    }
  }
}

exports.handler = async (event) => {
  console.log(JSON.stringify(event));

  const eventDetail = event.detail;
  const info = eventDetail['additional-information'];

  // Combine the build's passed-in environment variables and any explicitly
  // exported environment variables (which may have been defined as part of the
  // build, but not passed in when the build started).
  const allEnvars = {};

  for (const envar of info.environment['environment-variables'] || []) {
    allEnvars[envar.name] = envar.value;
  }

  for (const envar of info['exported-environment-variables'] || []) {
    allEnvars[envar.name] = envar.value;
  }

  // PRX_CI_PUBLISH will be true when the build is publishing some sort of
  // deployable code artifact. Parameters only need to be updated when
  // something has been published.
  if (
    allEnvars.PRX_CI_PUBLISH === 'true' &&
    eventDetail['build-status'] === 'SUCCEEDED'
  ) {
    console.log(
      'Artifacts were published for this build. Checking for parameters to update.',
    );

    await updateParameters(
      allEnvars,
      'PRX_SPIRE_SSM_PARAMETERS_ECR_TAG',
      'PRX_ECR_IMAGE',
    );

    await updateParameters(
      allEnvars,
      'PRX_SPIRE_SSM_PARAMETERS_LAMBDA_S3_KEY',
      'PRX_LAMBDA_CODE_CONFIG_VALUE',
    );

    await updateParameters(
      allEnvars,
      'PRX_SPIRE_SSM_PARAMETERS_STATIC_S3_KEY',
      'PRX_S3_STATIC_CONFIG_VALUE',
    );
  }
};

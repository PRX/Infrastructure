import { SSMClient, PutParameterCommand } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({ apiVersion: '2014-11-06' });

/**
 * Updates a Parameter Store parameter with the given value, if the parameter
 * appears to be one that should be updated when new code artifacts are created
 * @param {string} parameterName
 * @param {string} parameterValue
 */
async function updateSsmParameter(parameterName, parameterValue) {
  if (parameterName.startsWith('/prx/stag/Spire/')) {
    console.log(`Setting: ${parameterName} = ${parameterValue}`);
    await ssm.send(
      new PutParameterCommand({
        Name: parameterName,
        Value: parameterValue,
        Type: 'String',
        Overwrite: true,
      }),
    );
  }
}

/**
 * @param {object} environmentVariables - All environment variables present in a build result
 * @param {string} environmentVariableName - The name of the environment variable to inspect for parameter mappings
 */
async function updateParameters(environmentVariables, environmentVariableName) {
  if (environmentVariables[environmentVariableName]?.length) {
    // raw will be like:
    // "MY_APP=/ssm/parameter/path", or
    // "MY_APP=/ssm/parameter/path;APP_TWO=/some/path"
    const raw = environmentVariables[environmentVariableName];
    const images = raw.split(';');

    for (const image of images) {
      // image will be like:
      // "MY_APP=/ssm/parameter/path", or
      // "MY_APP=/ssm/parameter/path,/another/ssm/path"
      const parts = image.split('=');

      if (parts.length === 2) {
        // e.g., "MY_APP"
        const imageEnvarName = parts[0];
        // e.g., "/ssm/parameter/path,/another/ssm/path"
        const parameterNamesList = parts[1];

        const parameterNames = parameterNamesList.split(',');

        for (const parameterName of parameterNames) {
          // parameterName is the name of a Parameter Store parameter that
          // needs to be updtaed

          // An environment variable was exported from the CodeBuild build
          // with the value that the parameter should be updated to.
          const newValue = environmentVariables[imageEnvarName];
          await updateSsmParameter(parameterName, newValue);
        }
      }
    }
  }
}

export const handler = async (event) => {
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

    await updateParameters(allEnvars, 'PRX_SPIRE_ECR_PKG_PARAMETERS');
    await updateParameters(allEnvars, 'PRX_SPIRE_S3_PKG_PARAMETERS');
  }
};

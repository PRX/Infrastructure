/**
 * @typedef { import('aws-lambda').SNSEvent } SNSEvent
 */

const AWS = require('aws-sdk');
const AdmZip = require('adm-zip');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cloudformation = new AWS.CloudFormation({ apiVersion: '2010-05-15' });
const codepipeline = new AWS.CodePipeline({ apiVersion: '2015-07-09' });
const s3 = new AWS.S3({ apiVersion: '2006-03-01' });

/**
 * Downloads the given S3 object to a local file path
 * @param {string} bucketName
 * @param {string} objectKey
 * @param {string} filePath
 */
function s3GetObject(bucketName, objectKey, filePath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filePath);
    const stream = s3
      .getObject({
        Bucket: bucketName,
        Key: objectKey,
      })
      .createReadStream();

    stream.on('error', reject);
    file.on('error', reject);

    file.on('finish', () => {
      resolve(filePath);
    });

    stream.pipe(file);
  });
}

/**
 * Publishes a Slack message to the relay SNS topic with information about a
 * CloudFormation change set. This is executed as an action within a
 * CodePipeline.
 * @param {SNSEvent} event
 * @returns {Promise<void>}
 */
exports.handler = async (event, context) => {
  console.log(JSON.stringify(event));

  const job = event['CodePipeline.job'];

  try {
    // Make a folder to hold local copies of the input artifacts
    fs.mkdirSync(path.join(os.tmpdir(), context.awsRequestId));

    const inputArtifacts = job.data.inputArtifacts;

    // Download the template config Zip file, and extract the stack parameters
    // from it
    const configZipTempPath = path.join(
      os.tmpdir(),
      context.awsRequestId,
      'config.zip',
    );
    const configArtifact = inputArtifacts.find((a) =>
      [
        'TemplateConfigStagingZipArtifact',
        'TemplateConfigProductionZipArtifact',
      ].includes(a.name),
    );
    await s3GetObject(
      configArtifact.location.s3Location.bucketName,
      configArtifact.location.s3Location.objectKey,
      configZipTempPath,
    );
    const configZip = new AdmZip(configZipTempPath);
    const configJson = configZip.readAsText('staging.json');
    const config = JSON.parse(configJson);
    const configParams = config.Parameters;

    // Download the Infrastructure repo Zip file, extract root.yml, and send
    // it back to S3 so that the change set can reference it directly
    const repoZipTempPath = path.join(
      os.tmpdir(),
      context.awsRequestId,
      'repo.zip',
    );
    const repoArtifact = inputArtifacts.find(
      (a) => a.name === 'InfrastructureRepoSourceArtifact',
    );
    await s3GetObject(
      repoArtifact.location.s3Location.bucketName,
      repoArtifact.location.s3Location.objectKey,
      repoZipTempPath,
    );
    const repoZip = new AdmZip(repoZipTempPath);
    const rootYaml = repoZip.readAsText('stacks/root.yml');
    const rootYamlObjectKey = `${repoArtifact.location.s3Location.objectKey}/${context.awsRequestId}`;
    await s3
      .putObject({
        Bucket: repoArtifact.location.s3Location.bucketName,
        Key: rootYamlObjectKey,
        Body: rootYaml,
      })
      .promise();

    const actionConfig = job.data.actionConfiguration;
    const userParamsJson = actionConfig.configuration.UserParameters;
    const userParams = JSON.parse(userParamsJson);

    const stackName = userParams.StackName;
    const changeSetName = userParams.ChangeSetName;
    const paramOverrides = userParams.ParameterOverrides;
    const roleArn = userParams.RoleArn;

    const changeSetParams = Object.assign(configParams, paramOverrides);
    const changeSetParamsArray = Object.keys(changeSetParams).map((k) => ({
      ParameterKey: k,
      ParameterValue: changeSetParams[k],
    }));

    // createChangeSet returns immediately once the the request to make the
    // change set has been made; it doesn't wait for the change set to actually
    // get made.
    await cloudformation
      .createChangeSet({
        StackName: stackName,
        ChangeSetName: changeSetName,
        RoleARN: roleArn,
        Capabilities: [
          'CAPABILITY_IAM',
          'CAPABILITY_NAMED_IAM',
          'CAPABILITY_AUTO_EXPAND',
        ],
        TemplateURL: `https://s3.${process.env.AWS_REGION}.amazonaws.com/${repoArtifact.location.s3Location.bucketName}/${rootYamlObjectKey}`,
        Parameters: changeSetParamsArray,
        IncludeNestedStacks: true,
      })
      .promise();

    fs.unlinkSync(configZipTempPath);
    fs.unlinkSync(repoZipTempPath);

    let changeSetDone = false;

    do {
      // Wait a few seconds
      await new Promise((resolve) => setTimeout(resolve, 10000));

      // Check the creation status of the change set
      const status = await cloudformation
        .describeChangeSet({
          StackName: stackName,
          ChangeSetName: changeSetName,
        })
        .promise();

      if (status.Status === 'CREATE_COMPLETE') {
        // When it's created, the Lambda can stop running and the pipeline
        // can continue
        changeSetDone = true;
        await codepipeline.putJobSuccessResult({ jobId: job.id }).promise();
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
        await codepipeline
          .putJobFailureResult({
            jobId: job.id,
            failureDetails: {
              message: `Change set failed with ${status.Status}`,
              type: 'JobFailed',
            },
          })
          .promise();
        break;
      }
    } while (changeSetDone === false);
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

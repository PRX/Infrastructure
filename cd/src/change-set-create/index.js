/**
 * @typedef { import('aws-lambda').SNSEvent } SNSEvent
 */

const AWS = require('aws-sdk');

const codepipeline = new AWS.CodePipeline({ apiVersion: '2015-07-09' });

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

  await codepipeline.putJobSuccessResult({ jobId: job.id }).promise();
};

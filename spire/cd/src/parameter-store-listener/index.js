const { CodePipeline } = require('@aws-sdk/client-codepipeline');

const codepipeline = new CodePipeline({ apiVersion: '2015-07-09' });

// https://docs.aws.amazon.com/systems-manager/latest/userguide/sysman-paramstore-cwe.html
/**
 * This function is subscribed to some EventBridge events related to parameters
 * in Paramater Store. It is intended to start Spire CD pipeline executions
 * when relevant events take place, such as a staging application Docker tag
 * getting updated.
 * @param {*} event
 */
exports.handler = async (event) => {
  console.log(JSON.stringify(event));

  if (
    event.detail.name.startsWith('/prx/stag/Spire/') ||
    event.detail.name.startsWith('/prx/global/Spire/')
  ) {
    await codepipeline.startPipelineExecution({
      name: process.env.PIPELINE_NAME,
    });
  }
};

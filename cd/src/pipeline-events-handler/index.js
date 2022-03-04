const regions = require('./regions');
const urls = require('./urls');
const pipelineStarted = require('./pipeline/started');
const stageSucceeded = require('./stage/succeeded');
const actionFailed = require('./action/failed');

// https://docs.aws.amazon.com/codepipeline/latest/userguide/detect-state-changes-cloudwatch-events.html#detect-state-events-types
exports.handler = async (event) => {
  console.log(JSON.stringify(event));

  if (event['detail-type'] === 'CodePipeline Pipeline Execution State Change') {
    // https://console.aws.amazon.com/events/home?region=us-east-1#/registries/aws.events/schemas/aws.codepipeline%40CodePipelinePipelineExecutionStateChange/version/1
    if (event.detail.state === 'STARTED') {
      await pipelineStarted(event);
    }
  } else if (
    event['detail-type'] === 'CodePipeline Stage Execution State Change'
  ) {
    // https://console.aws.amazon.com/events/home?region=us-east-1#/registries/aws.events/schemas/aws.codepipeline%40CodePipelineStageExecutionStateChange/version/1
    if (event.detail.state === 'SUCCEEDED') {
      await stageSucceeded(event);
    }
  } else if (
    event['detail-type'] === 'CodePipeline Action Execution State Change'
  ) {
    // https://console.aws.amazon.com/events/home?region=us-east-1#/registries/aws.events/schemas/aws.codepipeline%40CodePipelineActionExecutionStateChange/version/1
    if (event.detail.state === 'FAILED') {
      await actionFailed(event);
    }
  }
};

module.exports = {
  pipelineConsoleUrl(event) {
    return `https://console.aws.amazon.com/codesuite/codepipeline/pipelines/${event.detail.pipeline}/view?region=${event.region}`;
  },
  executionConsoleUrl(event) {
    return `https://console.aws.amazon.com/codesuite/codepipeline/pipelines/${event.detail.pipeline}/executions/${event.detail['execution-id']}/visualization?region=${event.region}`;
  },
};

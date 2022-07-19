module.exports = {
  pipelineConsoleUrl(region, pipelineName) {
    return `https://console.aws.amazon.com/codesuite/codepipeline/pipelines/${pipelineName}/view?region=${region}`;
  },
  executionConsoleUrl(region, pipelineName, executionId) {
    return `https://console.aws.amazon.com/codesuite/codepipeline/pipelines/${pipelineName}/executions/${executionId}/visualization?region=${region}`;
  },
};

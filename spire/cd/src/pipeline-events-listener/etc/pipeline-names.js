module.exports = (pipelineName) => {
  if (pipelineName.includes('-EmergencyPipeline-')) {
    return 'PANIC Spire CD Pipeline';
  } else if (pipelineName.includes('-Pipeline-')) {
    return 'Spire CD Pipeline';
  } else {
    return pipelineName;
  }
};

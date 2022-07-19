/**
 * The payload develired as JSON data within an SNS message from a CodePipeline
 * manual approval action
 * @typedef {Object} CodePipelineApprovalNotification
 * @property {String} region
 * @property {String} consoleLink
 * @property {CodePipelineApproval} approval
 */

/**
 * CodePipeline manual approval metadata
 * @typedef {Object} CodePipelineApproval
 * @property {String} pipelineName
 * @property {String} stageName
 * @property {String} actionName
 * @property {String} token
 * @property {String} expires - e.g., 2016-07-07T20:22Z
 * @property {String} [externalEntityLink]
 * @property {String} approvalReviewLink
 * @property {String} customData - JSON data configured on the pipeline action
 */

/**
 * Custom data configured on the pipeline manual approval action as JSON
 * @typedef {Object} CodePipelineApprovalCustomData
 * @property {String} StackName
 * @property {String} ChangeSetName
 * @property {String} AccountId
 * @property {String} PipelineExecutionId
 */

/**
 * CodePipeline manual approval metadata
 * @typedef {Object} CodePipelineJobDataActionConfigurationConfiguration
 * @property {String} FunctionName
 * @property {String} UserParameters
 */

/**
 * CodePipeline manual approval metadata
 * @typedef {Object} CodePipelineJobDataActionConfiguration
 * @property {CodePipelineJobDataActionConfigurationConfiguration} configuration
 */

/**
 * CodePipeline manual approval metadata
 * @typedef {Object} CodePipelineJobDataInputArtifact
 * @property {String} name
 * @property {String} revision
 */

/**
 * CodePipeline manual approval metadata
 * @typedef {Object} CodePipelineJobData
 * @property {CodePipelineJobDataActionConfiguration} actionConfiguration
 * @property {CodePipelineJobDataInputArtifact[]} inputArtifacts
 */

/**
 * The payload develired as JSON data via SNS from a CodePipeline manual
 * approval action
 * @typedef {Object} CodePipelineJob
 * @property {String} id
 * @property {String} accountId
 * @property {CodePipelineJobData} data
 */

/**
 * A tuple containing a paremeter key and the old and new value for the
 * parameter
 * @typedef {[AWS.CloudFormation.ParameterKey, AWS.CloudFormation.ParameterValue|undefined, AWS.CloudFormation.ParameterValue|undefined]} ParameterDelta
 */

/**
 * An array of parameter deltas
 * @typedef {ParameterDelta[]} ParameterDeltas
 */

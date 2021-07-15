/** @typedef {import('./index').EventBridgeCloudWatchAlarmsEvent} EventBridgeCloudWatchAlarmsEvent */

module.exports = {
  /**
   * Returns the name of a log group associated with the alarm that triggerd
   * and event.
   * @param {EventBridgeCloudWatchAlarmsEvent} event
   * @param {AWS.CloudWatch.DescribeAlarmsOutput} desc
   * @returns {String}
   */
  logGroup(event, desc) {
    // For Lambda alarms, look for a FunctionName dimension, and use that name
    // to construct the log group name
    if (
      desc?.MetricAlarms?.[0]?.Namespace === 'AWS/Lambda' &&
      desc?.MetricAlarms?.[0]?.Dimensions?.length
    ) {
      const functionDimension = desc.MetricAlarms[0].Dimensions.find(
        (d) => d.Name === 'FunctionName',
      );

      if (functionDimension) {
        return `/aws/lambda/${functionDimension.Value}`;
      }
    }
    // For Step Function alarms for Lambda states, look for a LambdaFunctionArn
    // dimension, and use that to construct the log group name
    else if (
      desc?.MetricAlarms?.[0]?.Namespace === 'AWS/States' &&
      desc?.MetricAlarms?.[0]?.Dimensions?.length
    ) {
      const functionDimension = desc.MetricAlarms[0].Dimensions.find(
        (d) => d.Name === 'LambdaFunctionArn',
      );

      if (functionDimension) {
        return `/aws/lambda/${functionDimension.Value.split(':function:')[1]}`;
      }
    }
  },
};

/** @typedef {import('./index').EventBridgeCloudWatchAlarmsEvent} EventBridgeCloudWatchAlarmsEvent */

const AWS = require('aws-sdk');

const sts = new AWS.STS({ apiVersion: '2011-06-15' });

// Alarms with certain namespaces can look up a log group from their resource
// tags, when there's no way to infer the log group from the alarm's
// configuration. This could include any namespaces, but it's limited to only
// those actively employing this strategy, to limit unnecessary API requests.
const TAGGED = [
  // AWS/Lambda included by default
  // AWS/States included by default
  'AWS/ApplicationELB',
  'PRX/Dovetail/Router',
  'PRX/Dovetail/Legacy',
  'PRX/Dovetail/Counts',
  'PRX/Dovetail/Analytics',
];

/**
 * @param {EventBridgeCloudWatchAlarmsEvent} event
 */
async function cloudWatchClient(event) {
  const accountId = event.account;
  const roleName = process.env.CROSS_ACCOUNT_CLOUDWATCH_ALARM_IAM_ROLE_NAME;

  const role = await sts
    .assumeRole({
      RoleArn: `arn:aws:iam::${accountId}:role/${roleName}`,
      RoleSessionName: 'notifications_lambda_reader',
    })
    .promise();

  return new AWS.CloudWatch({
    apiVersion: '2010-08-01',
    region: event.region,
    credentials: new AWS.Credentials(
      role.Credentials.AccessKeyId,
      role.Credentials.SecretAccessKey,
      role.Credentials.SessionToken,
    ),
  });
}

module.exports = {
  /**
   * Returns the name of a log group associated with the alarm that triggerd
   * and event.
   * @param {EventBridgeCloudWatchAlarmsEvent} event
   * @param {AWS.CloudWatch.DescribeAlarmsOutput} desc
   * @returns {Promise<String>}
   */
  async logGroup(event, desc) {
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
    //
    else if (TAGGED.includes(desc?.MetricAlarms?.[0]?.Namespace)) {
      const cloudwatch = await cloudWatchClient(event);
      const tagList = await cloudwatch
        .listTagsForResource({ ResourceARN: event.resources[0] })
        .promise();

      const logGroupNameTag = tagList?.Tags?.find(
        (t) => t.Key === 'prx:ops:cloudwatch-log-group-name',
      );

      if (logGroupNameTag) {
        return logGroupNameTag.Value;
      }
    }
  },
};

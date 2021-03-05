const AWS = require('aws-sdk');

const sts = new AWS.STS({ apiVersion: '2011-06-15' });

module.exports = {
  /**
   * Returns an assumed DevOps role from the given account
   * @param {string} awsAccountId
   * @returns {Promise<AWS.STS.AssumeRoleResponse>}
   */
  async devopsRole(awsAccountId) {
    const roleArn = `arn:aws:iam::${awsAccountId}:role/${process.env.DEVOPS_CROSS_ACCOUNT_ACCESS_ROLE_NAME}`;

    return sts
      .assumeRole({
        RoleArn: roleArn,
        RoleSessionName: 'devops_slack_app',
      })
      .promise();
  },
  /**
   * Returns an assumed Organization data sharing role from the given account
   * @param {string} awsAccountId
   * @returns {Promise<AWS.STS.AssumeRoleResponse>}
   */
  async orgSharingRole() {
    return sts
      .assumeRole({
        RoleArn: process.env.AWS_ORGANIZATION_CROSS_ACCOUNT_SHARING_ROLE_ARN,
        RoleSessionName: 'devops_slack_app',
      })
      .promise();
  },
};

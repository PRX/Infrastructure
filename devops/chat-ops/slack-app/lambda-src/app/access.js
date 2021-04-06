const AWS = require('aws-sdk');

const sts = new AWS.STS({ apiVersion: '2011-06-15' });

module.exports = {
  regions() {
    return ['us-east-1', 'us-east-2', 'us-west-2'];
  },
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
  /**
   * Returns a list of all AWS accounts that exist in an organization
   * @returns {Promise<AWS.Organizations.ListAccountsResponse>}
   */
  async orgAccounts() {
    // Assume a role within the Organization's management account that has
    // permission to `listAccounts`
    // This is NOT the DevOps shared access account, which exists in each account.
    // It's a different role that only exists in the management account.
    const role = await this.orgSharingRole();

    // The organizations endpoint only exists in us-east-1
    const organizations = new AWS.Organizations({
      apiVersion: '2016-11-28',
      region: 'us-east-1',
      accessKeyId: role.Credentials.AccessKeyId,
      secretAccessKey: role.Credentials.SecretAccessKey,
      sessionToken: role.Credentials.SessionToken,
    });

    const accounts = await organizations.listAccounts({}).promise();

    return accounts;
  },
};

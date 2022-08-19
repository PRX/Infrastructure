# Storage Stack

This template is used for the storage stack that both CI and CD are dependent on. Once the storage stack has been launched, the stack name can be passed to other stacks as a parameter, and specific bucket names can be imported based on predefined export identifiers.

## S3 Buckets

There are many S3 buckets used as part of the CI and CD systems that are defined within those respective CloudFormation templates, and don't need to be managed separately. A few buckets, though, must exist prior to launching any parts of this system, and must be configured correctly. The following describe each of those buckets:

### Support

Holds miscellaneous resources that are needed at various points of the setup and deployment process, such as zip files for Lambda function code used by the Notifications, CI, and CD stacks themselves.

- Exported as: `${AWS::StackName}-InfrastructureSupportBucket`
- Named: `${BucketNamePrefix}-${AWS::Region}-support`, eg `prx-infrastructure-us-east-1-support`

### Snapshots

Holds JSON files used to capture code and configuration states when deploys occur. Eg. `staging/1389173987.json`, `production/1276476413.json`. Versioning is not required.

- Exported as: `${AWS::StackName}-InfrastructureSnapshotsBucket`
- Named: `${BucketNamePrefix}-${AWS::Region}-snapshots`, eg `prx-infrastructure-us-east-1-snapshots`

### Application Code

Stores application code that will be deployed from an application stack. This is primarily used for AWS Lambda functions. Each application is given a single key, and S3 versions are used to deploy specific versions of the code by the CloudFormation application stacks. Versioning is required.

- Exported as: `${AWS::StackName}-InfrastructureApplicationCodeBucket`
- Named: `${BucketNamePrefix}-${AWS::Region}-application-code`, eg `prx-infrastructure-us-east-1-application-code`

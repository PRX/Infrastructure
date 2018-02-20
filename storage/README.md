# Storage Stack

This template is used for the storage stack that both CI and CD are dependent on.

## S3 Buckets

There are many S3 buckets used as part of the CI/CD that are defined within CloudFormation templates, and don't need to be managed separately. A few buckets, though, must exist prior to launching any parts of this system, and must be configured correctly. The following describe each of those buckets:

### Support

Holds miscellaneous resources that are needed at various points of the setup and deployment process, such as zip files for Lambda function code used by the Notifications, CI, and CD stacks themselves.

- Exported as: `${AWS::StackName}-InfrastructureSupportBucket`
- Named: `${BucketNamePrefix}-${AWS::Region}-support`, eg `prx-infrastructure-us-east-1-support`

### Source

Holds copies of the Infrastructure repository, prefixed with the Git commit hash from when the copy was made. The root stack template points to files in this bucket for nested templates. It does not need S3 versioning.

- Exported as: `${AWS::StackName}-InfrastructureSourceBucket`
- Named: `${BucketNamePrefix}-${AWS::Region}-source`, eg `prx-infrastructure-us-east-1-source`

### Config

Holds one zip file per environment, each which holds a single JSON file. Eg. `template-config-production.zip` and `template-config-staging.zip`. Versioning is required; these files are updated in place whenever the configuration changes. Versioning is used to rollback to good states.

- Exported as: `${AWS::StackName}-InfrastructureConfigBucket`
- Named: `${BucketNamePrefix}-${AWS::Region}-config`, eg `prx-infrastructure-us-east-1-config`

### Snapshots

Holds JSON files used to capture code and configuration states when deploys occur. Eg. `staging/1389173987.json`, `production/1276476413.json`. Versioning is not required.

- Exported as: `${AWS::StackName}-InfrastructureSnapshotsBucket`
- Named: `${BucketNamePrefix}-${AWS::Region}-snapshots`, eg `prx-infrastructure-us-east-1-snapshots`

### Application Code

Stores application code that will be deployed from an application stack. This is primarily used for AWS Lambda functions. Each application is given a single key, and S3 versions are used to deploy specific versions of the code by the CloudFormation application stacks. Versioning is required.

- Exported as: `${AWS::StackName}-InfrastructureApplicationCodeBucket`
- Named: `${BucketNamePrefix}-${AWS::Region}-application-code`, eg `prx-infrastructure-us-east-1-application-code`

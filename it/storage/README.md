# Storage Stack

This template is used for the storage stacks used for IT purposes

## S3 Buckets

There are many S3 buckets used as part of the CI/CD that are defined within CloudFormation templates, and don't need to be managed separately. A few buckets, though, must exist prior to launching any parts of this system, and must be configured correctly. The following describe each of those buckets:

### Confluence Archive

Stores the backup the confluence `wiki.prx.org` as xml with attachment files, and pdfs.

- Exported as: `${AWS::StackName}-`
- Named: `${BucketNamePrefix}-${AWS::Region}-support`, eg `prx-infrastructure-us-east-1-support`

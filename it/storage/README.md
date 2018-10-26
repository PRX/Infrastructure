# Storage Stack

This template is used for the storage stacks used for IT purposes.

## S3 Buckets

In IT, we often need places to organize and store backups and data files.
The following is the list of S3 buckets used for IT.

### Confluence Archive

Stores the backup the confluence `wiki.prx.org` as xml with attachment files, and pdfs.

- Exported as: `${AWS::StackName}-ConfluenceArchiveBucket`
- Named: `${BucketNamePrefix}-${AWS::Region}-confluence-archive`, e.g. `prx-infrastructure-us-east-1-confluence-archive`

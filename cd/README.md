# PRX CD

## Permissions

The CD stack includes several IAM roles, used by Lambda, CodePipeline,
CodeBuild, and CloudFormation. The Lambda and CodeBuild roles and policies are
pretty simple and straightforward.

The CodePipeline role is a bit more particular. A few things to note:

- CodePipeline needs `PutObject` for `arn:aws:s3:::codepipeline*`, even though
  that bucket is never used explicitly by the pipeline or any defined actions.
- The role needs to allow `iam:PassRole` on the CloudFormation IAM role; this
  allows CodePipeline to pass the separate CloudFormation role that's defined
  to the CloudFormation service, which is used when managing the stacks that
  get launched as a result of continuous deployment.
- The CodePipeline role itself only needs to deal with CloudFormation to the
  extent that it can launch and manage the root stacks (staging and production).
  It only needs `cloudformation:xyx` actions, and only on those root stack
  resources; **not** any of the resources that are created by the root stacks.

The CloudFormation role has some serious implications that are worth being
aware of:

- This role gets passed to the CloudFormation service by CodePipeline deploy
  actions.
- It's the role that's used by CloudFormation to create all the resources
  defined in the root stacks, and any stacks nested within the root stacks. That
  would include VPC, ECS, and application-specific resources.
- The nested stacks are launched from templates stored in S3, so this role
  needs access to that location. Any Lambda functions are also created with
  code found in S3, so this role also needs access to that location.
- Because of the nested stacks, CloudFormation will itself be touching the
  CloudFormation API to create and manage those nested stacks, and therefor
  needs some `cloudformation:xyz` permissions.
- Because this role is used for creating all the resources found in nested
  stacks, it needs permissions for all the services used by those stacks. That
  includes ECS, EC2, API Gateway, Lambda, IAM, SNS, etc. It's impractical to
  micromanage all these permissions, so generally for any AWS service that's
  used, this role is given a wildcard permission. That makes it extremely
  powerful, so it should never be used for anything else.
- In cases where this role needs very limited access to a certain API, don't
  use a wildcard; be explicit. One example is S3; CloudFormation will never
  delete an S3 bucket, even if one that it created is removed from a template.
  This role really only needs permission to `CreateBucket` and
  `PutLifecycleConfiguration`, so those are defined explicitly, rather than
  giving the role an `s3:*` policy. This may be true of other data resources
  (Redis, databases, file systems, etc), and similar care should be taken when
  granting access to those services.

### Notes

Currently, it's not possible to configure certain aspects of a CloudFormation
stack that is launched by CodePipeline when the pipeline is defined in
CloudFormation. These include tags and notification ARN's. Once the staging and
production root stacks are launched, these should be added manually. Stacks
launched *by* the root stacks (eg., the VPC stack, or the CMS stack) will have
notifications and tagging automatically.

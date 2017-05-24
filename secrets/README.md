# PRX Secrets

Works with the `aws-secrets` project (https://github.com/PRX/aws-secrets) to
provide the bucket to store secrets, and creates a lambda to watch for changes
to secrets files in that S3 bucket.

When the lambda detects a change, it determines which environment and apps are
affected, and gets the latest secrets file version IDs. It downloads and updates
the template config zip for the appropriate environment with the updated version
ID, then updates the template config zip on S3.

For a change to the staging template config on S3, this should trigger a build,
test, and deploy to staging. For a change to production, it will not.

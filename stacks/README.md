# Setup

# Misc

- The Augury stack currently assumes that the bucket referenced in AdFilesS3BucketArn is in the same region where Augury tasks are being launched
- After the Castle DB is created, a user needs to be created

## Amazon SES

All necessary Amazon SES identities (i.e., domains that apps and services will be sending mail from) must be set up before the stacks are created.

## External Dependencies

Resources that depend on external databases, such as ECS tasks, must be conditional on the database being available. Because of the order of operations when spinning up a new region (i.e., stack is launched to create the VPC, database is created in the VPC, applications can be launched using the database), it must be possible to launch the stack without the database.

The root stack parameters for database endpoints are used as the flag for when the database is available. If the endpoint is not defined, the dependant services should be disabled. This could be done with conditional template resources, or, for example, setting the desired task count of an ECS service to `0`. Conditional template resources is generally advised.

## TLS Certificates

- There will be some ACM certificates created that need DNS records created during setup. Easiest to watch the ASM Console and use the button to add the records to Route 53 for utility prx.tech records. For more permanent records (*.prx.org, etc), you should generate and install those records ahead of time.

## Elasticsearch Service-linked Role

- Before an Elasticsearch domain can be created via CloudFormation, the service-linked role for Elasticsearch must be created elsewhere. The easiest way I've found to do this is create a ES domain via Console. You can delete it before it even finishes launching, and the role will continue to exist. This needs to be done once for each region.

# Tear Down

- Redis and Memcached clusters can take 5-20 minutes to delete
- ASG can take a while to delete. You can help it along my detaching instances, just make sure you delete them yourself afterwards, or scale down to 0 beforehand
- There are a number of S3 buckets that get created and will be maintained
- The shared VPC subnets, IPv6 CIDR block, and the VPC itself are all retained and should be cleaned up manually

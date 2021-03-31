# Tear Down

- Redis and Memcached clusters can take 5-20 minutes to delete
- ASG can take a while to delete. You can help it along my detaching instances, just make sure you delete them yourself afterwards
- There are a number of S3 buckets that get created and will be maintained
- Be sure to unpeer the shared VPC completely before attempting to delete
- The shared VPC subnets, IPv6 CIDR block, and the VPC itself are all retained and should be cleaned up manually

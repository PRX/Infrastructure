# Setup

## VPC Peerings

- After the shared VPC has been created, but before the application stacks are created, the shared VPC needs to get peered with all external VPCs that the apps depend on, such as those containing databases. Only enable application stack creation once you have confirmed that VPC peering is established and configured correctly, including DNS resolution options.
- Ensure that NACLs and security groups for the external resource allow traffic from the application instances and tasks.
- VPC peering needs to happen for both the public and private route tables (I think).
- It doesn't matter which side is the accepter or requester.
- The "DNS resolution from accepter/requester VPC to private IP" needs to be **Enabled** for the database side of the peering connection, regardless of if it's the accepter or requester. (This allows apps to query the public hostnames of databases/etc, and have those resolve to the private IPs that are routed over the peering connection.)

## TLS Certificates

- There will be some ACM certificates created that need DNS records created during setup. Easiest to watch the ASM Console and use the button to add the records to Route 53 for utility prx.tech records. For more permanent records (*.prx.org, etc), you should generate and install those records ahead of time.

## Elasticsearch Service-linked Role

- Before an Elasticsearch domain can be created via CloudFormation, the service-linked role for Elasticsearch must be created elsewhere. The easiest way I've found to do this is create a ES domain via Console. You can delete it before it even finishes launching, and the role will continue to exist.

# Tear Down

- Redis and Memcached clusters can take 5-20 minutes to delete
- ASG can take a while to delete. You can help it along my detaching instances, just make sure you delete them yourself afterwards, or scale down to 0 beforehand
- There are a number of S3 buckets that get created and will be maintained
- Be sure to unpeer the shared VPC completely before attempting to delete
- The shared VPC subnets, IPv6 CIDR block, and the VPC itself are all retained and should be cleaned up manually

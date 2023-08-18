# VPC DevOps

## Service-specific NACL rules

Both our public and private network ACLs include some rules with very wide port ranges (such as `1024` to `65535`), in order to support normal operating traffic. The ranges will likely include specific ports that we use for particular services, such as port `3306` for Aurora databases.

It is a best practice to create rules for all necesary ports or port ranges, even if an existing rule would satisfy the need. This makes the traffic patterns of the network more clear. It also reduces the risk of network connectivity issues if a rule changes and it's not obvious that the rule was being used for multiple purposes. For example, if the `1024-65535` rule were removed at some point because it were no longer needed, without an explicit `3306` rule, Aurora databases would break. With both rules, even though they may overlap, future changes are unlikey to cause disruptions.

## Subnet CIDR range selection

The `AWS::EC2::Subnet` resources use CloudFormation functions to determine their CIDR ranges, e.g., `!Select [0, !Cidr [!Ref VpcCidrBlock, 16, 12]]`

- The 12 indicates the subnet mask (32 - 12 = 20 = /20)
- The 16 is a somewhat arbitrary value that tells the Cidr function how big a list of ranges to create. It only needs to be as big as necessary to provide the value being selected, but for consistency it is always set to 16, to match the total number of /20 subnets we could make in the /16 network.
- The 0 is zero-based index used to select a specific range from the 16 returned by the function. At any given time, only one subnet should be using each value. If two subnets are selecting item 0, they will be selecting the same CIDR range, creating a conflict that AWS will not allow. How the CIDR ranges are applied to each subnet is largely immaterial, as long as there's no overlap. This is a value from 0 to 15.
- The 12 and 16 should not change unless the sizing of the entire network needs to change.
- For convenience, the selection index and the list size used for the IPv6 CIDR block functions match the IPv4 functions, but with /64 masks. When changing the CIDR range of either IPv4 or IPv6, always change both.

## AZ and CIDR block migration

After several attempts to come up with a reliable procedure for replacing subnets in a single update (i.e., making a change to a `AWS::EC2::Subnet` that requires replacement), the whole thing seems fraught. Having never tried this, I think the better option is to create new subnets along side the ones you're looking to replace, and sometime later tear down the old ones.

This procedure has yet to be tested:

1. In one stack update, create the new subnets by creating clones of the `PublicSubnetsStack` and `PrivateSubnetsStack` in `shared-vpc.yml`, and their templates. Be sure to change the CIDR blocks or AZs as necessary in the clones. Don't make any other changes in this stack update.
2. In a subsequent stack update, change any references in `shared-vpc.yml` to `PublicSubnetsStack` or `PrivateSubnetsStack` to the new cloned stacks, including the `Outputs` of `shared-vpc.yml`.
3. Some time later, after EC2 instances or anything else that may have been associated with the original subnets has had time to cycle out, use the VPC Console to confirm that all the original subnets _could_ be deleted. **Do not delete them via the Console.** Only use the console to see if there are any instances, ENIs, etc still bound to them.
4. If all the original subnets are free to be deleted, remove the original `PublicSubnetsStack` and `PrivateSubnetsStack` to tear down the subnets.

## Changing a subnet's AZs or CIDR block

If it becomes necessary to alter the AZ or CIDR block of one or more subnets, be aware that any changes to the AZ, or IPv4 or IPv6 CIDR blocks of a `AWS::EC2::Subnet` resource will require a replacement. These properties of an existing subnet cannot be updated. This means, for example, if you want to change a subnet from `us-east-1a` to `us-east-1b` but don't necessarily need the CIDR block to change, you cannot only change the AZ. Doing so would cause CloudFormation to try to create a replacment subnet (prior to deleting the existing subnet), and they would have overlapping (in this case, identical) CIDR ranges.

In order to change a subnet's AZ, you must always also change both the IPv4 and IPv6 CIDR blocks to blocks that are not in use. This is also true when you do specifically want to change the CIDR block of a subnet, regardless of the AZ changing (but you can chooes a new CIDR block without changing the AZ).

Please **take extreme caution** when making changes that replace subnets, and understand fully how the replacement will effect other resources, such as EC2 instances that exist in the subnets being replaced.

## CloudFormation `DELETE_FAILED`
If a change is made, such as altering the CIDR block of an `AWS::EC2::Subnet` resource, which requires a replacement, it is possible for CloudFormation to get hung up. This is often because of the subnet that is being replaced remaining associated with something that CloudFormation did not or could not update to the new, replacement subnet. Because this is a failure during the `UPDATE_COMPLETE_CLEANUP_IN_PROGRESS` phase of the stack, it will not provoke a rollback. CloudFormation will attempt to delete the subnet, but will fail with a `DependencyViolation` error. It will attempt to delete the subnet several time. Each attempt can take up to 20 minutes to complete. After some number of attempts, CloudFormation will give up trying to complete the deletion, and the stack will move to an `UPDATE_COMPLETE` state. Do not attempt to cancel the stack update of the stack containing the VPC, or any parent stacks before this process completes. Do not attempt to delete the subnet manually before the stack moves to `UPDATE_COMPLETE`.

At this point, the CloudFormation stacks will be in a normal state, ready for future updates. The subnet that failed to delete will no longer be associated with or tracked by the CloudFormation stack, but it ***will still exist***. There is likely some other resource still associated with the now-defunct subnet. You should immediately identify the subnet that failed to delete, and any resources that are still associated with it that are blocking its deletion. If the associated resources are managed by the same CloudFormation stack as the subnet, you should determine why the association was not correctly changed to the new subnet during the update and resolve that issues (something may need an explicit `DependsOn` to ensure updates happen in the correct order). If the resource is not managed by the same stack, you should find a new subnet to associate it with that is **not** the newly-created subnet in the stack; doing so would lead to this problem again in the future.

If you were updating multiple subnets in a single stack update, you should repeat this process for each defunct subnet.

If you have reason to believe a stack update involing subnet replacements will run into this issue, you should apply an `UpdateReplacePolicy: Retain` policy to any `AWS::EC2::Subnet` resources being updated. You **must** apply this policy to the resources in an update _before_ the update that triggers the replacement (i.e., one stack update the add the policy, a subsequent update to change the CIDR block). This policy will force CloudFormation to skip the deletion of the old subnet, avoiding the `DependencyViolation` error. Any remnant subnets that are retained in this way should still be cleaned up manually immediately after the stack update. Otherwise, the CloudFormation-managed VPC will include subnets that are unmanged, and consume IP ranges that aren't represented anywhere in a CloudFormation stack. The defunct subnet should be deleted as soon as any associated resources have been moved to different subnets.

## Availability Zone Selector

The `AvailabilityZoneSelectorService` custom CloudFormation resource provides a list of availability zones that have been chosen to be used in the region the stack is operating in. There are certain AZs that should not be used (such as `use1-az3`, which has a limited set of EC2 instance families), so this resource provides a list of approved AZs. The resource takes no properties, other than the `ServiceToken`.

Once the custom resource has been added to a template, the values can be referenced:

`!Select [0, !GetAtt AvailabilityZoneSelectorService.ZoneNames]`

That will return a value like `us-east-1a`. `ZoneNames` always returns a list sorted alphabetically by zone name (`[us-east-1a, us-east-1b, us-east-1d…]`), but there may be gaps in the list if certain AZs have been disallowed. AZs are disallowed based on their zone ID, not their zone name, so different accounts may return different lists of zone names for the same region, even though they are returning the same underlying availability zones.

`!GetAtt AvailabilityZoneSelectorService.Count` will return the number of distinct AZs that are allowed for the current region.

The list that `!GetAtt AvailabilityZoneSelectorService.ZoneNames` returns will always include more entries than the `Count`. This is because each AZ is included in the list more than once. For example, if the approved AZs for a region are `us-south-2c` and `us-south-2g`, the `ZoneNames` list will look something like `[us-south-2c, us-south-2g, us-south-2c, us-south-2g, us-south-2c, us-south-2g]`.

If the `AvailabilityZoneSelectorService` returns more than 0 AZs, it is guaranteed to return at least two distinct AZs. The list is guaranteed to return at least six entries. This allows for writing templates that can safely create a number of subnets greater than the number of allowed AZs in a region.

For example, `us-east-1` may have five allowed AZs, so subnets can be created using items `0`, `1`, and `4` from the list, which will be result in subnets in three distinct AZs. `us-south-2` may only may two allowed AZs, but the same template could be used since the `ZoneNames` list guarantees at least six entries. In this case, there would be three subnets across two distinct AZs, since items `0` and `4` in the list reference the same AZ. **Be aware of this when determining the durability needs of services within a region.** Be sure that the actual number of distinct AZs being allowed are sufficient for your needs.

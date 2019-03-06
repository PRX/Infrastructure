# Infrastructure
Templates and assets used to launch and manage many aspects of PRX's applications and services.

The Infrastructure project itself contains many independent or related-but-separate projects and assets. It is the home for all work that helps PRX adhere to an _[infrastructure](https://docs.microsoft.com/en-us/azure/devops/learn/what-is-infrastructure-as-code) [as](http://infrastructure-as-code.com/) [code](https://www.thoughtworks.com/insights/blog/infrastructure-code-reason-smile)_ philosophy. The goal is to describe the various AWS resources (and their associated configurations) needed to run a multitude of applications, servers, and services using code and templates.

All aspects of Infrastructure largely rely on [AWS CloudFormation](https://aws.amazon.com/cloudformation/).

Applications, as well as the systems designed to test and deploy those applications, are described using CloudFormation templates. Collectively the systems used to facilitate application deployment and the infrastructure necessary to support them are referred to as **CI/CD**. There are a number of other aspects of our AWS architecture that do not fall under that umbrella but are also maintained as part of the Infrastructure project. This includes things like DNS records for hosted zones and CDN distributions.

## CI/CD

Together, the [CI](https://github.com/PRX/Infrastructure/tree/master/ci) and [CD](https://github.com/PRX/Infrastructure/tree/master/cd) systems support continuous integration and continuous delivery and deployment. They are independent systems, but are designed to work in close coordination. CI/CD require a pre-existing [storage](https://github.com/PRX/Infrastructure/tree/master/storage) and [notification](https://github.com/PRX/Infrastructure/tree/master/notifications) stack to exist before either can be launched from their templates.

There is a draw.io file (`System Diagram.xml`) that gives a good overview of how many of the main pieces of the CI and CD systems fit together.

### Destruction

If you want to remove things created by Infrastructure for CI/CD, do so in this order:

- Delete CI stack
- Delete production root stack
- Delete staging root stack
- Delete CD stack
- Delete Notifications stack
- Delete Storage stack
- Delete CD pipeline artifacts store bucket (`cd-artifactstore-...`)
- Delete CD pipeline CloudTrail storage bucket (`cd-CdPipelineS3TriggerTrailStore-...`)
- Delete CI CodeBuild source bucket (`ci-cicodebuildsourcearchivebucket-...`)
- Delete the five buckets created by the Storage stack

## Other Resources

Files found in `cd/`, `ci/`, `notifications/`, `secrets/`, `stacks/` and `storage/` fall under the umbrella of CI/CD. Other types of resources, such as CloudFront distributions and DNS records, can also be found in this project.

- `dns/` – DNS hosted zones and records
- `cdn/` – CDN configurations (such as through [Amazon CloudFront](https://aws.amazon.com/cloudfront/))
- `db/` – Databases and data stores (e.g., [Amazon RDS](https://aws.amazon.com/rds/) and [Amazon ElastiCache](https://aws.amazon.com/elasticache/))
- `etc/` – Misc. standalone stacks
- `utility/` - Scripts and Lambda functions that help with other parts of Infrastructure

### Notable Resources

**Root account activity monitor** – Uses [AWS CloudTrail](https://aws.amazon.com/cloudtrail/) to monitor AWS accounts for any activity from a root account. This stack should be launched in any AWS account in the PRX organization.

**Cross account VPC peering** – When resources in different AWS accounts need to be able to route traffic wihout going over the internet, VPCs can be peered to create a connection. Using the _requester_ and _accepter_ peering templates, such a connection can be established.

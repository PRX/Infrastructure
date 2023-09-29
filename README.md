# Infrastructure
Templates and assets used to launch and manage many aspects of PRX's applications and services.

The Infrastructure project itself contains many independent or related-but-separate projects and assets. It is the home for any work that helps PRX adhere to an _[infrastructure](https://docs.microsoft.com/en-us/azure/devops/learn/what-is-infrastructure-as-code) [as](http://infrastructure-as-code.com/) [code](https://www.thoughtworks.com/insights/blog/infrastructure-code-reason-smile)_ philosophy. The goal is to describe the various AWS resources (and their associated configurations) needed to run a multitude of applications, servers, and services using code and templates.

All aspects of Infrastructure largely rely on [AWS CloudFormation](https://aws.amazon.com/cloudformation/).

Applications, as well as the systems designed to test and deploy those applications, are described using CloudFormation templates. Collectively the systems used to facilitate application deployment and the infrastructure necessary to support them are referred to as **CI/CD**. There are a number of other aspects of our AWS architecture that do not fall under that umbrella but are also maintained as part of the Infrastructure project. This includes things like DNS records for hosted zones and CDN distributions.

## CI/CD

Together, the [CI](https://github.com/PRX/Infrastructure/tree/main/ci) and [CD](https://github.com/PRX/Infrastructure/tree/main/cd) systems support continuous integration and continuous delivery and deployment. They are independent systems, but are designed to work in close coordination. CI/CD require a pre-existing [storage](https://github.com/PRX/Infrastructure/tree/main/storage) and [notification](https://github.com/PRX/Infrastructure/tree/main/notifications) stack to exist before either can be launched from their templates.

There is a draw.io file (`System Diagram.xml`) that gives a good overview of how many of the main pieces of the CI and CD systems fit together.

### Destruction

If you want to remove things created by Infrastructure for CI/CD, do so in this order:

- Delete CI stack
- Delete production root stack
- Delete staging root stack
- Delete CD stack
- Delete Storage stack
- Delete CD pipeline artifacts store bucket (`cd-artifactstore-...`)
- Delete CD pipeline CloudTrail storage bucket (`cd-CdPipelineS3TriggerTrailStore-...`)
- Delete CI CodeBuild source bucket (`ci-cicodebuildsourcearchivebucket-...`)
- Delete the five buckets created by the Storage stack

## Other Resources

Files found in `cd/`, `ci/`, and `storage/` fall under the umbrella of CI/CD. Other types of resources, such as CloudFront distributions and DNS records, can also be found in this project.

- `dns/` – DNS hosted zones and records
- `cdn/` – CDN configurations (such as through [Amazon CloudFront](https://aws.amazon.com/cloudfront/))
- `db/` – Databases and data stores (e.g., [Amazon RDS](https://aws.amazon.com/rds/) and [Amazon ElastiCache](https://aws.amazon.com/elasticache/))
- `etc/` – Misc. standalone stacks
- `utility/` - Scripts and Lambda functions that help with other parts of Infrastructure

### GitHub Actions

The `.github/workflows` directory contains files that describe automated processes that are run as [GitHub Action](https://docs.github.com/en/actions) under certain conditions (e.g., a specific file is updated). These workflows are meant to operate in coordination with various processes deployed into AWS. For example, the CI system is continuously deployed using a GitHub action. Some DNS hosted zones are also continuously deployed using GitHub actions.

Highly integrated processes and pipelines (for example, where CloudFormation, CodeBuild, CodePipeline, Lambda, etc are all working together) should not be created as GitHub Actions. GitHub Actions should only be used for very simple workflows, or in cases where there's no reasonable way to accomplish something using AWS primatives (such as deploying a CloudFormation stack that deploys another deployment process). A CodePipeline that would end up being a single action may be a good candidate for GitHub actions.

GitHub Actions also have greater visibility into commit-level events than CodePipeline source actions. If there is a pipeline that only needs to run when certain files or directories are altered, it can be beneficial to create a GitHub Action to start the execution of that pipeline using a detailed `on` condition, rather than having the pipeline start for all commits made to this repository.

# DNS

Hosted zones, as well as some DNS records and other resources maintained with [Route 53](https://aws.amazon.com/route53/) are, by design, not managed through CD. These templates are intended to be deployed and updated manually.

In some cases (like potentially with `prx.tech`), the hosted zone and some DNS records may be handled manually through these templates, and other DNS records could be added from elsewhere, even from a template the _is_ managed through CD.

## TODO

- [ ] All, or parts, of the deployment process for these templates and their associated stacks could be improved by building some command line tools

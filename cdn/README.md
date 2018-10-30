# CDN

The `single-origin.yml` template is a very generic template that exposes many of the standard CloudFront distribution settings as stack parameters. This template is good for most basic web or media CDNs (with S3 or HTTP origins) that don't require any Lambda@Edge functions. If you are launching a basic distribution that requires CloudFront configuration not currently exposed by the template, try adding support to `single-origin.yml` before creating a new template.

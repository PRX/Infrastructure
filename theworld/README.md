## Domains

Public website traffic is handled by a CloudFront distribution.
- Prod: `theworld.org, www.theworld.org, prod.theworld.org`
- Stag: `stag.theworld.org`

---

The frontend CloudFront distribution uses an ALB as its origin. Frontend traffic going through this ALB is routed to ECS tasks running Next.js.
- Prod: `frontend.theworld.org, frontend.prod.theworld.org`
- Stag: `frontend.stag.theworld.org`

(The CDN always uses `frontend.<env>.theworld.org`)

This ALB will only handle frontend traffic if it includes a `x-prx-alb-access-token` header with the correct value ([prod](https://aws.prx.tech/#/console?account_id=976680550710&role_name=AdministratorAccess&destination=https%3A%2F%2Fus-east-1.console.aws.amazon.com%2Fsystems-manager%2Fparameters%2F%25252Fprx%25252Fprod%25252FTerra%25252FThe_World-Frontend%25252Falb-access-token%2Fdescription%3Fregion%3Dus-east-1%26tab%3DTable%23list_parameter_filters%3DName%3AContains%3Aalb) | [stag](https://aws.prx.tech/#/console?account_id=976680550710&role_name=AdministratorAccess&destination=https%3A%2F%2Fus-east-1.console.aws.amazon.com%2Fsystems-manager%2Fparameters%2F%25252Fprx%25252Fstag%25252FTerra%25252FThe_World-Frontend%25252Falb-access-token%2Fdescription%3Fregion%3Dus-east-1%26tab%3DTable%23list_parameter_filters%3DName%3AContains%3Aalb)). The frontend CDN is configured to include that header in all origin requests it makes. If you need to hit the frontend web server directly (i.e., not through the CDN), you must include that header (e.g., `curl -H "x-prx-alb-access-token: aaaaabbbbbccccc" "https://frontend.prod.theworld.org/about"`)

---

API/admin/etc traffic is handled by a different CloudFront distribution (not the same as the public frontend).
- Prod: `admin.theworld.org, admin.prod.theworld.org, api.theworld.org, api.prod.theworld.org, feed.theworld.org, feeds.prod.theworld.org, projects.theworld.org, projects.prod.theworld.org, sitemap.theworld.org, sitemap.prod.theworld.org`
- Stag: `admin.stag.theworld.org, api.stag.theworld.org, feeds.stag.theworld.org, projects.stag.theworld.org, sitemap.stag.theworld.org`

The `host` header of the viewer request made to the CDN is passed through as part of the origin requests the CDN is making.

---

The backend CloudFront distribution uses an ALB as its origin. This is the same ALB that handles frontend traffic. Backend traffic going through this ALB is routed to ECS tasks running WordPress.
- Prod: `wordpress.theworld.org, wordpress.prod.theworld.org`
- Stag: `wordpress.stag.theworld.org`

(The CDN always uses `wordpress.<env>.theworld.org`)

This ALB will only handle backend traffic if it includes a `x-prx-alb-access-token` header with the correct value ([prod](https://aws.prx.tech/#/console?account_id=976680550710&role_name=AdministratorAccess&destination=https%3A%2F%2Fus-east-1.console.aws.amazon.com%2Fsystems-manager%2Fparameters%2F%25252Fprx%25252Fprod%25252FTerra%25252FThe_World-WordPress%25252Falb-access-token%2Fdescription%3Fregion%3Dus-east-1%26tab%3DTable%23list_parameter_filters%3DName%3AContains%3Aalb) | [stag](https://aws.prx.tech/#/console?account_id=976680550710&role_name=AdministratorAccess&destination=https%3A%2F%2Fus-east-1.console.aws.amazon.com%2Fsystems-manager%2Fparameters%2F%25252Fprx%25252Fstag%25252FTerra%25252FThe_World-WordPress%25252Falb-access-token%2Fdescription%3Fregion%3Dus-east-1%26tab%3DTable%23list_parameter_filters%3DName%3AContains%3Aalb)). The backend CDN is configured to include that header in all origin requests it makes. If you need to hit the backend WordPress server directly (i.e., not through the CDN), you must include that header (e.g., `curl -H "x-prx-alb-access-token: xxxxxyyyyyzzzzz" "https://wordpress.prod.theworld.org/wp-admin"`)

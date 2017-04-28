## Bootstrapping a CodeBuild

The `bootstrap.sh` script can run tests and push-to-ECR any PRX app, using AWS
CodeBuild.

Just set up an entrypoint in CodeBuild that will:

```
curl -sO https://raw.githubusercontent.com/PRX/Infrastructure/master/codebuild/bootstrap.sh && sh bootstrap.sh
```

### Inputs

- Codebuild ENVs:
  - `PRX_SNS_CALLBACK` - an SNS topic for callbacks.
  - `PRX_REPO` - the repo this is for.  Not actually used in this script, but passed back to SNS.
  - `PRX_COMMIT` - the 7-char SHA of the commit this is for. Not used, but passed back to SNS.
  - `PRX_GITHUB_PR` - optional github pull request number.
  - `PRX_ECR_TAG` - optional param telling codebuild to push to this ECR tag after successfully testing. Will only be used if there is a Dockerfile present.
  - `PRX_ECR_REGION` - required if you set `PRX_ECR_TAG`
- Repo setup:
  - Must have a `.prxci` file in the root.  This is just a plain text file, with 1 command to run per line.  Does any setup for the tests, and runs them.
  - For docker projects, the Dockerfile must have `LABEL org.prx.app="yes"` in it.  This tells codebuild which image to push to ECR (in case your docker-compose is building multiple).

### SNS Callback

- Will publish an SNS json object with the following keys:
  - `success` - boolean true or false, indicating if `.prxci` passed, and optionally if pushing to ECR worked.
  - `reason` - string message if success = false.
  - `prxRepo` - the repo you passed in.
  - `prxCommit` - the commit you passed in.
  - `prxGithubPr` - the pull request number you passed in.
  - `prxEcrTag` - the ecr tag you passed in.
  - `prxEcrRegion` - the ecr region you passed in.
  - `buildArn` - the ARN of this codebuild run.

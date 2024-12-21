// const github = require('./github');
import { compareCommits } from './github.mjs';
import regions from './regions.mjs';

function deepLink(accountId, url) {
  const deepLinkRoleName = 'AdministratorAccess';

  const urlEncodedUrl = encodeURIComponent(url);
  return `https://d-906713e952.awsapps.com/start/#/console?account_id=${accountId}&role_name=${deepLinkRoleName}&destination=${urlEncodedUrl}`;
}

function codebuildUrl(event) {
  const region = event.region;
  const accountId = event.account;
  const project = event.detail['project-name'];
  const uuid = event.detail['build-id'].split('/')[1].split(':')[1];

  const codeBuildUrl = `https://${region}.console.aws.amazon.com/codesuite/codebuild/${accountId}/projects/${project}/build/${project}%3A${uuid}?region=${region}`;

  return deepLink(accountId, codeBuildUrl);
}

export async function statusBlocks(event) {
  const blox = [];

  const info = event.detail['additional-information'];

  const envVars = info.environment['environment-variables'];
  const exportedEnvVars = info['exported-environment-variables'] || [];

  // Combine all envionment variables into a single key-value object (rather
  // than multiple arrays of objects)
  const allEnvVars = [...envVars, ...exportedEnvVars].reduce(
    (acc, cur) => ({ ...acc, [cur.name]: cur.value }),
    {},
  );

  const ownerAndRepo = allEnvVars.PRX_REPO;
  const sha = allEnvVars.PRX_COMMIT;
  const sha7 = sha.substring(0, 7);
  const branch = allEnvVars.PRX_BRANCH;
  const pr = allEnvVars.PRX_GITHUB_PR;
  const codeBucket = allEnvVars.PRX_APPLICATION_CODE_BUCKET;
  const targetArch = allEnvVars.PRX_TARGET_ARCHITECTURE;

  const verb = {
    IN_PROGRESS: 'Building',
    SUCCEEDED: 'Built',
    FAILED: 'Failed to build',
    STOPPED: 'Stopped building',
  };

  // e.g.,
  // Building PRX/Infrastructure main branch with commit be8e83b
  // Built PRX/Infrastructure main branch with commit 674811e
  // Building PRX/Infrastructure #582 with commit 26fad6b
  const regionNickname = regions(process.env.AWS_REGION);
  const line1 = [
    `${regionNickname} » <${codebuildUrl(event)}|${
      verb[event.detail['build-status']]
    }>`,
    targetArch,
    ownerAndRepo,
    pr
      ? `<https://github.com/${ownerAndRepo}/pull/${pr}|#${pr}>`
      : `\`${branch}\` branch`,
    `with commit <https://github.com/${ownerAndRepo}/commit/${sha}|${sha7}>`,
  ];

  // TODO
  // For IN PROGRESS pushes, include the pushed commits
  // For PRs include the title and action (ready_for_review, etc)

  let moreLines = [];

  // For builds with ECR artifacts, link to the images in ECR
  if (allEnvVars.PRX_SPIRE_ECR_PKG_PARAMETERS) {
    // raw will be like:
    // "MY_APP=/ssm/parameter/path", or
    // "MY_APP=/ssm/parameter/path;APP_TWO=/some/path"
    const raw = allEnvVars.PRX_SPIRE_ECR_PKG_PARAMETERS;
    const labeledPaths = raw.split(';');

    // For each label=parameter(s) entry, get the envar that matches the
    // label, whose value will be a Docker image+tag
    for (const labeledPath of labeledPaths) {
      // labeledPath will be like:
      // "MY_APP=/ssm/parameter/path", or
      // "MY_APP=/ssm/parameter/path,/another/ssm/path"
      const parts = labeledPath.split('=');

      if (parts.length === 2) {
        // e.g., "MY_APP"
        const imageEnvarName = parts[0];
        // allEnvVars will have a key-value pair like:
        // { MY_APP: "github/prx/my-app:165df6a5fd675dcf67" }
        // imageName will be like:
        //      "github/prx/my-app:165df6a5fd675dcf67"
        //      "github/prx/my-app:release-165df6a5fd675dcf67"
        //      "github/prx/my-app:release-165df6a5fd675dcf67-aarch64"
        const imageName = allEnvVars[imageEnvarName];

        // For builds that don't publish an image to ECR, this value won't
        // exist
        if (imageName) {
          const region = event.region;
          const accountId = event.account;
          // The ECR repository name, like:
          // github/prx/my-app
          const repoName = imageName.split(':')[0];
          // The image tag (truncated), like
          // 165df6a
          const tag = imageName
            .match(/:([a-z\-]+)?([a-f0-9]+)(-[a-z0-9_]+)?$/)[2]
            .substring(0, 7);

          const ecrUrl = `https://${region}.console.aws.amazon.com/ecr/repositories/private/${accountId}/${repoName}?region=${region}`;
          const deepEcrUrl = deepLink(accountId, ecrUrl);

          moreLines.push(
            `» Docker image pushed to <${deepEcrUrl}|ECR> with tag \`${tag}…\``,
          );
        }
      }
    }
  }

  // For builds with S3 artifacts, link to the objects in S3
  if (allEnvVars.PRX_SPIRE_S3_PKG_PARAMETERS) {
    // raw will be like:
    // "MY_APP=/ssm/parameter/path", or
    // "MY_APP=/ssm/parameter/path;APP_TWO=/some/path"
    const raw = allEnvVars.PRX_SPIRE_S3_PKG_PARAMETERS;
    const labeledPaths = raw.split(';');

    // For each label=parameter(s) entry, get the envar that matches the
    // label, whose value will be an S3 object name
    for (const labeledPath of labeledPaths) {
      // labeledPath will be like:
      // "MY_APP=/ssm/parameter/path", or
      // "MY_APP=/ssm/parameter/path,/another/ssm/path"
      const parts = labeledPath.split('=');

      if (parts.length === 2) {
        // e.g., "MY_APP"
        const objectEnvarName = parts[0];
        const objectKey = allEnvVars[objectEnvarName];

        // For builds that don't publish an object to S3, this value won't
        // exist
        if (objectKey) {
          const region = event.region;
          const accountId = event.account;

          const s3url = `https://${region}.console.aws.amazon.com/s3/object/${codeBucket}?region=${region}&prefix=${objectKey}`;
          const deepS3Url = deepLink(accountId, s3url);

          moreLines.push(
            `» Code package pushed to <${deepS3Url}|S3> bucket \`${codeBucket}\``,
          );
        }
      }
    }
  }

  // For default branch pushes, include a list of commits
  if (!pr) {
    const beforeSha = allEnvVars['PRX_GITHUB_BEFORE'];
    const afterSha = allEnvVars['PRX_GITHUB_AFTER'];
    const resp = await compareCommits(ownerAndRepo, beforeSha, afterSha);

    if (resp?.commits?.length > 0) {
      resp.commits.forEach((c) => {
        const commitUrl = `https://github.com/${ownerAndRepo}/commit/${c.sha}`;
        const commitSha = c.sha.substring(0, 7);
        const msg = c.commit.message;
        moreLines.push(
          `> \`<${commitUrl}|${commitSha}>\` ${c.author.login}: ${msg}`,
        );
      });
    }
  }

  // Include info about how the merge will happen for PRs and basic details
  // about the PR
  if (pr) {
    const prTitle = allEnvVars.PRX_GITHUB_PR_TITLE;
    const prBaseBranch = allEnvVars.PRX_GITHUB_PR_BASE_BRANCH;
    const prAuthor = allEnvVars.PRX_GITHUB_PR_AUTHOR;
    const prAction = allEnvVars.PRX_GITHUB_ACTION;

    line1.push(`(${prAction})`);

    moreLines.push(`> ${prAuthor}: ${prTitle}`);
    moreLines.push(
      `Will merge commits from \`${branch}\` into \`${prBaseBranch}\``,
    );
  }

  let text = [`*${line1.join(' ')}*`, moreLines.join('\n')].join('\n');

  // If the total text length is greater than 3000, remove links to try to
  // get below the limit
  if (text.length > 3000) {
    text = text.replace(/<.+?\|(.+?)>/g, '$1');
  }

  // If the text is still too long, brute force it down to 3000 characters
  if (text.length > 3000) {
    text = text.substring(0, 3000);
  }

  blox.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text,
    },
  });

  return blox;
}

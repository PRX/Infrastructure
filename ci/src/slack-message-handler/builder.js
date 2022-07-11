const github = require('./github');

function codebuildUrl(event) {
  const region = event.region;
  const account = event.account;
  const project = event.detail['project-name'];
  const uuid = event.detail['build-id'].split('/')[1].split(':')[1];

  return `https://console.aws.amazon.com/codesuite/codebuild/${account}/projects/${project}/build/${project}%3A${uuid}?region=${region}`;
}

module.exports = {
  async blocks(event) {
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
    const line1 = [
      `<${codebuildUrl(event)}|${verb[event.detail['build-status']]}>`,
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

    // For builds with ECR artifacts, link to the image in ECR
    if (allEnvVars.PRX_ECR_IMAGE) {
      const imageName = allEnvVars.PRX_ECR_IMAGE;

      const region = imageName.match(/dkr\.ecr\.(.*)\.amazonaws\.com/)[1];
      const accountId = imageName.match(/^([0-9]+)\./)[1];
      const repoName = imageName.match(/\/([^:]+):/)[1];
      const tag = imageName.match(/:([a-f0-9]+)$/)[1].substring(0, 7);

      const ecrUrl = `https://console.aws.amazon.com/ecr/repositories/private/${accountId}/${repoName}?region=${region}`;
      moreLines.push(
        `» Docker image pushed to <${ecrUrl}|ECR> with tag \`${tag}…\``,
      );
    }

    // For builds with Lambda artifacts, link to the S3 object
    if (allEnvVars.PRX_LAMBDA_CODE_CONFIG_VALUE) {
      const objectKey = allEnvVars.PRX_LAMBDA_CODE_CONFIG_VALUE;

      const s3url = `https://s3.console.aws.amazon.com/s3/object/${codeBucket}?region=us-east-1&prefix=${objectKey}`;
      moreLines.push(
        `» Lambda code pushed to <${s3url}|S3> bucket \`${codeBucket}\``,
      );
    }

    // For builds with static site artifacts, link to the S3 object
    if (allEnvVars.PRX_S3_STATIC_CONFIG_VALUE) {
      const objectKey = allEnvVars.PRX_S3_STATIC_CONFIG_VALUE;

      const s3url = `https://s3.console.aws.amazon.com/s3/object/${codeBucket}?region=us-east-1&prefix=${objectKey}`;
      moreLines.push(
        `» Static code pushed to <${s3url}|S3> bucket \`${codeBucket}\``,
      );
    }

    // For default branch pushes, include a list of commits
    if (!pr) {
      const beforeSha = allEnvVars['PRX_GITHUB_BEFORE'];
      const afterSha = allEnvVars['PRX_GITHUB_AFTER'];
      const resp = await github.compare(ownerAndRepo, beforeSha, afterSha);

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
  },
};

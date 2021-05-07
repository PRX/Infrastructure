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

    const moreLines = [];

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

    if (allEnvVars.PRX_LAMBDA_CODE_CONFIG_VALUE) {
      const objectKey = allEnvVars.PRX_LAMBDA_CODE_CONFIG_VALUE;

      const s3url = `https://s3.console.aws.amazon.com/s3/object/${codeBucket}?region=us-east-1&prefix=${objectKey}`;
      moreLines.push(
        `» Lambda code pushed to <${s3url}|S3> bucket \`${codeBucket}\``,
      );
    }

    if (allEnvVars.PRX_S3_STATIC_CONFIG_VALUE) {
      const objectKey = allEnvVars.PRX_S3_STATIC_CONFIG_VALUE;

      const s3url = `https://s3.console.aws.amazon.com/s3/object/${codeBucket}?region=us-east-1&prefix=${objectKey}`;
      moreLines.push(
        `» Static code pushed to <${s3url}|S3> bucket \`${codeBucket}\``,
      );
    }

    if (pr) {
      const prTitle = allEnvVars.PRX_GITHUB_PR_TITLE;
      const prBaseBranch = allEnvVars.PRX_GITHUB_PR_BASE_BRANCH;
      const prAuthor = allEnvVars.PRX_GITHUB_PR_AUTHOR;

      moreLines.push(`> ${prAuthor}: ${prTitle}`);
      moreLines.push(
        `Merging commits from \`${branch}\` into \`${prBaseBranch}\``,
      );
    }

    blox.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [`*${line1.join(' ')}*`, moreLines.join('\n')].join('\n'),
      },
    });

    return blox;
  },
};

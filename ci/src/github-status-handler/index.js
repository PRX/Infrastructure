/**
 * Invoked by: EventBridge rule
 *
 * Updates the status for a specific commit in GitHub based on the details of a
 * CodeBuild state change event that triggered the Lambda function.
 */

const https = require('https');

/**
 *
 * @param {string} ownerAndRepo
 * @param {string} sha
 * @param {string} body
 * @returns {Promise<void>}
 */
async function postStatus(ownerAndRepo, sha, body) {
  return new Promise((resolve, reject) => {
    const gitHubToken = process.env.GITHUB_ACCESS_TOKEN;

    const options = {
      host: 'api.github.com',
      path: `/repos/${ownerAndRepo}/statuses/${sha}`,
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github.v3+json',
        Authorization: `token ${gitHubToken}`,
        'User-Agent': 'PRX/CI (github-status-handler)',
      },
    };

    options.headers['Content-Length'] = Buffer.byteLength(body);

    // Request with response handler
    console.log(`Calling statuses API: ${options.path}`);
    const req = https.request(options, (res) => {
      res.setEncoding('utf8');

      let json = '';
      res.on('data', (chunk) => {
        json += chunk;
      });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(
            new Error(`GitHub statuses request failed! ${res.statusCode}`),
          );
        }
      });
    });

    // Generic request error handling
    req.on('error', (e) => reject(e));

    req.write(body);
    req.end();
  });
}

function codebuildUrl(event) {
  const region = event.region;
  const account = event.account;
  const project = event.detail['project-name'];
  const uuid = event.detail['build-id'].split('/')[1].split(':')[1];

  return `https://console.aws.amazon.com/codesuite/codebuild/${account}/projects/${project}/build/${project}%3A${uuid}?region=${region}`;
}

/**
 * @param {*} event
 * @returns {Promise<void>}
 */
exports.handler = async (event) => {
  console.log(JSON.stringify(event));

  const env = event.detail['additional-information'].environment;
  const envVars = env['environment-variables'];

  const ownerAndRepo = envVars.find((v) => v.name === 'PRX_REPO').value;
  const sha = envVars.find((v) => v.name === 'PRX_COMMIT').value;

  const body = {
    context: 'continuous-integration/prxci',
    target_url: codebuildUrl(event),
  };

  switch (event.detail['build-status']) {
    case 'IN_PROGRESS':
      body.state = 'pending';
      body.description = 'Build has started running in CodeBuild';
      break;
    case 'SUCCEEDED':
      body.state = 'success';
      // TODO Include build duration
      body.description = 'Build complete';
      break;
    case 'FAILED':
      body.state = 'failure';
      body.description = 'Build failed';
      break;
    case 'STOPPED':
      body.state = 'error';
      body.description = 'Build was stopped';
      break;
    default:
      body.state = 'pending';
      body.description = 'Unknown build state';
      break;
  }

  await postStatus(ownerAndRepo, sha, JSON.stringify(body));
};

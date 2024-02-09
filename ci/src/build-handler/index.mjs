/**
 * Invoked by: EventBridge rule
 *
 * Handles GitHub events that have been forwarded from the webhook endpoint.
 * This function handles the start of the build process for default branches and
 * pull requests (for repositories that are designed to work with CodeBuild).
 * Broadly, it does the following:
 * 1. Check to make sure this event should trigger a build
 * 2. Trigger a build with the necessary details about GitHub repository and
 *    commit for the event as overrides on the build parameters
 *
 * This Lambda should not be considered to be entirely or even mostly
 * responsible for the configuration of CodeBuild environment. It should only
 * worry about the parts of the configuration that result from the events
 * the function is intended to handle.
 */

import { request } from 'node:https';
import { CodeBuildClient, StartBuildCommand } from '@aws-sdk/client-codebuild';

const codebuild = new CodeBuildClient({ apiVersion: '2016-10-06' });

/** @typedef { import('aws-lambda').SNSEvent } SNSEvent */
/** @typedef { import('@octokit/types').Endpoints["GET /repos/{owner}/{repo}"]["response"]["data"] } ReposGetResponseData } */
/** @typedef { import('@octokit/types').Endpoints["GET /repos/{owner}/{repo}/contents/{path}"]["response"]["data"] } ReposGetContentResponseData } */
/** @typedef { import('@octokit/types').Endpoints["GET /repos/{owner}/{repo}/pulls/{pull_number}"]["response"]["data"] } PullsGetResponseData } */

/**
 * @typedef {object} GitHubPushWebhookPayload
 * @property {!string} ref
 * @property {!string} before
 * @property {!string} after
 * @property {!ReposGetResponseData} repository
 */

/**
 * @typedef {object} GitHubPullRequestWebhookPayload
 * @property {!string} action
 * @property {!number} number
 * @property {!ReposGetResponseData} repository
 * @property {!PullsGetResponseData} pull_request
 */

const PR_ACTION_TRIGGERS = [
  'opened',
  'reopened',
  'synchronize',
  'ready_for_review',
  'unlocked',
];
const USER_AGENT = 'PRX/Infrastructure (github-event-handler)';
const GITHUB_HEADERS = {
  Authorization: `token ${process.env.GITHUB_ACCESS_TOKEN}`,
  Accept: 'application/vnd.github.v3+json',
  'User-Agent': USER_AGENT,
};

/**
 * @param {*} event
 * @returns {event is GitHubPullRequestWebhookPayload}
 */
function eventIsPullRequest(event) {
  if (Object.prototype.hasOwnProperty.call(event, 'pull_request')) {
    return true;
  }

  return false;
}

/**
 * `startBuild` returns a Build object
 * https://docs.aws.amazon.com/codebuild/latest/APIReference/API_Build.html
 * @param {string} ciContentsResponse - The response from the GitHub repository contents API for buildspec.yml
 * @param {GitHubPullRequestWebhookPayload|GitHubPushWebhookPayload} event
 */
async function triggerBuild(ciContentsResponse, event) {
  console.log('Starting CodeBuild run');

  // ciContentsResponse is the JSON body response from a Contents API request
  // to GitHub for a buildspec.yml file in the project that triggered the
  // webhook event. It contains a base 64 encoded string which is the contents
  // of that file.
  /** @type {ReposGetContentResponseData} */
  const ghData = JSON.parse(ciContentsResponse);
  // TODO Not sure why it thinks ghData.content doesn't exist
  // @ts-ignore
  const buildspec = Buffer.from(ghData.content, 'base64').toString('utf8');

  // Only trigger builds for repositories where the buildspec appears to be
  // be designed for use with CI. Look for an `PRX_` string as a test.
  if (!buildspec.includes('PRX_')) {
    console.log('Skipping unsupported buildspec.yml');
    return;
  }

  const commitRef = eventIsPullRequest(event)
    ? event.pull_request.head.sha
    : event.after;

  const environmentVariables = [
    {
      name: 'PRX_REPO',
      value: event.repository.full_name, // e.g. PRX/MyApp
    },
    {
      name: 'PRX_COMMIT',
      value: commitRef,
    },
  ];

  if (eventIsPullRequest(event)) {
    // Pull requests are test-only builds. The pull request number is not
    // used by the build process, but needs to be passed along to the
    // callback for setting the GitHub status.

    event.repository.clone_url;

    const num = event.pull_request.number;
    const title = event.pull_request.title;
    const branch = event.pull_request.head.ref;
    const baseBranch = event.pull_request.base.ref;
    const author = event.pull_request.user.login;
    const action = event.action;
    environmentVariables.push({ name: 'PRX_GITHUB_PR', value: `${num}` });
    environmentVariables.push({ name: 'PRX_GITHUB_PR_TITLE', value: title });
    environmentVariables.push({
      name: 'PRX_GITHUB_PR_BASE_BRANCH',
      value: baseBranch,
    });
    environmentVariables.push({ name: 'PRX_GITHUB_PR_AUTHOR', value: author });
    environmentVariables.push({ name: 'PRX_GITHUB_ACTION', value: action });
    environmentVariables.push({ name: 'PRX_BRANCH', value: branch });
    environmentVariables.push({ name: 'PRX_CI_PUBLISH', value: 'false' });
  } else {
    // All other events should be code pushes to the default branch. These
    // should get tested and published. The buildspec.yml file will contain
    // environment variables that allow the post_build.sh script to
    // determine where and how to handle successful builds (e.g. where to
    // push the code, etc).

    const branch = (event.ref || 'unknown').replace(/^refs\/heads\//, '');
    const before = event.before;
    const after = event.after;
    environmentVariables.push({ name: 'PRX_BRANCH', value: branch });
    environmentVariables.push({ name: 'PRX_CI_PUBLISH', value: 'true' });
    environmentVariables.push({ name: 'PRX_GITHUB_BEFORE', value: before });
    environmentVariables.push({ name: 'PRX_GITHUB_AFTER', value: after });
  }

  await codebuild.send(
    new StartBuildCommand({
      projectName: process.env.CODEBUILD_PROJECT_NAME,
      sourceTypeOverride: 'GITHUB',
      sourceLocationOverride: event.repository.clone_url,
      sourceVersion: eventIsPullRequest(event)
        ? `pr/${event.pull_request.number}`
        : event.after,
      buildspecOverride: buildspec,
      environmentVariablesOverride: environmentVariables,
    }),
  );

  console.log('CodeBuild started');
}

/**
 * Hits the GitHub repot contents API to determine if the commit that triggered
 * event supports the PRX CI system by looking for a buildspec.yml file
 * https://docs.github.com/en/free-pro-team@latest/rest/reference/repos#contents
 * @param {GitHubPullRequestWebhookPayload|GitHubPushWebhookPayload} event
 * @returns {Promise<string|false>} The JSON response
 */
function getBuildspecContentJson(event) {
  return new Promise((resolve, reject) => {
    console.log('Getting buildspec contents');

    // Get request properties
    const repo = event.repository.full_name;
    const path = 'buildspec.yml';
    const ref = eventIsPullRequest(event)
      ? event.pull_request.head.sha
      : event.after;

    // Setup request options
    const options = {
      host: 'api.github.com',
      path: `/repos/${repo}/contents/${path}?ref=${ref}`,
      method: 'GET',
      headers: GITHUB_HEADERS,
    };

    options.headers['Content-Length'] = Buffer.byteLength('');

    // Request with response handler
    console.log(`Calling contents API: ${options.path}`);
    const req = request(options, (res) => {
      res.setEncoding('utf8');

      let json = '';
      res.on('data', (chunk) => {
        console.log(chunk);
        json += chunk;
      });
      res.on('end', () => {
        switch (res.statusCode) {
          case 200:
            console.log('Found CodeBuild support');
            resolve(json);
            break;
          case 404:
            console.log('No CodeBuild support!');
            resolve(false);
            break;
          default:
            console.error(`Request failed ${res.statusCode}!`);
            console.error(json);
            reject(new Error('Contents request failed!'));
        }
      });
    });

    req.setTimeout(1000, () => {
      console.log('========= request timed out');
    });

    // Generic request error handling
    req.on('error', (e) => reject(e));

    req.write('');
    req.end();
  });
}

/**
 *
 * @param {GitHubPullRequestWebhookPayload|GitHubPushWebhookPayload} event
 */
async function handleCiEvent(event) {
  const buildspecContentJson = await getBuildspecContentJson(event);

  if (buildspecContentJson) {
    await triggerBuild(buildspecContentJson, event);

    console.log('Done');
  }
}

/**
 * We'll want to trigger a build when actions on the pull request represent
 * a change that requires CI, such as opening, synchornizing, or moving from
 * draft to ready for review.
 * https://docs.github.com/en/free-pro-team@latest/developers/webhooks-and-events/webhook-events-and-payloads#pull_request
 * @param {GitHubPullRequestWebhookPayload} event
 */
async function handlePullRequestEvent(event) {
  console.log('Handling pull_request event');

  if (PR_ACTION_TRIGGERS.includes(event.action)) {
    console.log(`With action: ${event.action}`);
    await handleCiEvent(event);
  }
}

/**
 * Push events will get delivered for any branch. For pushes to pull requests,
 * there will be an additional `pull_request` event that we will use to trigger
 * the build, so this only needs to proceed if the event is for the default
 * branch.
 * https://docs.github.com/en/free-pro-team@latest/developers/webhooks-and-events/webhook-events-and-payloads#push
 * @param {GitHubPushWebhookPayload} event
 */
async function handlePushEvent(event) {
  console.log('Handling push event');

  if (event.ref === `refs/heads/${event.repository.default_branch}`) {
    console.log('Push event was for default branch');
    await handleCiEvent(event);
  }
}

/**
 * @param {*} event
 * @returns {Promise<void>}
 */
export const handler = async (event) => {
  console.log(JSON.stringify(event));

  const githubEvent = event['detail-type'];
  const githubEventObj = event.detail;

  switch (githubEvent) {
    case 'push':
      await handlePushEvent(githubEventObj);
      break;
    case 'pull_request':
      await handlePullRequestEvent(githubEventObj);
      break;
    default:
      console.log('Ignoring this event type!');
  }
};

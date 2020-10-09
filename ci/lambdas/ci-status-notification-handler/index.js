// Invoked by: SNS Subscription
// Returns: Error or status message
//
// Recieves notifications from the CI process, generally as a result of
// CodeBuild status changes. The messages are sent to the Slack Message Relay
// SNS topic in order to be sent to Slack. All messages handled by this function
// are sent to the #ops-builds (this could change at some point).
//
// CI Status message can be sent from several sources. The GitHub event handler
// will send messages after a build has started, and includes data about the
// GitHub event that triggered the build, and the build itself.
// eg { event: {...}, build: {...} }

const AWS = require('aws-sdk');

const sns = new AWS.SNS({ apiVersion: '2010-03-31' });

const SLACK_CHANNEL = '#ops-builds';
const SLACK_ICON = ':ops-codebuild:';
const SLACK_USERNAME = 'AWS CodeBuild';

function attachmentsForGitHubEvent(gitHubEvent, gitHubBuild) {
    const repo = gitHubEvent.repository.full_name;
    const sha = gitHubEvent.after || gitHubEvent.pull_request.head.sha;
    const sha7 = sha.substring(0, 7);
    const branch = gitHubEvent.pull_request ? gitHubEvent.pull_request.head.ref : gitHubEvent.ref.replace(/refs\/heads\//, '');

    const { arn } = gitHubBuild;
    const region = arn.split(':')[3];
    const buildId = arn.split('/')[1];

    const commitUrl = `https://github.com/${repo}/commit/${sha7}`;
    const buildUrl = `https://${region}.console.aws.amazon.com/codebuild/home#/builds/${buildId}/view/new`;

    const attachment = {
        ts: Math.floor(Date.parse(gitHubBuild.startTime) / 1000),
        footer: branch,
        color: 'warning',
        mrkdwn_in: ['text'],
    };

    if (gitHubEvent.pull_request) {
        const pr = gitHubEvent.pull_request;
        const action = gitHubEvent.action.charAt(0).toUpperCase() + gitHubEvent.action.slice(1);

        attachment.fallback = `Building ${repo} #${pr.number} with commit ${sha7}`;
        attachment.title = `<${buildUrl}|Building> ${repo} with commit <${commitUrl}|${sha7}>`;
        attachment.text = `${action} <${pr.html_url}|#${pr.number}> ${pr.title} – ${pr.user.login}`;
    } else {
        attachment.fallback = `Building ${repo}:${branch} with commit ${sha7}`;
        attachment.title = `<${buildUrl}|Building> ${repo}:${branch} with commit <${commitUrl}|${sha7}>`;

        const compareUrl = `https://github.com/${repo}/compare/${gitHubEvent.before}...${gitHubEvent.after}`;

        const text = [];
        text.push(`<${compareUrl}|${gitHubEvent.commits.length} new commits> pushed by ${gitHubEvent.pusher.name}`);

        gitHubEvent.commits.forEach((commit) => {
            text.push(`<${commit.url}|\`${commit.id.substring(0, 7)}\`> ${commit.author.username}:${commit.message}`);
        });

        attachment.text = text.join('\n');
    }

    return [attachment];
}

function attachmentsForCiCallback(ciResult) {
    const repo = ciResult.prxRepo;
    const sha = ciResult.prxCommit;
    const sha7 = sha.substring(0, 7);

    const arn = ciResult.buildArn;
    const region = arn.split(':')[3];
    const buildId = arn.split('/')[1];

    const commitUrl = `https://github.com/${repo}/commit/${sha7}`;
    const buildUrl = `https://${region}.console.aws.amazon.com/codebuild/home#/builds/${buildId}/view/new`;

    const attachment = {
        ts: Math.floor(Date.now() / 1000),
        // footer: branch,
        mrkdwn_in: ['text'],
    };

    let extra = '';

    if (ciResult.prxGithubPr) {
        const num = ciResult.prxGithubPr;
        const prUrl = `https://github.com/${repo}/pull/${num}`;
        extra = ` <${prUrl}|#${num}>`;
    } else {
        // This assumes that anything other than PR is master, which, for the
        // time being, is true. But that may not always be the case
        // TODO This needs to be determined from the event info
        extra = ':master';
    }

    if (ciResult.success) {
        attachment.color = 'good';
        attachment.fallback = `Built ${repo}${extra} with commit ${sha7}`;
        attachment.title = `Built <${buildUrl}|${repo}>${extra} with commit <${commitUrl}|${sha7}>`;
        attachment.title = `<${buildUrl}|Built> ${repo}${extra} with commit <${commitUrl}|${sha7}>`;

        if (ciResult.prxGithubPr) {
            const num = ciResult.prxGithubPr;
            const prUrl = `https://github.com/${repo}/pull/${num}`;
            attachment.text = `<${prUrl}|${prUrl}>`;
        } else if (ciResult.prxEcrTag) {
            const ecrUrl = `https://console.aws.amazon.com/ecs/home?region=${ciResult.prxEcrRegion}#/repositories/${repo.split('/')[1]}`;
            attachment.text = `Docker image pushed to <${ecrUrl}|ECR> with tag \`${sha7}\``;
        } else {
            attachment.text = 'Tktktk Lambda deploy';
        }
    } else {
        attachment.color = 'danger';
        attachment.fallback = `Failed to build ${repo}${extra} with commit ${sha7}`;
        attachment.title = `Failed to build <${buildUrl}|${repo}>${extra} with commit <${commitUrl}|${sha7}>`;
        attachment.title = `Failed to <${buildUrl}|build> ${repo}${extra} with commit <${commitUrl}|${sha7}>`;
        attachment.text = `> _${ciResult.reason}_`;
    }

    return [attachment];
}

// This event argument is the standard Lambda execution event data
function messageForEvent(event) {
    const noteJson = event.Records[0].Sns.Message;
    const note = JSON.parse(noteJson);

    let attachments;

    // Note is either data related to a GitHub event, or the result of a CI
    // build. They are handled differently. A GitHub event will have an `event`
    // and `build` property.
    if (note.event && note.build) {
        attachments = attachmentsForGitHubEvent(note.event, note.build);
    } else {
        // If the object didn't look like it came from GitHub assume it came
        // from CI. CI objects have a `callback` wrapper property.
        attachments = attachmentsForCiCallback(note.callback);
    }

    return {
        channel: SLACK_CHANNEL,
        username: SLACK_USERNAME,
        icon_emoji: SLACK_ICON,
        attachments,
    };
}

function main(event, context, callback) {
    const message = messageForEvent(event);

    const messageJson = JSON.stringify(message);

    sns.publish({
        TopicArn: process.env.SLACK_MESSAGE_RELAY_TOPIC_ARN,
        Message: messageJson,
    }, (err) => {
        if (err) {
            callback(err);
        } else {
            callback(null);
        }
    });
}

exports.handler = (event, context, callback) => {
    try {
        main(event, context, callback);
    } catch (e) {
        callback(e);
    }
};

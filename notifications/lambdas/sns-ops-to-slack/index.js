// This is intended to handle any sort of alerts or notifications that may
// result from deploying and maintaining the infrastructure, or from the apps
// and services that are deployed. It is subscribed to the main SNS topics that
// notifications are sent to, and includes logic to handle different types of
// messages in different ways. The result of this particular function is to
// forward messages to Slack. Other endpoints could be handled by other
// functions.
//
// There are three things that need to be determined independently to post a
// message: the destination channel, the webhook to use, and the message itself
//
// The following environment variables are required:
// - ASG_SLACK_WEBHOOK_URL
// - CW_SLACK_WEBHOOK_URL
// - PIPELINE_SLACK_WEBHOOK_URL
// - CODEBUILD_SLACK_WEBHOOK_URL
// - CFN_SLACK_WEBHOOK_URL
// - IKE_SLACK_WEBHOOK_URL

const url = require('url');
const https = require('https');

const APPROVED = 'Approved';
const REJECTED = 'Rejected';

const CODEPIPELINE_MANUAL_APPROVAL_CALLBACK = 'codepipeline-approval-action';

exports.handler = (event, context, callback) => {
    try {
        main(event, context, callback);
    } catch (e) {
        callback(e);
    }
};
//
function main(event, context, callback) {
    const message = messageForEvent(event);
    const webhook = webhookForEvent(event);

    Promise.all([message, webhook])
        .then(postMessage)
        .then(() => callback(null))
        .catch(e => callback(e));
}

////////////////////////////////////////////////////////////////////////////////
// MESSAGE /////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////

function messageForEvent(event) {
    return (new Promise((resolve, reject) => {
        resolve({
            channel: channelForEvent(event),
            attachments: attachmentsForEvent(event)
        });
    }));
}

// Which channel the message gets sent to is based on the type of message. Some
// events, like CI status, have their own SNS topic, while others use the
// generic topics like info, error, etc. The channel is always based on the
// topic the message was sent to, but several topics can be used for the same
// channel
function channelForEvent(event) {
    const topicArn = event.Records[0].Sns.TopicArn;

    if (/OpsFatal/.test(topicArn)) {
        return '#ops-fatal';
    } else if (/OpsError/.test(topicArn)) {
        return '#ops-error';
    } else if (/OpsWarn/.test(topicArn)) {
        return '#ops-warn';
    } else if (/OpsInfo/.test(topicArn)) {
        return '#ops-info';
    } else if (/OpsDebug/.test(topicArn)) {
        return '#ops-debug';
    } else if (/OpsStatus/.test(topicArn)) {
        return '#ops-status';
    } else if (/CiStatus/.test(topicArn)) {
        return '#ops-status';
    } else {
        return '#ops-debug';
    }
}

function attachmentsForEvent(event) {
    const sns = event.Records[0].Sns;

    // First deal with events that can be routed without parsing the SNS message
    if (/CiStatus/.test(sns.TopicArn)) {
        return attachmentsForCiStatus(event);
    } else if (/StackId='arn:aws:cloudformation/.test(sns.Message)) {
        return attachmentForCloudFormation(event);
    } else {
        // Then try parsing the message as JSON
        try {
            let message = JSON.parse(sns.Message);

            if (message.hasOwnProperty('AlarmName')) {
                // CloudWatch Alarms
                return attachmentsForAlarm(event);
            } else if (message.hasOwnProperty('approval')) {
                // CodePipeline Approval actions
                return attachmentsForCodePipelineApproval(event);
            } else if (message.hasOwnProperty('AutoScalingGroupARN')) {
                return attachmentsForAutoScaling(event);
            } else {
                // Deal with JSON-formatted messages that we don't know what to
                // do with specifically
                return attachmentsForUnknown(event);
            }

        } catch (e) {
            // If JSON parsing fails the message may be a legacy format, and
            // can be handled here. Or it's an event we don't know how to handle
            return attachmentsForUnknown(event);
        }
    }
}

// CI STATUS ///////////////////////////////////////////////////////////////////

// CI Status message can be sent from several sources. The GitHub event handler
// will send messages after a build has started, and includes data about the
// GitHub event that triggered the build, and the build itself.
// eg { event: {...}, build: {...} }
function attachmentsForCiStatus(event) {
    // TODO This is only true for message sent by the GitHub Event Handler;
    // those sent by the CodeBuild Callback Handler will be different

    const data = JSON.parse(event.Records[0].Sns.Message);

    if (data.event && data.build) {
        return attachmentsForCiStart(data.event, data.build);
    } else {
        return attachmentsForCiCallback(data.callback);
    }
}

// Event here is the GitHub event, not the Lambda event
// Needs to handle master pushes and pull requests a bit differently
function attachmentsForCiStart(event, build) {
    const repo = event.repository.full_name;
    const sha = event.after || event.pull_request.head.sha;
    const sha7 = sha.substring(0, 7);
    const branch = event.pull_request ? event.pull_request.head.ref : event.ref.replace(/refs\/heads\//, '');

    const arn = build.arn;
    const region = arn.split(':')[3];
    const buildId = arn.split('/')[1];

    const commitUrl = `https://github.com/${repo}/commit/${sha7}`;
    const buildUrl = `https://${region}.console.aws.amazon.com/codebuild/home#/builds/${buildId}/view/new`;

    const attachment = {
        ts: (Date.parse(build.startTime) / 1000 | 0),
        footer: branch,
        color: 'warning',
        mrkdwn_in: ['text']
    };

    if (event.pull_request) {
        const pr = event.pull_request;
        const action = event.action.charAt(0).toUpperCase() + event.action.slice(1);

        attachment.fallback = `Building ${repo} #${pr.number} with commit ${sha7}`;
        attachment.title = `Building <${buildUrl}|${repo}> with commit <${commitUrl}|${sha7}>`;
        attachment.text = `${action} <${pr.html_url}|#${pr.number}> ${pr.title} – ${pr.user.login}`;
    } else {
        attachment.fallback = `Building ${repo}:${branch} with commit ${sha7}`;
        attachment.title = `Building <${buildUrl}|${repo}:${branch}> with commit <${commitUrl}|${sha7}>`;

        const compareUrl = `https://github.com/${repo}/compare/${event.before}...${event.after}`;

        const text = [];
        text.push(`<${compareUrl}|${event.commits.length} new commits> pushed by ${event.pusher.name}`);

        event.commits.forEach(commit => {
            text.push(`<${commit.url}|\`${commit.id.substring(0, 7)}\`> ${commit.author.username}:${commit.message}`);
        });

        attachment.text = text.join('\n');
    }

    return [attachment];
}

function attachmentsForCiCallback(data) {
    console.log(data);
    const repo = data.prxRepo;
    const sha = data.prxCommit;
    const sha7 = sha.substring(0, 7);

    const arn = data.buildArn;
    const region = arn.split(':')[3];
    const buildId = arn.split('/')[1];

    const commitUrl = `https://github.com/${repo}/commit/${sha7}`;
    const buildUrl = `https://${region}.console.aws.amazon.com/codebuild/home#/builds/${buildId}/view/new`;

    const attachment = {
        ts: (Date.now() / 1000 | 0),
        // footer: branch,
        mrkdwn_in: ['text']
    };

    let extra = '';

    if (data.prxGithubPr) {
        const num = data.prxGithubPr;
        const prUrl = `https://github.com/${repo}/pull/${num}`;
        extra = ` <${prUrl}|#${num}>`;
    } else {
        // This assumes that anything other than PR is master, which, for the
        // time being, is true. But that may not always be the case
        extra = `:master`;
    }

    if (data.success) {
        attachment.color = 'good';
        attachment.fallback = `Built ${repo}${extra} with commit ${sha7}`;
        attachment.title = `Built <${buildUrl}|${repo}>${extra} with commit <${commitUrl}|${sha7}>`;

        if (data.prxGithubPr) {
            const num = data.prxGithubPr;
            const prUrl = `https://github.com/${repo}/pull/${num}`;
            attachment.text = `<${prUrl}|${prUrl}>`;
        } else if (data.prxEcrTag) {
            const ecrUrl = `https://console.aws.amazon.com/ecs/home?region=${data.prxEcrRegion}#/repositories/${repo}`;
            attachment.text = `Docker image pushed to <${ecrUrl}|ECR> with tag \`${sha7}\``;
        } else {
            attachment.text = `Tktktk Lambda deploy`;
        }
    } else {
        attachment.color = 'danger';
        attachment.fallback = `Failed to build ${repo}${extra} with commit ${sha7}`;
        attachment.title = `Failed to build <${buildUrl}|${repo}>${extra} with commit <${commitUrl}|${sha7}>`
        attachment.text = `> _${data.reason}_`;
    }

    return [attachment];
}

// CLOUDFORMATION //////////////////////////////////////////////////////////////

function attachmentForCloudFormation(event) {
    const note = event.Records[0].Sns.Message;

    // Each event includes information about the stack where the change is
    // happening
    const stackId = note.match(/StackId='([a-zA-Z0-9-\:\/]+)'\n/)[1];
    const stackName = note.match(/StackName='([a-zA-Z0-9-]+)'\n/)[1];
    const timestamp = note.match(/Timestamp='([0-9TZ.:-]+)'\n/)[1];

    // And information about the resource that is actually changing
    const resourceType = note.match(/ResourceType='([a-zA-Z0-9-\:]+)'\n/)[1];
    const resourceId = note.match(/LogicalResourceId='(.+)'\n/)[1];
    const resourceStatus = note.match(/ResourceStatus='([a-zA-Z_]+)'\n/)[1];
    const resourceReason = note.match(/ResourceStatusReason='(.*)'\n/)[1];

    const region = stackId.split(':')[3];
    const stackUrl = `https://${region}.console.aws.amazon.com/cloudformation/home#/stack/detail?stackId=${stackId}`;

    return [
        {
            color: colorForCloudFormation(resourceStatus),
            fallback: `${stackName}:${resourceId} – ${resourceStatus}`,
            author_name: stackName,
            author_link: stackUrl,
            title: `${resourceType} – ${resourceId}`,
            text: `Status: ${resourceStatus}\n>_${resourceReason}_`,
            footer: region,
            ts: (Date.parse(timestamp) / 1000 | 0),
            mrkdwn_in: ['text']
        }
    ];
}

// These colors match events in the CloudFormation console
function colorForCloudFormation(status) {
    const green = [
        'CREATE_COMPLETE',
        'ROLLBACK_COMPLETE',
        'UPDATE_COMPLETE',
        'UPDATE_ROLLBACK_COMPLETE',
    ];

    const yellow = [
        'CREATE_IN_PROGRESS',
        'DELETE_IN_PROGRESS',
        'REVIEW_IN_PROGRESS',
        'ROLLBACK_IN_PROGRESS',
        'UPDATE_IN_PROGRESS',
        'UPDATE_COMPLETE_CLEANUP_IN_PROGRESS'
    ]

    const red = [
        'CREATE_FAILED',
        'DELETE_FAILED',
        'ROLLBACK_FAILED',
        'UPDATE_ROLLBACK_FAILED',
        'UPDATE_ROLLBACK_IN_PROGRESS',
        'UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS'
    ]

    const grey = [
        'DELETE_COMPLETE'
    ]

    if (green.indexOf(status) !== -1) {
       return 'good';
    } else if (yellow.indexOf(status) !== -1) {
        return 'warning';
    } else if (red.indexOf(status) !== -1) {
        return 'danger';
    } else {
        return '#AAAAAA';
    }
}

// CLOUDWATCH ALARM ////////////////////////////////////////////////////////////

function attachmentsForAlarm(event) {
    const alarm = JSON.parse(event.Records[0].Sns.Message);
    const trigger = alarm.Trigger;

    return [
        {
            fallback: `${alarm.NewStateValue} – ${alarm.AlarmName}`,
            color: colorForAlarm(alarm),
            author_name: `${trigger.Namespace}`,
            title: `${alarm.NewStateValue} – ${alarm.AlarmName}`,

            text: `${trigger.MetricName}: ${alarm.NewStateReason}`,
            footer: alarm.Region,
            ts: (Date.parse(alarm.StateChangeTime) / 1000 | 0),
            fields: [
                {
                    title: `Evaluation`,
                    value: `${trigger.Statistic} – ${trigger.EvaluationPeriods} × ${trigger.Period}`,
                    short: true
                }, {
                    title: 'Threshold',
                    value: trigger.Threshold,
                    short: true
                }
            ]
        }
    ];
}

function colorForAlarm(alarm) {
    switch (alarm.NewStateValue) {
        case 'ALARM':
            return '#cc0000';
        case 'OK':
            return '#019933';
        default:
            return '#e07701';
    }
}

// AUTO SCALING ////////////////////////////////////////////////////////////////

function attachmentsForAutoScaling(event) {
    const scaling = JSON.parse(event.Records[0].Sns.Message);

    return [
        {
            fallback: scaling.Cause,
            color: colorForAutoScaling(scaling),
            author_name: scaling.AutoScalingGroupName,
            title: scaling.Event,
            text: scaling.Cause,
            footer: scaling.Details['Availability Zone'],
            ts: (Date.now() / 1000 | 0)
        }
    ];
}

function colorForAutoScaling(scaling) {
    if (/EC2_INSTANCE_TERMINATE/.test(scaling.Event)) {
        return '#FF8400';
    } else {
        return '#0099FF';
    }
}

// CODEPIPELINE ////////////////////////////////////////////////////////////////

function attachmentsForCodePipelineApproval(event) {
    const message = JSON.parse(event.Records[0].Sns.Message);

    // All the values the CodePipeline SDK needs to approve or reject a pending
    // approval get stuffed into the `callback_id` as serialized JSON.
    // pipelineName
    // stageName
    // actionName
    // token
    const params = {
        pipelineName: message.approval.pipelineName,
        stageName: message.approval.stageName,
        actionName: message.approval.actionName,
        token: message.approval.token
    };

    return [
        {
            fallback: `${message.approval.pipelineName} ${message.approval.stageName}: ${message.approval.actionName}`,
            color: '#FF8400',
            author_name: message.approval.pipelineName,
            author_link: message.consoleLink,
            title: `${message.approval.stageName}: ${message.approval.actionName}`,
            title_link: message.approval.approvalReviewLink,
            text: `Manual approval required to trigger *ExecuteChangeSet*`,
            footer: message.region,
            ts: (Date.now() / 1000 | 0),
            mrkdwn_in: ['text'],
            callback_id: CODEPIPELINE_MANUAL_APPROVAL_CALLBACK,
            actions: [
                {
                    type: 'button',
                    name: 'decision',
                    text: 'Reject',
                    value: JSON.stringify(Object.assign({value: REJECTED}, params))
                }, {
                    type: 'button',
                    style: 'primary',
                    name: 'decision',
                    text: 'Approve',
                    value: JSON.stringify(Object.assign({value: APPROVED}, params)),
                    confirm: {
                        title: 'Are you sure?',
                        text: 'This will initiate a production deploy',
                        ok_text: 'Yes',
                        dismiss_text: 'Abort'
                    }
                }
            ]
        }
    ];
}

// UNKNOWN /////////////////////////////////////////////////////////////////////

function attachmentsForUnknown(event) {
    return [
        {
            fallback: 'Message of unknown type',
            title: 'Message of unknown type',
            text:  event.Records[0].Sns.Message,
            footer: event.Records[0].Sns.TopicArn
        }
    ];
}

////////////////////////////////////////////////////////////////////////////////
// SENDER //////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////

// The webhook used to post the message determines who in Slack it appears the
// post is coming from. In some cases the source of the post is determined by
// where the message was sent, like in the case of a CI status update. For a
// CloudWatch alarm, though, the source should always be the same, even though
// some posts are sent to Warn and others are sent to Fatal.
function webhookForEvent(event) {
  return (new Promise((resolve, reject) => {
      const sns = event.Records[0].Sns;

      // Some webhooks can be determined without trying to parse the message
      if (/CiStatus/.test(sns.TopicArn)) {
          resolve(process.env.CODEBUILD_SLACK_WEBHOOK_URL);
      } else if (sns.Subject === 'AWS CloudFormation Notification') {
          resolve(process.env.CFN_SLACK_WEBHOOK_URL);
      } else {
          // Most webhooks are determined by the contents of a JSON message
          try {
              let message = JSON.parse(sns.Message);

              if (message.hasOwnProperty('AutoScalingGroupARN')) {
                  resolve(process.env.ASG_SLACK_WEBHOOK_URL);
              } else if (message.hasOwnProperty('approval')) {
                  resolve(process.env.PIPELINE_SLACK_WEBHOOK_URL);
              } else if (message.hasOwnProperty('AlarmName')) {
                  resolve(process.env.CW_SLACK_WEBHOOK_URL);
              } else {
                  // This is a JSON message that we don't handle explicitly
                  resolve(process.env.IKE_SLACK_WEBHOOK_URL);
              }
          } catch (e) {
              // Some message don't use JSON, and have to be handled differently
              resolve(process.env.IKE_SLACK_WEBHOOK_URL);
          }
      }
  }));
}

////////////////////////////////////////////////////////////////////////////////
// SLACK API ///////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////

function postMessage(inputs) {
    return (new Promise((resolve, reject) => {
        const message = inputs[0];
        const webhook = inputs[1];

        const json = JSON.stringify(message);

        // Setup request options
        const options = url.parse(webhook);
        options.method = 'POST';
        options.headers = {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(json),
        };

        let req = https.request(options, res => {
            res.setEncoding('utf8');

            let json = '';
            res.on('data', chunk => json += chunk);
            res.on('end', () => {
                if (res.statusCode < 500) {
                    resolve();
                } else {
                    reject(new Error('Server Error'));
                }
            });
        });

        // Generic request error handling
        req.on('error', e => reject(e));

        req.write(json);
        req.end();
    }));
}

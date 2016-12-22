'use strict';

const url = require('url');
const https = require('https');

const postPayload = (webhookURL, payload, callback) => {
    let body = JSON.stringify(payload);

    let options = url.parse(webhookURL);
    options.method = 'POST';
    options.headers = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
    };

    let postReq = https.request(options, res => {
        let chunks = [];
        res.setEncoding('utf8');

        res.on('data', chunk => chunks.push(chunk));

        res.on('end', () => {
            let body = chunks.join('');
            if (callback) {
                callback({
                    body: body,
                    statusCode: res.statusCode,
                    statusMessage: res.statusMessage
                });
            }
        });

        return res;
    });

    postReq.write(body);
    postReq.end();
};

const slackChannelForEvent = event => {
    let sns = event.Records[0].Sns;
    let topicArn = sns.TopicArn;

    if (topicArn.search('OpsFatalMessagesSNSTopic') !== -1) {
        return '#ops-fatal';
    } else if (topicArn.search('OpsErrorMessagesSNSTopic') !== -1) {
        return '#ops-error';
    } else if (topicArn.search('OpsWarnMessagesSNSTopic') !== -1) {
        return '#ops-warn';
    } else if (topicArn.search('OpsInfoMessagesSNSTopic') !== -1) {
        return '#ops-info';
    } else if (topicArn.search('OpsDebugMessagesSNSTopic') !== -1) {
        return '#ops-debug';
    } else {
        return '#ops-debug';
    }
};

const colorForAlarmMessage = message => {
    if (message.NewStateValue === 'ALARM') {
        return '#cc0000';
    } else if (message.NewStateValue === 'OK') {
        return '#019933';
    } else {
        return '#e07701';
    }
};

const attachmentForAlarmMessage = message => {
    return {
        fallback: `${message.NewStateValue} – ${message.AlarmDescription}`,
        color: colorForAlarmMessage(message),
        author_name: message.AlarmName,
        title: message.AlarmDescription,
        text: message.NewStateReason,
        footer: message.Region,
        ts: (Date.now() / 1000 | 0)
    };
};

const colorForASGMessage = message => {
    if (message.Event.search('EC2_INSTANCE_TERMINATE') !== -1) {
        return '#FF8400';
    } else {
        return '#0099FF';
    }
};

const attachmentForASGMessage = message => {
    return {
        fallback: message.Cause,
        color: colorForASGMessage(message),
        author_name: message.AutoScalingGroupName,
        title: message.Event,
        text: message.Cause,
        footer: message.Details['Availability Zone'],
        ts: (Date.now() / 1000 | 0)
    };
};

const objFromCFNMessage = message => {
    // let obj = {};
    // message = message.replace(/\\\\n/g, '');
    // message.split('\n').map(x => x.split('=')).forEach(x => obj[x[0]] = x[1]);
    //
    // return obj;
};

const attachmentForCFNMessage = message => {
    // let obj = objFromCFNMessage(message);

    return {
        fallback: '',
        text: 'WIP CloudFormation event'
    };
};

const attachmentForEvent = event => {
    let sns = event.Records[0].Sns;

    if (sns.Message.search(`StackId='arn:aws:cloudformation`) !== -1) {
        return attachmentForCFNMessage(sns.Message);
    } else {
        try {
            let msgObj = JSON.parse(sns.Message);

            if (msgObj.hasOwnProperty('AlarmName')) {
                return attachmentForAlarmMessage(msgObj);
            } else if (msgObj.hasOwnProperty('AutoScalingGroupARN')) {
                return attachmentForASGMessage(msgObj);
            } else {
                return {
                  title: 'Unknown event JSON message',
                  text: sns.Message
                };
            }
        } catch (e) {
            return {
              title: 'Unknown event message',
              text: sns.Message
            };
        }
    }
};

const payloadForEvent = event => {
    let sns = event.Records[0].Sns;
    let topicArn = sns.TopicArn;
    let message = JSON.parse(sns.Message);

    return {
        channel: slackChannelForEvent(event),
        attachments: [attachmentForEvent(event)]
    };
};

const webhookForEvent = event => {
    let sns = event.Records[0].Sns;
    let message = JSON.parse(sns.Message);

    // PIPELINE_SLACK_WEBHOOK_URL

    if (message.hasOwnProperty('AutoScalingGroupARN')) {
        return process.env.ASG_SLACK_WEBHOOK_URL;
    } else {
        return process.env.CW_SLACK_WEBHOOK_URL;
    }
};

const processEvent = (event, context, callback) => {
  postPayload(webhookForEvent(event), payloadForEvent(event), response => {
      if (response.statusCode < 400) {
          console.info(`Message posted successfully`);
          callback();
      } else if (response.statusCode < 500) {
          console.error(`Error posting message to Slack API: ${response.statusCode} - ${response.statusMessage}`);
          callback();  // Don't retry because the error is due to a problem with the request
      } else {
          // Let Lambda retry
          let msg = `Server error when processing message: ${response.statusCode} - ${response.statusMessage}`;
          callback(new Error(msg));
      }
  });
};

exports.handler = (event, context, callback) => {
    try {
        processEvent(event, context, callback);
    } catch (e) {
        callback(e);
    }
};

// Invoked by: API Gateway
// Returns: Error, or API Gateway proxy response object

// The endpoint handler for Slack slash commands that configured through the Ike
// app. This function can be used to handle multiple slash commands.

const querystring = require('querystring');
const AWS = require('aws-sdk');
const crypto = require('crypto');
const https = require('https');

const s3 = new AWS.S3({ apiVersion: '2006-03-01' });
const codepipeline = new AWS.CodePipeline({ apiVersion: '2015-07-09' });
const cloudfront = new AWS.CloudFront({ apiVersion: '2019-03-26' });

const SLACK_API_DIALOG_OPEN = 'https://slack.com/api/dialog.open';
const ROLLBACK_VERSION_SELECTION_CALLBACK = 'rollback-version-selection-action';
const CLOUDFRONT_INVALIDATION_DIALOG_CALLBACK =
  'CLOUDFRONT_INVALIDATION_DIALOG_CALLBACK';

// Calls a method in the Slack Web API with a provided POST body. The payload
// argument is an object. If responseProperty is provided, rather than the
// entire response being resolved from the promise, only that property will be.
// https://api.slack.com/web
// https://api.slack.com/methods
function slackWebMethod(uri, responseProperty, payload) {
  return new Promise((resolve, reject) => {
    const urlencodedBody = querystring.stringify(payload);

    const q = new URL(uri);

    // Setup request options
    const options = {
      host: q.host,
      port: q.port,
      path: `${q.pathname || ''}${q.search || ''}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(urlencodedBody),
      },
    };

    const method = uri.split('/').pop();

    // Request with response handler
    console.log(`[Slack] Calling ${method}`);
    const req = https.request(options, (res) => {
      res.setEncoding('utf8');

      let json = '';
      res.on('data', (chunk) => {
        json += chunk;
      });
      res.on('end', () => {
        try {
          const resPayload = JSON.parse(json);

          if (resPayload.ok) {
            console.error(`[Slack] ${method} ok`);
            resolve(resPayload[responseProperty] || resPayload);
          } else {
            console.error(`[Slack] ${method} error`);
            reject(new Error(resPayload.error));
          }
        } catch (e) {
          console.error(`[Slack] Error parsing ${method}`);
          reject(e);
        }
      });
    });

    // Generic request error handling
    req.on('error', (e) => reject(e));

    req.write(urlencodedBody);
    req.end();
  });
}

function getCloudFrontDistributuons() {
  return new Promise((resolve, reject) => {
    cloudfront.listDistributions(
      {
        MaxItems: '50',
      },
      (error, data) => {
        if (error) {
          reject(error);
        } else {
          resolve(data);
        }
      },
    );
  });
}

function handleRollbackRequest(payload, callback) {
  s3.listObjectVersions(
    {
      Bucket: process.env.INFRASTRUCTURE_CONFIG_BUCKET,
      Prefix: process.env.INFRASTRUCTURE_CONFIG_STAGING_KEY,
    },
    (e, data) => {
      if (e) {
        console.log(e);
        callback(null, { statusCode: 400, headers: {}, body: null });
      } else {
        const now = Date.now();
        const range = 60 * 60 * 24 * 14 * 1000;
        const threshold = now - range;
        const options = data.Versions.filter(
          (v) => +v.LastModified > threshold,
        ).map((v) => {
          const d = new Date(v.LastModified);
          const yy = d.getUTCFullYear();
          const mm = `0${d.getUTCMonth() + 1}`.substr(-2);
          const dd = `0${d.getUTCDate()}`.substr(-2);
          const hh = `0${d.getUTCHours()}`.substr(-2);
          const nn = `0${d.getUTCMinutes()}`.substr(-2);

          const id = `${v.VersionId.substring(0, 9)}…`;
          const time = `${yy}-${mm}-${dd} ${hh}:${nn}`;
          return { value: v.VersionId, text: `${id} ${time}` };
        });

        const msg = {
          text: 'Rollback the staging stack to a previous configuration',
          response_type: 'in_channel',
          attachments: [
            {
              text: 'Revert to this staging template configuration version',
              fallback: 'See Slack to continue with the rollback.',
              color: '#3AA3E3',
              attachment_type: 'default',
              callback_id: ROLLBACK_VERSION_SELECTION_CALLBACK,
              actions: [
                {
                  name: 'cancel',
                  text: 'Cancel',
                  style: 'danger',
                  type: 'button',
                  value: 'cancel',
                },
                {
                  name: 'selection',
                  text: 'Choose a configuration…',
                  type: 'select',
                  options,
                  confirm: {
                    title: 'Are you sure?',
                    text:
                      'This will immediately revert the production template configuration to the selected previous version, which will trigger a CD pipeline execution.',
                    ok_text: 'Yes, start rollback',
                    dismiss_text: 'No',
                  },
                },
              ],
            },
          ],
        };

        const body = JSON.stringify(msg);
        callback(null, { statusCode: 200, headers: {}, body });
      }
    },
  );
}

function handleRelease(payload, callback) {
  codepipeline.startPipelineExecution(
    {
      name: process.env.INFRASTRUCTURE_CD_PIPELINE_NAME,
    },
    (err) => {
      if (err) {
        console.log(err, err.stack); // an error occurred
      } else {
        const msg = {
          text: `Pipeline execution started for \`${process.env.INFRASTRUCTURE_CD_PIPELINE_NAME}\``,
          response_type: 'ephemeral',
        };

        const body = JSON.stringify(msg);
        callback(null, { statusCode: 200, headers: {}, body });
      }
    },
  );
}

async function handleCfInvalidate(payload, callback) {
  const dists = await getCloudFrontDistributuons();

  const options = dists.DistributionList.Items.map((dist) => {
    let aliases = '';

    if (dist.Aliases && dist.Aliases.Items) {
      aliases = dist.Aliases.Items.join(', ');
    }

    return {
      label: `${dist.Id}: ${aliases} ${dist.Comment}`.substring(0, 47),
      value: dist.Id,
    };
  });

  slackWebMethod(SLACK_API_DIALOG_OPEN, null, {
    trigger_id: payload.trigger_id,
    token: process.env.SLACK_ACCESS_TOKEN,
    dialog: JSON.stringify({
      callback_id: CLOUDFRONT_INVALIDATION_DIALOG_CALLBACK,
      title: 'CloudFront Invalidation',
      submit_label: 'Invalidate',
      elements: [
        {
          type: 'select',
          label: 'Distribution ID',
          name: 'distribution_id',
          options,
        },
        {
          type: 'textarea',
          label: 'Object Paths',
          name: 'object_paths',
          placeholder: 'e.g., "/images/*", "/images/image1.jpg", "*"',
          hint: 'One object path per line',
        },
      ],
    }),
  }).then(() => {
    callback(null, { statusCode: 200, headers: {}, body: null });
  });
}

function main(event, context, callback) {
  const payload = querystring.parse(event.body);

  // Slack signing secret
  const slackRequestTimestamp = event.headers['X-Slack-Request-Timestamp'];
  const basestring = ['v0', slackRequestTimestamp, event.body].join(':');
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  const slackSignature = event.headers['X-Slack-Signature'];
  const requestSignature = `v0=${crypto
    .createHmac('sha256', signingSecret)
    .update(basestring)
    .digest('hex')}`;

  if (requestSignature !== slackSignature) {
    // Bad request; bogus signature
    callback(null, { statusCode: 400, headers: {}, body: null });
  } else if (
    payload.command === '/ops-rollback' &&
    payload.channel_id === 'CDTU41WFP'
  ) {
    handleRollbackRequest(payload, callback);
  } else if (
    payload.command === '/ops-release' &&
    payload.channel_id === 'CDTU41WFP'
  ) {
    handleRelease(payload, callback);
  } else if (
    payload.command === '/ops-cf-invalidate' &&
    payload.channel_id === 'CDTU41WFP'
  ) {
    handleCfInvalidate(payload, callback);
  } else {
    // Unauthorized use
    console.log(`Channel ID: ${payload.channel_id}`);

    const msg = {
      text: "Sorry, that command doesn't work here.",
      response_type: 'ephemeral',
    };

    const body = JSON.stringify(msg);
    callback(null, { statusCode: 200, headers: {}, body });
  }
}

exports.handler = (event, context, callback) => {
  try {
    main(event, context, callback);
  } catch (e) {
    callback(e);
  }
};

/**
 * Invoked by: API Gateway
 * Returns: Error, or API Gateway proxy response object
 *
 * Handles GitHub webhook event payload requests. It does a bit of validation
 * on the request, and then forwards the payload to EventBridge, where other
 * Lambdas will pick it up and process the event. This is done in two steps so
 * the GitHub request can return quickly.
 *
 * The `source` of the EventBridge events is `org.prx.ci.github-webhook`, and
 * the `detail-type` will match the GitHub event type from the webhook data
 * (push, pull_request, etc).
 */

import { createHmac } from 'node:crypto';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';

const eventbridge = new EventBridgeClient({ apiVersion: '2015-10-07' });

/** @typedef { import('aws-lambda').APIGatewayProxyStructuredResultV2 } APIGatewayProxyStructuredResultV2 */
/** @typedef { import('aws-lambda').APIGatewayProxyEventV2 } APIGatewayProxyEventV2 */

/** @type {APIGatewayProxyStructuredResultV2} */
const OK_RESPONSE = { statusCode: 200 };

/**
 * @param {APIGatewayProxyEventV2} event Proxy integration payload
 * @returns {Promise<APIGatewayProxyStructuredResultV2>} Proxy integration response
 * @throws GitHub webhook validation error
 */
export const handler = async (event) => {
  const githubSignature = event.headers['x-hub-signature'].split('=')[1];

  console.log(`Checking event signature: ${githubSignature}`);

  const key = process.env.GITHUB_WEBHOOK_SECRET;
  const data = event.body;
  const check = createHmac('sha1', key).update(data).digest('hex');

  if (githubSignature !== check) {
    throw new Error('Invalid signature!');
  }

  console.log(`Handling event: ${event.headers['x-github-event']}`);
  const body = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf-8')
    : event.body;

  console.log(body);

  switch (event.headers['x-github-event']) {
    case 'ping':
      // Blackhole `ping` events
      break;
    default:
      await eventbridge.send(
        new PutEventsCommand({
          Entries: [
            {
              Detail: body,
              DetailType: event.headers['x-github-event'],
              Source: 'org.prx.ci.github-webhook',
            },
          ],
        }),
      );
  }

  return OK_RESPONSE;
};

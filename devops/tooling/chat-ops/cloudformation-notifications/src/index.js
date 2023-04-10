// Invoked by: SNS Subscription
// Returns: Error or status message
//
// Receives notifications related to CloudFormation stack changes, and prepares
// Slack messages for them. The messages are sent to the Slack Message Relay
// SNS topic in order to be sent to Slack. Messages about the stack being
// updated directly are sent to the info channel, and other messages are sent
// to the debug channel
//
// These notifications may come from any region or any account.

const { SNS } = require('@aws-sdk/client-sns');
const eventBridgeEvent = require('./eventbridge');

const sns = new SNS({
  apiVersion: '2010-03-31',
  region: process.env.SLACK_MESSAGE_RELAY_SNS_TOPIC_ARN.split(':')[3],
});

exports.handler = async (event) => {
  console.log(JSON.stringify(event));

  const message = eventBridgeEvent.message(event);

  if (message) {
    await sns.publish({
      TopicArn: process.env.SLACK_MESSAGE_RELAY_SNS_TOPIC_ARN,
      Message: JSON.stringify(message),
    });
  }
};

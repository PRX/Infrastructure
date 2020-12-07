const { WebClient } = require('@slack/web-api');

const web = new WebClient(process.env.SLACK_ACCESS_TOKEN);

exports.handler = async (event) => {
  if (event.Records && event.Records[0] && event.Records[0].EventSource === 'aws:sns') {
    const msg = JSON.parse(event.Records[0].Sns.Message);
    msg.channel = '#sandbox2';
    // await web.chat.postMessage(msg);
  }
};

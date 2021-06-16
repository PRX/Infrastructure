const https = require('https');
const AWS = require('aws-sdk');

const sns = new AWS.SNS({
  apiVersion: '2010-03-31',
  region: process.env.SLACK_MESSAGE_RELAY_SNS_TOPIC_ARN.split(':')[3],
});

const CLASSY_API_CLIENT_ID = process.env.CLASSY_API_CLIENT_ID;
const CLASSY_API_CLIENT_SECRET = process.env.CLASSY_API_CLIENT_SECRET;
const POLLING_FREQUENCY = +process.env.POLLING_FREQUENCY;

function getAccessToken() {
  return new Promise((resolve, reject) => {
    const body = `grant_type=client_credentials&client_id=${CLASSY_API_CLIENT_ID}&client_secret=${CLASSY_API_CLIENT_SECRET}`;

    const options = {
      host: 'api.classy.org',
      path: `/oauth2/auth`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      res.setEncoding('utf8');

      let json = '';
      res.on('data', (chunk) => {
        json += chunk;
      });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const payload = JSON.parse(json);
          resolve(payload.access_token);
        } else {
          reject(new Error(`Classy token request failed! ${res.statusCode}`));
        }
      });
    });

    // Generic request error handling
    req.on('error', (e) => reject(e));

    req.write(body);
    req.end();
  });
}

function httpGet(token, path) {
  return new Promise((resolve, reject) => {
    const options = {
      host: 'api.classy.org',
      path: `/2.0${path}`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    };

    const req = https.get(options, (res) => {
      res.setEncoding('utf8');

      let json = '';
      res.on('data', (chunk) => {
        json += chunk;
      });
      res.on('end', () => {
        try {
          const resPayload = JSON.parse(json);
          resolve(resPayload);
        } catch (e) {
          console.error('Error handling JSON response!');
          reject(e);
        }
      });
    });

    // Generic request error handling
    req.on('error', (e) => reject(e));
  });
}

exports.handler = async (event) => {
  const token = await getAccessToken();

  const payload = await httpGet(token, `/organizations/72482/activity`);

  const now = new Date();
  const threshold = +now - POLLING_FREQUENCY * 60 * 1000;
  // const threshold = +now - 6 * 60 * 1000;

  const mapping = {
    338429: '#radiotopia-donations',
    336384: '#radiotopia-donations',
    330330: '#radiotopia-donations',
    330245: '#radiotopia-donations',
    342678: '#radiotopia-donations',
    326353: '#earhustle-donations',
  };

  for (const activity of payload.data) {
    if (activity.type === 'donation_created') {
      const tx = activity.transaction;
      const camp = activity.campaign;
      const mem = activity.member;

      const ts = Date.parse(activity.created_at);

      if (mapping[camp.id] && ts >= threshold) {
        const comment = tx.comment.length ? `\n> ${tx.comment}` : '';

        // const fullTx = await httpGet(`/transactions/${tx.id}`);
        // console.log(tx);

        let text;
        const name = `${mem?.first_name} ${mem?.last_name.charAt(0)}.`;
        const campUrl = `https://www.classy.org/manage/event/${camp.id}/overview`;
        const txUrl = `https://www.classy.org/admin/72482/transactions/${tx.id}`;
        // const supporterUrl = `https://www.classy.org/admin/72482/supporters/${fullTx.supporter_id}`;

        const currency =
          tx?.metadata?.['_classy_pay']?.transaction?.currency ||
          tx.currency_code;
        const rawAmount =
          tx?.metadata?.['_classy_pay']?.transaction?.amount ||
          tx.raw_donation_gross_amount;
        const amount = (+rawAmount).toFixed(2);

        let money;
        if (currency === 'USD') {
          money = `$${amount}`;
        } else if (currency === 'GBP') {
          money = `£${amount}`;
        } else if (currency === 'CAD') {
          money = `CA$${amount}`;
        } else if (currency === 'EUR') {
          money = `€${amount}`;
        } else {
          money = `${amount} ${currency}`;
        }

        if (
          tx?.metadata?.['_classy_pay']?.transaction?.chargeCurrency &&
          tx?.metadata?.['_classy_pay']?.transaction?.chargeAmount &&
          tx?.metadata?.['_classy_pay']?.transaction?.chargeCurrency !==
            currency
        ) {
          const t = tx?.metadata?.['_classy_pay']?.transaction;
          const ca = +t?.chargeAmount;
          const cc = t?.chargeCurrency;

          if (cc === 'USD') {
            money = `${money} ($${ca.toFixed(2)})`;
          } else {
            money = `${money} (${ca.toFixed(2)} ${cc})`;
          }
        }

        if (tx.frequency === 'one-time') {
          text = `*${name}* made a <${txUrl}|${money}> donation to the <${campUrl}|${camp.name}> campaign${comment}`;
        } else {
          text = `*${name}* created a new ${tx.frequency} recurring giving plan for the <${campUrl}|${camp.name}> campaign for <${txUrl}|${money}>${comment}`;
        }

        await sns
          .publish({
            TopicArn: process.env.SLACK_MESSAGE_RELAY_SNS_TOPIC_ARN,
            Message: JSON.stringify({
              channel: mapping[camp.id],
              username: 'Classy',
              icon_emoji: ':classy:',
              text,
            }),
          })
          .promise();
      }
    }
  }
};

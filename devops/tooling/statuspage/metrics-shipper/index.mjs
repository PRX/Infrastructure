import * as http from 'https';
import {
  CloudWatchClient,
  GetMetricDataCommand,
} from '@aws-sdk/client-cloudwatch';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';

const PAGE_ID = 'zlzvfpy9x7fy';

const sts = new STSClient({ region: 'us-east-2' });

const apiKey = process.env.STATUSPAGE_API_KEY;

function roleArn(accountId) {
  return `arn:aws:iam::${accountId}:role/CloudWatch-CrossAccountSharingRole`;
}

async function sendDataPoints(pageId, data) {
  return new Promise((resolve, reject) => {
    const apiBase = 'https://api.statuspage.io/v1';
    const url = `${apiBase}/pages/${pageId}/metrics/data.json`;

    const authHeader = { Authorization: `OAuth ${apiKey}` };
    const options = { method: 'POST', headers: authHeader };

    const request = http.request(url, options, (res) => {
      if (res.statusMessage === 'Unauthorized') {
        const genericError =
          'Error encountered. Please ensure that your page code and authorization key are correct.';
        return console.error(genericError);
      }
      res.on('data', function () {});

      res.on('end', function () {
        resolve();
      });

      res.on('error', (error) => {
        reject(error);
      });
    });

    request.end(JSON.stringify({ data: data }));
  });
}

async function iteratorAgeData(accountId, region, functionName) {
  const role = await sts.send(
    new AssumeRoleCommand({
      RoleArn: roleArn(accountId),
      RoleSessionName: 'statuspage_data_sender',
    }),
  );

  const cloudwatch = new CloudWatchClient({
    region: region,
    credentials: {
      accessKeyId: role.Credentials.AccessKeyId,
      secretAccessKey: role.Credentials.SecretAccessKey,
      sessionToken: role.Credentials.SessionToken,
    },
  });

  const results = await cloudwatch.send(
    new GetMetricDataCommand({
      MetricDataQueries: [
        {
          Id: 'iteratorAge',
          MetricStat: {
            Metric: {
              Namespace: 'AWS/Lambda',
              MetricName: 'IteratorAge',
              Dimensions: [
                {
                  Name: 'FunctionName',
                  Value: functionName,
                },
              ],
            },
            Period: 60,
            Stat: 'Maximum',
            Unit: 'Milliseconds',
          },
        },
      ],
      StartTime: new Date(+new Date() - 10 * 60000),
      EndTime: new Date(),
    }),
  );

  const datapoints = {};

  if (results.MetricDataResults.length) {
    for (
      let index = 0;
      index < results.MetricDataResults[0].Values.length;
      index++
    ) {
      const value = results.MetricDataResults[0].Values[index];
      const timestamp = results.MetricDataResults[0].Timestamps[index];

      datapoints[`${Math.floor(+timestamp / 1000)}`] = value;
    }
  }

  return datapoints;
}

async function analyticsProcessingLatency() {
  const usEast1Data = await iteratorAgeData(
    '561178107736',
    'us-east-1',
    'infrastructure-cd-root-production-A-CountsFunction-h0qlwOs7VMJZ',
  );
  const usWest2Data = await iteratorAgeData(
    '561178107736',
    'us-west-2',
    'infrastructure-cd-root-production-A-CountsFunction-HZN3g5yVxDSq',
  );

  const uniqueTimestamps = [
    ...new Set([...Object.keys(usEast1Data), ...Object.keys(usWest2Data)]),
  ];

  const datapoints = [];

  for (const timestamp of uniqueTimestamps) {
    let value;

    if (usEast1Data[timestamp] && usWest2Data[timestamp]) {
      value = Math.max(usEast1Data[timestamp], usWest2Data[timestamp]);
    } else {
      value = usEast1Data[timestamp] || usWest2Data[timestamp];
    }

    datapoints.push({
      timestamp: +timestamp,
      value: value / 1000,
    });
  }

  const data = {
    '4n05sgqq2jqg': datapoints,
  };

  return data;
}

async function mediaProcessingVolume() {
  const role = await sts.send(
    new AssumeRoleCommand({
      RoleArn: roleArn('561178107736'),
      RoleSessionName: 'statuspage_data_sender',
    }),
  );

  const cloudwatch = new CloudWatchClient({
    region: 'us-east-2',
    credentials: {
      accessKeyId: role.Credentials.AccessKeyId,
      secretAccessKey: role.Credentials.SecretAccessKey,
      sessionToken: role.Credentials.SessionToken,
    },
  });

  const results = await cloudwatch.send(
    new GetMetricDataCommand({
      MetricDataQueries: [
        {
          Id: 'tasks',
          MetricStat: {
            Metric: {
              Namespace: 'PRX/Porter',
              MetricName: 'TasksRequested',
              Dimensions: [
                {
                  Name: 'StateMachineArn',
                  Value:
                    'arn:aws:states:us-east-2:561178107736:stateMachine:StateMachine-KcY9t10Lo2vV',
                },
              ],
            },
            Period: 60,
            Stat: 'Sum',
            Unit: 'Count',
          },
        },
      ],
      StartTime: new Date(+new Date() - 10 * 60000),
      EndTime: new Date(),
    }),
  );

  const datapoints = [];

  if (results.MetricDataResults.length) {
    for (
      let index = 0;
      index < results.MetricDataResults[0].Values.length;
      index++
    ) {
      const value = results.MetricDataResults[0].Values[index];
      const timestamp = results.MetricDataResults[0].Timestamps[index];

      datapoints.push({
        timestamp: Math.floor(+timestamp / 1000),
        value: value,
      });
    }
  }

  const data = {
    hlrxcqsmmhys: datapoints,
  };

  return data;
}

// Statuspage expects to get at least one value for every 5 minute period; if
// there's a 5 minute period with no value, it show up as a gap in the chart.
//
// The chart has a maximum resolution of 30 seconds. For data sent with a
// timestamp that doesn't land on a a 30 second boundary, Statuspage will
// decide how to shift the data. If multiple data points are sent that would
// be shifted to the same boundary, Statuspage picks one (i.e., does not
// aggregate.
//
// You can send values multiple times for a timestamp, and the value will be
// updated over time with the latest value.
//
// The way this Lambda generally works is: query a metric with a 60-second
// period for a 10 minute block (i.e., get back 10 values, each representing a
// minute). Each value may be a sum, average, etc of all the values that exist
// for that minute in CloudWatch. Send all 10 values to Statuspage. Do this
// every few minutes. That means every time this runs, roughly 7 of the 10
// data points being sent will be updates or duplicates. That's fine. Some
// values don't appear in CloudWatch Metrics for several minutes, so this
// approach ensures that eventually the data in Statuspage is fairly complete.
//
// https://developer.statuspage.io/#tag/metrics
export const handler = async (event) => {
  const analyticsProcessingLatencyData = await analyticsProcessingLatency();
  const mediaProcessingVolumeData = await mediaProcessingVolume();

  const metricsData = {
    ...analyticsProcessingLatencyData,
    ...mediaProcessingVolumeData,
  };

  console.log(JSON.stringify(metricsData));

  await sendDataPoints(PAGE_ID, metricsData);
};

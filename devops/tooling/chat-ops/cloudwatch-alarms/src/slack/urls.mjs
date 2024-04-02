/** @typedef {import('./index.mjs').EventBridgeCloudWatchAlarmsEvent} EventBridgeCloudWatchAlarmsEvent */
/** @typedef {import('@aws-sdk/client-cloudwatch').DescribeAlarmsOutput} DescribeAlarmsOutput */
/** @typedef {import('@aws-sdk/client-cloudwatch').DescribeAlarmHistoryOutput} DescribeAlarmHistoryOutput */

import { ascii } from './operators.mjs';
import { logGroupName } from './log-groups.mjs';

/**
 * Serializes the input to a URL string component compatible with the
 * CloudWatch Metrics console graph (i.e., the URL component after graph=).
 * @param {*} inp
 * @returns {String}
 */
function cwUrlEncode(inp) {
  let str = '';

  if (Array.isArray(inp)) {
    // Arrays elements get a ~ prefix and are enclosed in (…)
    str = str.concat(`(${inp.map((e) => `~${cwUrlEncode(e)}`).join('')})`);
  } else if (typeof inp === 'string') {
    // Strings are URL encoded, but then % is replaced with *
    // Also they get a ' prefix
    str = str.concat(
      `'${encodeURIComponent(inp)
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29')
        .replace(/\%/g, '*')}`,
    );
  } else if (typeof inp === 'boolean') {
    str = str.concat(inp ? 'true' : 'false');
  } else if (typeof inp === 'number') {
    str = str.concat(`${inp}`);
  } else if (typeof inp === 'object') {
    // Hashes are enclosed in ~(…)
    str = str.concat('~(');

    Object.keys(inp).forEach((k, i) => {
      // The first key doesn't get a ~, but all others do
      str = str.concat(i === 0 ? '' : '~');
      str = str.concat(k);
      // The key and value are separated by ~
      str = str.concat(`~${cwUrlEncode(inp[k])}`);
    });

    str = str.concat(')');
  }

  // Seems like double ~ collapse down to one?
  return str.replace(/~~/g, '~');
}

/**
 * @param {EventBridgeCloudWatchAlarmsEvent} event
 * @param {DescribeAlarmsOutput} desc
 * @param {DescribeAlarmHistoryOutput} history
 * @returns {String}
 */
function singleMetricAlarmMetricsConsole(event, desc, history) {
  const alarm = desc.MetricAlarms[0];

  const verticals = [];

  if (history?.AlarmHistoryItems?.length) {
    history.AlarmHistoryItems.forEach((i) => {
      // Find all state changes to OK, and create a range from the beginning
      // of the previous state (the start of the alarm) to the beginning of the
      // OK event
      if (i.HistorySummary.includes('to OK')) {
        const data = JSON.parse(i.HistoryData);

        if (
          data?.newState?.stateReasonData?.evaluatedDatapoints?.length &&
          (data?.oldState?.stateReasonData?.startDate ||
            data?.oldState?.stateReasonData?.evaluatedDatapoints?.length)
        ) {
          const startTs = Date.parse(
            data.oldState.stateReasonData.startDate ||
              data.oldState.stateReasonData.evaluatedDatapoints
                .map((d) => d.timestamp)
                .sort()[0],
          );

          const firstOkDatapoint =
            data.newState.stateReasonData.evaluatedDatapoints.sort(
              (a, b) => (a, b) => a.timestamp.localeCompare(b.timestamp),
            )[0];
          const endTs = Date.parse(firstOkDatapoint.timestamp);

          // # is encoded to *23 in the colors
          verticals.push([
            {
              value: new Date(startTs).toISOString(),
              color: '#ff9896'.replace('#', '*23'),
            },
            { value: new Date(endTs).toISOString() },
          ]);
        }
      }
    });

    // If the first (most recent) state change is to ALARM, that means it's
    // ongoing, and should have an unbounded annotation at the righthand end
    // of the timeline
    if (history.AlarmHistoryItems[0].HistorySummary.includes('to ALARM')) {
      const i = history.AlarmHistoryItems[0];

      const data = JSON.parse(i.HistoryData);

      if (
        data?.newState?.stateReasonData?.startDate ||
        data?.newState?.stateReasonData?.evaluatedDatapoints?.length
      ) {
        const startedAt =
          data.newState.stateReasonData.startDate ||
          data.newState.stateReasonData.evaluatedDatapoints
            .map((d) => d.timestamp)
            .sort()[0];

        const startTs = Date.parse(startedAt);

        verticals.push({
          value: new Date(startTs).toISOString(),
          color: '#d62728'.replace('#', '*23'),
          fill: 'after',
        });
      }
    }
  }

  const m = alarm.DatapointsToAlarm || alarm.EvaluationPeriods;
  const n = alarm.EvaluationPeriods;
  const stat = alarm.Statistic ? alarm.Statistic : alarm.ExtendedStatistic;

  return [
    'https://console.aws.amazon.com/cloudwatch/home?',
    `region=${event.region}`,
    '#metricsV2:graph=',
    cwUrlEncode({
      region: event.region,
      title: event.detail.alarmName,
      view: 'timeSeries',
      stacked: false,
      period: alarm.Period,
      start: '-PT3H',
      end: 'P0D',
      annotations: {
        horizontal: [
          {
            label: `${alarm.MetricName} ${ascii(
              alarm.ComparisonOperator,
            )} ${alarm.Threshold} for ${m} datapoints within ${n} periods`,
            value: alarm.Threshold,
          },
        ],
        ...(verticals.length && {
          vertical: verticals,
        }),
      },
      metrics: [
        [
          alarm.Namespace,
          alarm.MetricName,
          ...alarm.Dimensions.reduce((acc, cur) => {
            acc.push(cur.Name);
            acc.push(cur.Value);
            return acc;
          }, []),
          { stat },
        ],
      ],
    }),
  ].join('');
}

/**
 *
 * @param {EventBridgeCloudWatchAlarmsEvent} event
 * @param {DescribeAlarmsOutput} desc
 * @returns {Promise<String>}
 */
async function logsInsightsConsole(event, desc) {
  const logGroup = await logGroupName(event, desc);

  if (!logGroup) {
    return;
  }

  // Default the start time for the logs to when the message gets sent, but use
  // the time when the problem began if it's available.
  let start = new Date().toISOString();
  if (
    event?.detail?.state?.value === 'ALARM' &&
    event?.detail?.state?.reasonData
  ) {
    const stateData = JSON.parse(event.detail.state.reasonData);
    if (stateData?.startDate || stateData?.evaluatedDatapoints?.length) {
      const startedAt =
        stateData.startDate ||
        stateData.evaluatedDatapoints.map((d) => d.timestamp).sort()[0];

      const alarmTime = new Date(Date.parse(startedAt));
      start = alarmTime.toISOString();
    }
  } else if (
    event?.detail?.state?.value === 'OK' &&
    event?.detail?.previousState?.reasonData
  ) {
    const previousData = JSON.parse(event.detail.previousState.reasonData);
    if (previousData?.startDate || previousData?.evaluatedDatapoints?.length) {
      const startedAt =
        previousData.startDate ||
        previousData.evaluatedDatapoints.map((d) => d.timestamp).sort()[0];

      const alarmTime = new Date(Date.parse(startedAt));
      start = alarmTime.toISOString();
    }
  }

  // This is the raw, structured query payload
  const queryPayload = {
    timeType: 'ABSOLUTE',
    tz: 'UTC',
    isLiveTail: false,
    start,
    // Include logs up to when this message gets sent
    end: new Date().toISOString(),
    editorString: 'fields @timestamp, @message | sort @timestamp desc',
    source: [logGroup],
  };

  // The payload is CloudWatch URL encoded
  const encodedPayload = cwUrlEncode(queryPayload);

  // The encoded payload is URL encoded. Non-text characters used in CloudWatch
  // encoding must be encoded.
  const queryParamValue = encodeURIComponent(encodedPayload)
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\~/g, '%7E')
    .replace(/\'/g, '%27')
    .replace(/\*/g, '%2A');

  // The query string is built using the envoded parameter value
  const query = `?queryDetail=${queryParamValue}`;

  // The entire querystring (?foo=bar) is URL encoded, and all % are replaced
  // with $
  const encodedQuery = encodeURIComponent(query).replace(/\%/g, '$');

  // Everything after #logsV2:logs-insights is escaped, and the value of
  // `queryDetail` is escaped again
  return [
    `https://${event.region}.console.aws.amazon.com/cloudwatch/home?`,
    `region=${event.region}`,
    '#logsV2:logs-insights',
    encodedQuery,
  ].join('');
}

/**
 * Returns a URL to CloudWatch Alarms console for the alarm that triggered
 * the event.
 * @param {EventBridgeCloudWatchAlarmsEvent} event
 * @returns {String}
 */
export function alarmConsoleUrl(event) {
  const name = event.detail.alarmName;
  const encoded = encodeURI(name.replace(/\ /g, '+')).replace(/%/g, '$');
  return `https://console.aws.amazon.com/cloudwatch/home?region=${event.region}#alarmsV2:alarm/${encoded}`;
}

/**
 * @param {EventBridgeCloudWatchAlarmsEvent} event
 * @param {DescribeAlarmsOutput} desc
 * @param {DescribeAlarmHistoryOutput} history
 * @returns {String}
 */
export function metricsConsoleUrl(event, desc, history) {
  if (event.detail.configuration.metrics.length === 1) {
    return singleMetricAlarmMetricsConsole(event, desc, history);
  }
}

/**
 * @param {EventBridgeCloudWatchAlarmsEvent} event
 * @param {DescribeAlarmsOutput} desc
 * @returns {Promise<String>}
 */
export async function logsConsoleUrl(event, desc) {
  return await logsInsightsConsole(event, desc);
}

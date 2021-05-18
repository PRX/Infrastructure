/** @typedef {import('./index').EventBridgeCloudWatchAlarmsEvent} EventBridgeCloudWatchAlarmsEvent */

const operators = require('./operators');

/**
 * Serializes the input to a URL string component compatible with the
 * CloudWatch Metrics console graph (i.e., the URL component after graph=).
 * @param {*} inp
 * @returns {String}
 */
function cwmEncode(inp) {
  let str = '';

  if (Array.isArray(inp)) {
    // Arrays elements get a ~ prefix and are enclosed in (…)
    str = str.concat(`(${inp.map((e) => `~${cwmEncode(e)}`).join('')})`);
  } else if (typeof inp === 'string') {
    // Strings are URL encoded, but then % is replaced with *
    // Also they get a ' prefix
    str = str.concat(`'${encodeURIComponent(inp).replace(/\%/g, '*')}`);
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
      str = str.concat(`~${cwmEncode(inp[k])}`);
    });

    str = str.concat(')');
  }

  // Seems like double ~ collapse down to one?
  return str.replace(/~~/g, '~');
}

/**
 * @param {EventBridgeCloudWatchAlarmsEvent} event
 * @param {AWS.CloudWatch.DescribeAlarmsOutput} desc
 * @param {AWS.CloudWatch.DescribeAlarmHistoryOutput} history
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
          data?.newState?.stateReasonData?.startDate &&
          data?.oldState?.stateReasonData?.startDate
        ) {
          const startTs = Date.parse(data.oldState.stateReasonData.startDate);

          const firstOkDatapoint = data.newState.stateReasonData.evaluatedDatapoints.sort(
            (a, b) => a.timestamp.localeCompare(b.timestamp),
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

      if (data?.newState?.stateReasonData?.startDate) {
        const startTs = Date.parse(data.newState.stateReasonData.startDate);

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
    cwmEncode({
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
            label: `${alarm.MetricName} ${operators.ascii(
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

module.exports = {
  /**
   * Returns a URL to CloudWatch Alarms console for the alarm that triggered
   * the event.
   * @param {EventBridgeCloudWatchAlarmsEvent} event
   * @returns {String}
   */
  alarmConsole(event) {
    const name = event.detail.alarmName;
    const encoded = encodeURI(name.replace(/\ /g, '+')).replace(/%/g, '$');
    console.log(encoded);
    return `https://console.aws.amazon.com/cloudwatch/home?region=${event.region}#alarmsV2:alarm/${encoded}`;
  },
  /**
   * @param {EventBridgeCloudWatchAlarmsEvent} event
   * @param {AWS.CloudWatch.DescribeAlarmsOutput} desc
   * @param {AWS.CloudWatch.DescribeAlarmHistoryOutput} history
   * @returns {String}
   */
  metricsConsole(event, desc, history) {
    if (event.detail.configuration.metrics.length === 1) {
      return singleMetricAlarmMetricsConsole(event, desc, history);
    }
  },
};

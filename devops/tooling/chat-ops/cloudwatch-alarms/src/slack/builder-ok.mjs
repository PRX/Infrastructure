/** @typedef {import('./index.mjs').EventBridgeCloudWatchAlarmsEvent} EventBridgeCloudWatchAlarmsEvent */
/** @typedef {import('@aws-sdk/client-cloudwatch').DescribeAlarmsOutput} DescribeAlarmsOutput */
/** @typedef {import('@aws-sdk/client-cloudwatch').DescribeAlarmHistoryOutput} DescribeAlarmHistoryOutput */
/** @typedef {import('@aws-sdk/client-cloudwatch').GetMetricDataOutput} GetMetricDataOutput */
/** @typedef {import('@aws-sdk/client-cloudwatch').CloudWatchClient} CloudWatchClient */

import { ScanBy, GetMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { metricsConsoleUrl, logsConsoleUrl } from './urls.mjs';

/**
 * Returns the number of decimal places in a number
 * e.g., 1 => 0, 1.000 => 0, 1.0001 => 4
 * @param {Number} a
 * @returns {Number}
 */
function precision(a) {
  if (!isFinite(a)) return 0;
  let e = 1;
  let p = 0;
  while (Math.round(a * e) / e !== a) {
    e *= 10;
    p++;
  }
  return p;
}

/**
 * Returns the timestamp in milliseconds for when the alarm condition ended, if
 * possible
 * @param {EventBridgeCloudWatchAlarmsEvent} event
 * @returns {Number}
 */
function conditionOkTime(event) {
  if (event?.detail?.state?.timestamp) {
    return Date.parse(event.detail.state.timestamp);
  }
}

/**
 * Returns the timestamp in milliseconds for when the alarm condition started,
 * if possible
 * @param {EventBridgeCloudWatchAlarmsEvent} event
 * @returns {Number}
 */
function conditionAlarmTime(event) {
  if (event?.detail?.previousState?.reasonData) {
    const previousData = JSON.parse(event.detail.previousState.reasonData);

    if (previousData?.startDate) {
      // If there's a startDate on the previous state, we can assume that is
      // the start of the issue
      return Date.parse(previousData.startDate);
    } else if (previousData?.evaluatedDatapoints?.length) {
      // There are times where there won't be a startDate, but there will
      // be datapoints related to the start of the issue. Use the oldest
      // value as an estimate.
      const pts = previousData.evaluatedDatapoints
        .filter((p) => p.timestamp)
        .map((p) => p.timestamp)
        .sort();

      if (pts.length) {
        return Date.parse(pts[0]);
      }
    }
  }
}

/**
 *
 * @param {EventBridgeCloudWatchAlarmsEvent} event
 * @param {CloudWatchClient} cloudWatchClient
 * @param {DescribeAlarmsOutput} desc
 * @param {Date} startTime
 * @param {Date} endTime
 * @returns {Promise<GetMetricDataOutput>}
 */
async function metricData(event, cloudWatchClient, desc, startTime, endTime) {
  const queryMetric = {};

  if (desc.MetricAlarms[0].Namespace) {
    queryMetric.Namespace = desc.MetricAlarms[0].Namespace;
  }

  if (desc.MetricAlarms[0].MetricName) {
    queryMetric.MetricName = desc.MetricAlarms[0].MetricName;
  }

  if (desc.MetricAlarms[0].Dimensions) {
    queryMetric.Dimensions = desc.MetricAlarms[0].Dimensions;
  }

  const params = {
    StartTime: startTime,
    EndTime: endTime,
    ScanBy: ScanBy.TIMESTAMP_ASCENDING,
    MetricDataQueries: [
      {
        Id: 'alarmMetricData',
        MetricStat: {
          Metric: queryMetric,
          Period: event.detail.configuration.metrics[0].metricStat.period,
          Stat: event.detail.configuration.metrics[0].metricStat.stat,
        },
      },
    ],
  };

  return cloudWatchClient.send(new GetMetricDataCommand(params));
}

/**
 * Returns a string that include the duration of the alarm if enough data
 * is available to calculate it
 * @param {EventBridgeCloudWatchAlarmsEvent} event
 * @returns {String}
 */
function duration(event) {
  const okTime = conditionOkTime(event);
  const alarmTime = conditionAlarmTime(event);

  // If there's enough data to compute the duration of the alarm, include
  // that in the message
  if (okTime && alarmTime) {
    const dif = okTime - alarmTime;
    const difSec = dif / 1000;

    let duration = difSec;
    let durationUnit = 'seconds';

    if (difSec >= 3600) {
      duration = Math.round(difSec / 3600);
      durationUnit = 'hours';
    } else if (difSec >= 60) {
      duration = Math.round(difSec / 60);
      durationUnit = 'minutes';
    }

    return `*Alarm duration:* ${duration} ${durationUnit} | `;
  }

  return '';
}

/**
 * Returns basic details of the alarm notification, like duration and links
 * to CloudWatch console pages.
 * @param {EventBridgeCloudWatchAlarmsEvent} event
 * @param {DescribeAlarmsOutput} desc
 * @param {DescribeAlarmHistoryOutput} history
 * @returns {Promise<String[]>}
 */
async function basics(event, desc, history) {
  let line = '';

  line = line.concat(duration(event));

  // Can always generate the CloudWatch Metrics link
  const metricsUrl = metricsConsoleUrl(event, desc, history);
  line = line.concat(`*CloudWatch:* <${metricsUrl}|Metrics>`);

  // Not all alarms can be associated with logs, so only add when there
  // is a URL to use
  const logsUrl = await logsConsoleUrl(event, desc);
  if (logsUrl) {
    line = line.concat(` • <${logsUrl}|Logs>`);
  }

  return [line];
}

/**
 * Returns a list of datapoints for the alarm metric during the alarm condition
 * that is ending. The list is truncated and sorted in some cases, depending
 * on the type of alarm and the total number of values.
 * @param {EventBridgeCloudWatchAlarmsEvent} event
 * @param {DescribeAlarmsOutput} desc
 * @param {CloudWatchClient} cloudWatchClient
 * @returns {Promise<String[]>}
 */
async function datapoints(event, desc, cloudWatchClient) {
  const okTime = conditionOkTime(event);
  const alarmTime = conditionAlarmTime(event);

  if (okTime && alarmTime) {
    // TODO Move this to a single-metric specific builder
    if (event.detail.configuration.metrics.length === 1) {
      // Use more complete set of metric data for the duration of the alarm
      // to provide some more details
      const alarmMetricData = await metricData(
        event,
        cloudWatchClient,
        desc,
        new Date(alarmTime),
        new Date(okTime),
      );

      const rawValues = alarmMetricData.MetricDataResults?.[0]?.Values;

      if (rawValues.length) {
        const maxDigits = 4;
        let qualifier = 'Datapoints';

        // In some cases we don't want to display all the values, such as if
        // there are hundreds, so a subset are chosen to display.
        let sortedValues = rawValues;

        // Display a maximum number of data points
        const cap = 8;

        if (rawValues.length > cap) {
          if (
            ['GreaterThanOrEqualToThreshold', 'GreaterThanThreshold'].includes(
              desc.MetricAlarms[0].ComparisonOperator,
            )
          ) {
            qualifier = `Highest ${cap} of ${rawValues.length} datapoints`;
            sortedValues = rawValues.sort((a, b) => b - a);
          }

          if (
            ['LessThanOrEqualToThreshold', 'LessThanThreshold'].includes(
              desc.MetricAlarms[0].ComparisonOperator,
            )
          ) {
            qualifier = `Lowest ${cap} of ${rawValues.length} datapoints`;
            sortedValues = rawValues.sort((a, b) => a - b);
          }
        }

        const points = sortedValues.slice(0, cap).map((v) => {
          let pThreshold = 3;

          if (
            desc?.MetricAlarms?.[0]?.Threshold ||
            desc?.MetricAlarms?.[0]?.Threshold === 0
          ) {
            pThreshold = precision(desc.MetricAlarms[0].Threshold);
          }

          const pDatapoint = precision(v);

          // Print the datapoint values with at most 4 decimal points, and at
          // least the number of decimals in the datapoint or threshold
          // value, whichever is larger.
          const digits = Math.min(maxDigits, Math.max(pDatapoint, pThreshold));
          return `\`${v.toFixed(digits)}\``;
        });

        // Add a unit label if it's anything other than Count
        let unit = '';
        if (
          desc.MetricAlarms[0].Unit &&
          desc.MetricAlarms[0].Unit !== 'Count' &&
          desc.MetricAlarms[0].Unit !== 'None'
        ) {
          unit = ` ${desc.MetricAlarms[0].Unit.toLowerCase()}`;
        }
        return [`*${qualifier} during alarm:* ${points.join(', ')}${unit}`];
      }
    }
  }

  return [];
}

/**
 * @param {EventBridgeCloudWatchAlarmsEvent} event
 * @param {DescribeAlarmsOutput} desc
 * @param {DescribeAlarmHistoryOutput} history
 * @param {CloudWatchClient} cloudWatchClient
 * @returns {Promise<String[]>}
 */
export async function detailLines(event, desc, history, cloudWatchClient) {
  return [
    ...(await basics(event, desc, history)),
    ...(await datapoints(event, desc, cloudWatchClient)),
  ];
}

/** @typedef {import('../index.mjs').EventBridgeCloudWatchAlarmsEvent} EventBridgeCloudWatchAlarmsEvent */
/** @typedef {import('@aws-sdk/client-cloudwatch').DescribeAlarmsOutput} DescribeAlarmsOutput */
/** @typedef {import('@aws-sdk/client-cloudwatch').DescribeAlarmHistoryOutput} DescribeAlarmHistoryOutput */
/** @typedef {import('@aws-sdk/client-cloudwatch').MetricAlarm} MetricAlarm */

import { comparison } from '../operators.mjs';
import { metricsConsoleUrl, logsConsoleUrl } from '../urls.mjs';

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
 * @param {EventBridgeCloudWatchAlarmsEvent} event
 * @param {DescribeAlarmsOutput} desc
 * @param {DescribeAlarmHistoryOutput} history
 * * @returns {Promise<String[]>}
 */
async function started(event, desc, history) {
  if (event.detail.state.reasonData) {
    const data = JSON.parse(event.detail.state.reasonData);

    if (data?.startDate || data?.evaluatedDatapoints?.length) {
      const now = +new Date();

      const startedAt =
        data.startDate ||
        data.evaluatedDatapoints
          .map((d) => d.timestamp)
          .sort((a, b) => b - a)[0];
      const startTime = Date.parse(startedAt);

      const dif = now - startTime;
      const difSec = dif / 1000;

      let duration = difSec;
      let durationUnit = 'seconds';

      if (difSec >= 86400) {
        duration = Math.round(difSec / 86400);
        durationUnit = 'days';
      } else if (difSec >= 3600) {
        duration = Math.round(difSec / 3600);
        durationUnit = 'hours';
      } else if (difSec >= 60) {
        duration = Math.round(difSec / 60);
        durationUnit = 'minutes';
      }

      const metricsUrl = metricsConsoleUrl(event, desc, history);

      let console = `*CloudWatch:* <${metricsUrl}| Metrics>`;

      const logsUrl = await logsConsoleUrl(event, desc);
      if (logsUrl) {
        console = console.concat(` • <${logsUrl}|Logs>`);
      }

      return [`*Started:* ${duration} ${durationUnit} ago | ${console}`];
    }
  }

  return [];
}

/**
 * Returns the datapoints that were evaluated and caused the alarm to move to
 * an ALARM state
 * @param {EventBridgeCloudWatchAlarmsEvent} event
 * @param {DescribeAlarmsOutput} desc
 * @returns {String[]}
 */
function datapoints(event, desc) {
  if (event.detail.state.reasonData) {
    const data = JSON.parse(event.detail.state.reasonData);

    if (data?.evaluatedDatapoints?.length) {
      const pointsWithValues = data.evaluatedDatapoints.filter((p) => p.value);

      if (pointsWithValues.length) {
        const maxDigits = 4;

        const points = pointsWithValues
          .map((p) => {
            let pThreshold = 3;

            if (
              desc?.MetricAlarms?.[0]?.Threshold ||
              desc?.MetricAlarms?.[0]?.Threshold === 0
            ) {
              pThreshold = precision(desc.MetricAlarms[0].Threshold);
            }

            const pDatapoint = precision(p.value);

            // Print the datapoint values with at most 4 decimal points, and at
            // least the number of decimals in the datapoint or threshold
            // value, whichever is larger.
            const digits = Math.min(
              maxDigits,
              Math.max(pDatapoint, pThreshold),
            );
            return `\`${p.value.toFixed(digits)}\``;
          })
          .reverse();

        // Add a unit label if it's anything other than Count
        let unit = '';
        if (
          desc.MetricAlarms[0].Unit &&
          desc.MetricAlarms[0].Unit !== 'Count' &&
          desc.MetricAlarms[0].Unit !== 'None'
        ) {
          unit = ` ${desc.MetricAlarms[0].Unit.toLowerCase()}`;
        }
        return [`*Datapoints:* ${points.join(', ')}${unit}`];
      }
    }
  }

  return [];
}

/**
 * Returns information about the number of times the alarm has had a to ALARM
 * state change in the last 24 hours
 * @param {DescribeAlarmHistoryOutput} history
 * @returns {String[]}
 */
function last24Hours(history) {
  if (history?.AlarmHistoryItems.length) {
    const alarms = history.AlarmHistoryItems.filter((i) =>
      i.HistorySummary.includes('to ALARM'),
    );

    return [`*Last 24 hours:* ${alarms.length} alarms`];
  }

  return [];
}

/**
 * Returns the relevant statistic for the alarm, which is either a basic
 * stat, like Sum, Average, Minimum, or an extended stat, like a percentile.
 * Statistics and extended statistics are mutually exclusive; an alarm will
 * only ever have one or the other.
 * @param {MetricAlarm} alarm
 * @returns {String}
 */
function alarmStatistic(alarm) {
  return alarm.ExtendedStatistic ? alarm.ExtendedStatistic : alarm.Statistic;
}

/**
 * Describes the relationship of the overall evaluation period and the number
 * of datapoints within the evaluation period that breached the threshold.
 * @param {Number} periodInSeconds
 * @param {Number} evaluationPeriods
 * @param {Number} datapointsToAlarm
 * @param {Number} evaluationInterval
 * @returns {String}
 */
function evaluationSummary(
  periodInSeconds,
  evaluationPeriods,
  datapointsToAlarm,
  evaluationInterval,
) {
  let interval = evaluationInterval;
  let intervalUnits = 'seconds';

  if (evaluationInterval >= 60) {
    interval = Math.round(evaluationInterval / 60);
    intervalUnits = 'minutes';
  }

  let period = periodInSeconds;
  let periodUnit = 'second';

  if (periodInSeconds >= 60) {
    period = Math.round(period / 60);
    periodUnit = 'minute';
  }

  if (evaluationPeriods === 1) {
    // Entire threshold breach was a single period/datapoint
    return `for at least one ${period} ${periodUnit} period`;
  } else if (datapointsToAlarm === evaluationPeriods) {
    // Threshold breach was multiple, consecutive periods
    return `for ${evaluationPeriods} consecutive ${period} ${periodUnit} periods`;
  } else {
    // Threshold breach was "M of N" periods
    return `for at least ${datapointsToAlarm} ${period} ${periodUnit} periods in ${interval} ${intervalUnits}`;
  }
}

/**
 * @param {EventBridgeCloudWatchAlarmsEvent} event
 * @param {DescribeAlarmsOutput} desc
 * @param {DescribeAlarmHistoryOutput} history
 * @returns {String[]}
 */
function cause(event, desc, history) {
  const alarm = desc.MetricAlarms[0];

  const period = alarm.Period;
  const evaluationPeriods = alarm.EvaluationPeriods;
  const datapointsToAlarm = alarm.DatapointsToAlarm || evaluationPeriods;
  const evaluationInterval = period * evaluationPeriods;

  return [
    [
      '*Cause:*',

      // E.g., Average, Sum, p99
      alarmStatistic(alarm),

      // E.g., HTTPCode_ELB_5XX_Count, CPUUtilization
      `of \`${alarm.MetricName}\` metric was`,

      // E.g., ≥ 150
      `\`${comparison(alarm.ComparisonOperator)} ${alarm.Threshold}\``,

      // A human-readable summary of the interval evaluation
      evaluationSummary(
        period,
        evaluationPeriods,
        datapointsToAlarm,
        evaluationInterval,
      ),
    ]
      .join(' ')
      .trim(),
  ];
}

/**
 * @param {EventBridgeCloudWatchAlarmsEvent} event
 * @param {DescribeAlarmsOutput} desc
 * @param {DescribeAlarmHistoryOutput} history
 * @returns {Promise<String[]>}
 */
export async function detailLines(event, desc, history) {
  return [
    ...cause(event, desc, history),
    ...(await started(event, desc, history)),
    ...datapoints(event, desc),
    ...last24Hours(history),
  ];
}

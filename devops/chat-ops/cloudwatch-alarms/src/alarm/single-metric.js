/** @typedef {import('../index').EventBridgeCloudWatchAlarmsEvent} EventBridgeCloudWatchAlarmsEvent */

const operators = require('../operators');
const urls = require('../urls');

function started(event) {
  if (event.detail.state.reasonData) {
    const data = JSON.parse(event.detail.state.reasonData);

    if (data?.startDate) {
      const now = +new Date();
      const startTime = Date.parse(data.startDate);

      const dif = now - startTime;
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

      return [`*Started:* ${duration} ${durationUnit} ago`];
    }
  }

  return [];
}

/**
 * Returns the datapoints that were evaluated and caused the alarm to move to
 * an ALARM state
 * @param {EventBridgeCloudWatchAlarmsEvent} event
 * @returns {String[]}
 */
function datapoints(event) {
  if (event.detail.state.reasonData) {
    const data = JSON.parse(event.detail.state.reasonData);

    if (data?.evaluatedDatapoints?.length) {
      const pointsWithValues = data.evaluatedDatapoints.filter((p) => p.value);

      if (pointsWithValues.length) {
        const points = pointsWithValues.map((p) => `\`${p.value}\``).reverse();

        return [`*Datapoints:* ${points.join(', ')}`];
      }
    }
  }

  return [];
}

/**
 * Returns information about the number of times the alarm has had a to ALARM
 * state change in the last 24 hours
 * @param {AWS.CloudWatch.DescribeAlarmHistoryOutput} history
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
 * @param {AWS.CloudWatch.MetricAlarm} alarm
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
 * @param {AWS.CloudWatch.DescribeAlarmsOutput} desc
 * @param {AWS.CloudWatch.DescribeAlarmHistoryOutput} history
 * * @returns {String[]}
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

      // E.g., <, >
      operators.comparison(alarm.ComparisonOperator),

      // The threshold value for the alarm
      `\`${alarm.Threshold}\``,

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
 * @param {AWS.CloudWatch.DescribeAlarmsOutput} desc
 * @param {AWS.CloudWatch.DescribeAlarmHistoryOutput} history
 * * @returns {String[]}
 */
function links(event, desc, history) {
  const metricsUrl = urls.metricsConsole(event, desc, history);

  return [`View in: <${metricsUrl}|CloudWatch Metrics>`];
}

module.exports = {
  /**
   * @param {EventBridgeCloudWatchAlarmsEvent} event
   * @param {AWS.CloudWatch.DescribeAlarmsOutput} desc
   * @param {AWS.CloudWatch.DescribeAlarmHistoryOutput} history
   * @returns {String[]}
   */
  detailLines(event, desc, history) {
    return [
      event.detail.configuration.description,
      ...cause(event, desc, history),
      ...started(event),
      ...datapoints(event),
      ...last24Hours(history),
      ...links(event, desc, history),
    ];
  },
};

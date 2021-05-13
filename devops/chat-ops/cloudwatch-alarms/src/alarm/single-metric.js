/** @typedef {import('../index').EventBridgeCloudWatchAlarmsEvent} EventBridgeCloudWatchAlarmsEvent */

const operators = require('../operators');
const urls = require('../urls');

/**
 * Returns the datapoints that were evaluated and caused the alarm to move to
 * an ALARM state
 * @param {EventBridgeCloudWatchAlarmsEvent} event
 * @returns {String[]}
 */
function datapoints(event) {
  if (event.detail.state.reasonData) {
    const data = JSON.parse(event.detail.state.reasonData);
    const points = data.evaluatedDatapoints
      .map((p) => `\`${p.value}\``)
      .reverse();

    return [`*Datapoints:* ${points.join(', ')}`];
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
 * @param {Number} evaluationPeriods
 * @param {Number} datapointsToAlarm
 * @param {Number} evaluationInterval
 * @returns {String}
 */
function evaluationSummary(
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

  if (evaluationPeriods === 1) {
    // Entire threshold breach was a single period/datapoint
    return '';
  } else if (datapointsToAlarm === evaluationPeriods) {
    // Threshold breach was multiple, consecutive periods
    return `for ${interval} consecutive ${intervalUnits}`;
  } else {
    // Threshold breach was "M of N" periods
    return `at least ${datapointsToAlarm} times in ${interval} ${intervalUnits}`;
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

      // The duration of each data point, e.g., "30 second" or "5 minute"
      period >= 60 ? `${Math.round(period / 60)} minute` : `${period} second`,

      // E.g., HTTPCode_ELB_5XX_Count, CPUUtilization
      `\`${alarm.MetricName}\``,

      // E.g., average, sum, p99
      alarmStatistic(alarm).toLowerCase(),

      // E.g., <, >
      operators.comparison(alarm.ComparisonOperator),

      // The threshold value for the alarm
      `\`${alarm.Threshold}\``,

      // A human-readable summary of the interval evaluation
      evaluationSummary(
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
      ...datapoints(event),
      ...last24Hours(history),
      ...links(event, desc, history),
    ];
  },
};

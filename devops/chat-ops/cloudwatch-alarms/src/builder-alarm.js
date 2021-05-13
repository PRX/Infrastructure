/** @typedef {import('./index').EventBridgeCloudWatchAlarmsEvent} EventBridgeCloudWatchAlarmsEvent */

const singleMetric = require('./alarm/single-metric');

module.exports = {
  /**
   * @param {EventBridgeCloudWatchAlarmsEvent} event
   * @param {AWS.CloudWatch.DescribeAlarmsOutput} desc
   * @param {AWS.CloudWatch.DescribeAlarmHistoryOutput} history
   * @returns {String[]}
   */
  detailLines(event, desc, history) {
    if (event.detail.configuration.metrics.length === 1) {
      return singleMetric.detailLines(event, desc, history);
    } else {
      return ['Unknown alarm metric type!'];
    }
  },
};

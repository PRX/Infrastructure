/** @typedef {import('./index').EventBridgeCloudWatchAlarmsEvent} EventBridgeCloudWatchAlarmsEvent */
/** @typedef {import('@aws-sdk/client-cloudwatch').DescribeAlarmsOutput} DescribeAlarmsOutput */
/** @typedef {import('@aws-sdk/client-cloudwatch').DescribeAlarmHistoryOutput} DescribeAlarmHistoryOutput */

const singleMetric = require('./alarm/single-metric');

module.exports = {
  /**
   * @param {EventBridgeCloudWatchAlarmsEvent} event
   * @param {DescribeAlarmsOutput} desc
   * @param {DescribeAlarmHistoryOutput} history
   * @returns {Promise<String[]>}
   */
  async detailLines(event, desc, history) {
    if (event.detail.configuration.metrics.length === 1) {
      return await singleMetric.detailLines(event, desc, history);
    } else {
      return ['Unknown alarm metric type!'];
    }
  },
};

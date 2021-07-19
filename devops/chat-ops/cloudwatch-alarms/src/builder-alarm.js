/** @typedef {import('./index').EventBridgeCloudWatchAlarmsEvent} EventBridgeCloudWatchAlarmsEvent */

const singleMetric = require('./alarm/single-metric');

module.exports = {
  /**
   * @param {EventBridgeCloudWatchAlarmsEvent} event
   * @param {AWS.CloudWatch.DescribeAlarmsOutput} desc
   * @param {AWS.CloudWatch.DescribeAlarmHistoryOutput} history
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

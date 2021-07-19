/** @typedef {import('./index').EventBridgeCloudWatchAlarmsEvent} EventBridgeCloudWatchAlarmsEvent */

const urls = require('./urls');

module.exports = {
  /**
   * @param {EventBridgeCloudWatchAlarmsEvent} event
   * @param {AWS.CloudWatch.DescribeAlarmsOutput} desc
   * @param {AWS.CloudWatch.DescribeAlarmHistoryOutput} history
   * @returns {Promise<String[]>}
   */
  async detailLines(event, desc, history) {
    let line = '';

    // If there's enough data to compute the duration of the alarm, include
    // that in the message
    if (
      event?.detail?.state?.timestamp &&
      event?.detail?.previousState?.reasonData
    ) {
      const okTime = Date.parse(event.detail.state.timestamp);

      const previousData = JSON.parse(event.detail.previousState.reasonData);
      let alarmTime;

      if (previousData?.startDate) {
        // If there's a startDate on the previous state, we can assume that is
        // the start of the issue
        alarmTime = Date.parse(previousData.startDate);
      } else if (previousData?.evaluatedDatapoints?.length) {
        // There are times where there won't be a startDate, but there will
        // be datapoints related to the start of the issue. Use the oldest
        // value as an estimate.
        const pts = previousData.evaluatedDatapoints
          .filter((p) => p.timestamp)
          .map((p) => p.timestamp)
          .sort();

        if (pts.length) {
          alarmTime = Date.parse(pts[0]);
        }
      }

      if (alarmTime) {
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

        line = line.concat(`*Alarm duration:* ${duration} ${durationUnit} | `);
      }
    }

    // Can always generate the CloudWatch Metrics link
    const metricsUrl = urls.metricsConsole(event, desc, history);
    line = line.concat(`*CloudWatch:* <${metricsUrl}|Metrics>`);

    // Not all alarms can be associated with logs, so only add when there
    // is a URL to use
    const logsUrl = await urls.logsConsole(event, desc);
    if (logsUrl) {
      line = line.concat(` • <${logsUrl}|Logs>`);
    }

    return [line];
  },
};

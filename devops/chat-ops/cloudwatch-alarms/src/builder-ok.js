/** @typedef {import('./index').EventBridgeCloudWatchAlarmsEvent} EventBridgeCloudWatchAlarmsEvent */

const urls = require('./urls');

module.exports = {
  /**
   * @param {EventBridgeCloudWatchAlarmsEvent} event
   * @param {AWS.CloudWatch.DescribeAlarmsOutput} desc
   * @param {AWS.CloudWatch.DescribeAlarmHistoryOutput} history
   * @returns {String[]}
   */
  detailLines(event, desc, history) {
    if (event.detail?.previousState?.reasonData) {
      const previousData = JSON.parse(event.detail.previousState.reasonData);

      if (event?.detail?.state?.timestamp && previousData?.startDate) {
        const okTime = Date.parse(event.detail.state.timestamp);
        const alarmTime = Date.parse(previousData.startDate);
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

        const metricsUrl = urls.metricsConsole(event, desc, history);

        let console = `*CloudWatch:* <${metricsUrl}|Metrics>`;

        const logsUrl = urls.logsConsole(event, desc);
        if (logsUrl) {
          console = console.concat(` • <${logsUrl}|Logs>`);
        }

        return [`*Alarm duration:* ${duration} ${durationUnit} | ${console}`];
      }
    }

    return ['No data.'];
  },
};

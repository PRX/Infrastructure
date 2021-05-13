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
    if (
      event.detail?.previousState?.reasonData &&
      event.detail?.state?.reasonData
    ) {
      const stateData = JSON.parse(event.detail.state.reasonData);
      const previousData = JSON.parse(event.detail.previousState.reasonData);

      if (stateData?.startDate && previousData?.startDate) {
        const okTime = Date.parse(stateData.startDate);
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

        const url = urls.metricsConsole(event, desc, history);

        return [
          `*Alarm duration:* ${duration} ${durationUnit} | View in: <${url}|CloudWatch Metrics>`,
        ];
      }
    }

    return [];
  },
};

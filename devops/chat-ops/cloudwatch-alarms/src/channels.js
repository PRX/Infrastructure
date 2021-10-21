/** @typedef {import('./index').EventBridgeCloudWatchAlarmsEvent} EventBridgeCloudWatchAlarmsEvent */

module.exports = {
  /**
   * @param {EventBridgeCloudWatchAlarmsEvent} event
   * @returns {String} A Slack channel identifier
   */
  channel(event) {
    const name = event.detail.alarmName;

    if (name.startsWith('FATAL')) {
      return '#ops-fatal';
    } else if (name.startsWith('ERROR')) {
      return '#ops-error';
    }
    // } else if (name.startsWith('WARN')) {
    //   return '#ops-warn';
    // } else if (name.startsWith('INFO')) {
    //   return '#ops-info';
    // } else if (name.startsWith('CRITICAL')) {
    //   return '#ops-info';
    // } else if (name.startsWith('MAJOR')) {
    //   return '#ops-info';
    // } else if (name.startsWith('MINOR')) {
    //   return '#ops-info';
    // }

    return '#sandbox2';
  },
};

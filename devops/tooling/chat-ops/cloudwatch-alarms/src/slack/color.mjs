/** @typedef {import('./index.mjs').EventBridgeCloudWatchAlarmsEvent} EventBridgeCloudWatchAlarmsEvent */

/**
 * @param {EventBridgeCloudWatchAlarmsEvent} event
 * @returns {String} A hex color value
 */
export function value(event) {
  switch (event.detail.state.value) {
    case 'OK':
      return '#2eb886';
    case 'ALARM':
      return '#a30200';
    case 'INSUFFICIENT_DATA':
      return '#daa038';
    default:
      return '#daa038';
  }
}

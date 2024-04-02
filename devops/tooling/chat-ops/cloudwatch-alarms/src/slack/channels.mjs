/** @typedef {import('./index.mjs').EventBridgeCloudWatchAlarmsEvent} EventBridgeCloudWatchAlarmsEvent */

/**
 * @param {EventBridgeCloudWatchAlarmsEvent} event
 * @returns {String} A Slack channel identifier
 */
export function channel(event) {
  const name = event.detail.alarmName;

  if (name.startsWith('FATAL')) {
    return 'G2QH13X62'; // #ops-fatal
  } else if (name.startsWith('ERROR')) {
    return 'G2QH6NMEH'; // #ops-error
  } else if (name.startsWith('WARN')) {
    return 'G2QHC2N7K'; // #ops-warn
  } else if (name.startsWith('INFO')) {
    return 'G2QHBL6UX'; // #ops-info
  } else if (name.startsWith('CRITICAL')) {
    return 'G2QH13X62'; // #ops-fatal
  } else if (name.startsWith('MAJOR')) {
    return 'G2QH6NMEH'; // #ops-error
  } else if (name.startsWith('MINOR')) {
    return 'G2QHC2N7K'; // #ops-warn
  }

  return '#sandbox2';
}

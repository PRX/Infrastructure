/**
 * Returns a URL to CloudWatch Alarms console for the alarm that triggered
 * the event.
 * @param {*} alarmDetail
 * @returns {String}
 */
export function alarmConsole(alarmDetail) {
  const name = alarmDetail.AlarmName;
  const region = alarmDetail.AlarmArn.split(':')[3];
  const encoded = encodeURI(name.replace(/\ /g, '+')).replace(/%/g, '$');
  return `https://console.aws.amazon.com/cloudwatch/home?region=${region}#alarmsV2:alarm/${encoded}`;
}

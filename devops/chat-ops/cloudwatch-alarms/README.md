Calculating alarm duration from the EventBridge event, under normal circumstances where the state change is from ALARM to OK:

`detail.state.timestamp`: The time the CloudWatch considers the state change to actually have happened; i.e., the alarm became OK at that time.
`detail.state.reasonData.startDate`: This is usually time of the most recent datapoint that contributed to the alarm condition, but does not indicate the end of the alarm condition or alarm state. When _missing data_ is treated as NotBreaching, there won't be any evaluated datapoints that explicitly contribute to the alarm evaluation, so this `startDate` could be a time doesn't appear in the `evaluatedDatapoints` list.
`detail.state.reasonData.queryDate`: Unknown
`detail.previousState.reasonData.evaluatedDatapoints[].timestamp`: The recorded time for individual datapoints that were evaluated as creating the OK condition.

`detail.previousState.timestamp`: When the alarm became in alarm, NOT when the datapoints started to breach the threshold.
`detail.previousState.reasonData.evaluatedDatapoints[].timestamp`: The recorded time for individual datapoints that breached the alarm's threshold.
`detail.previousState.reasonData.startDate`: This should be same as the timestamp of the earliest evaluated datapoint, and could be considered the start of the alarm condition (though not the start of the alarm state). When _missing data_ is treated as bad, there won't be any evaluated datapoints that explicitly contribute to the alarm evaluation, so this `startDate` could be a time that doesn't appear in the `evaluatedDatapoints` list.
`detail.previousState.reasonData.queryDate`: Unknown

General calculation for alarm duration would be:
`detail.state.timestamp` - `detail.previousState.reasonData.startDate`

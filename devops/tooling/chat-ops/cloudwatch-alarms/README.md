#### Calculating alarm duration from the EventBridge event, under normal circumstances where the state change is from ALARM to OK:

`detail.state.timestamp`: The time the CloudWatch considers the state change to actually have happened; i.e., the alarm became OK at that time. (I.e, the end of the problem.)
`detail.state.reasonData.startDate`: This is usually time of the most recent datapoint that contributed to the alarm condition, but does not indicate the end of the alarm condition or alarm state. When _missing data_ is treated as NotBreaching, there won't be any evaluated datapoints that explicitly contribute to the alarm evaluation, so this `startDate` could be a time doesn't appear in the `evaluatedDatapoints` list.
`detail.state.reasonData.queryDate`: Unknown
`detail.previousState.reasonData.evaluatedDatapoints[].timestamp`: The recorded time for individual datapoints that were evaluated as creating the OK condition.

`detail.previousState.timestamp`: When the alarm became in alarm, NOT when the datapoints started to breach the threshold.
`detail.previousState.reasonData.evaluatedDatapoints[]`: These are ONLY the data points that originally evaluated to cause the alarm condition, NOT all the data points that exist for the duration of the condition.
`detail.previousState.reasonData.evaluatedDatapoints[].timestamp`: The recorded time for individual datapoints that breached the alarm's threshold.
`detail.previousState.reasonData.startDate`: This should be same as the timestamp of the earliest evaluated datapoint, and could be considered the start of the alarm condition (though not the start of the alarm state). When _missing data_ is treated as bad, there won't be any evaluated datapoints that explicitly contribute to the alarm evaluation, so this `startDate` could be a time that doesn't appear in the `evaluatedDatapoints` list. (I.e., the start of the problem.) Sometimes this won't exist, even when there are evaluatedDatapoints with timestamps.
`detail.previousState.reasonData.queryDate`: Unknown

General calculation for alarm duration would be:
`detail.state.timestamp` - `detail.previousState.reasonData.startDate`

#### For a to ALARM event

`detail.state.reasonData.startDate`: The time of the first datapoint (or missing datapoint) that contributed to the alarm condition. (I.e., the start of the problem.) Sometimes this won't exist, even when there are evaluatedDatapoints with timestamps.


## Broken links

- `https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#metricsV2:graph=~(region~'us-east-1~title~'*5bDovetail*5d*5bALB*5d*5bError*5d*20LB*205XX~view~'timeSeries~stacked~false~period~60~start~'-PT3H~end~'P0D~annotations~(horizontal~(~(label~'HTTPCode_ELB_5XX_Count*20*3e*205*20for*202*20datapoints*20within*202*20periods~value~5))~vertical~(~(~(value~'2021-05-14T11*3a18*3a00.000Z~color~'*23d62728)~(value~'2021-05-14T11*3a20*3a00.000Z~color~'*23d62728))~(~(value~'2021-05-14T09*3a13*3a00.000Z~color~'*23d62728)~(value~'2021-05-14T09*3a19*3a00.000Z~color~'*23d62728))~(~(value~'2021-05-14T08*3a45*3a00.000Z~color~'*23d62728)~(value~'2021-05-14T08*3a51*3a00.000Z~color~'*23d62728))~(~(value~'2021-05-13T17*3a17*3a00.000Z~color~'*23d62728)~(value~'2021-05-13T17*3a21*3a00.000Z~color~'*23d62728))~(~(value~'2021-05-13T06*3a56*3a00.000Z~color~'*23d62728)~(value~'2021-05-13T07*3a01*3a00.000Z~color~'*23d62728))~(~(value~'2021-05-14T12*3a31*3a00.000Z~color~'*23d62728~fill~'after))))~metrics~(~(~'AWS*2fApplicationELB~'HTTPCode_ELB_5XX_Count~'LoadBalancer~'app*2finfra-Dovet-1JUJPS3P3XEJ3*2f3bff3df0ed15de7f~(stat~'Sum))))`

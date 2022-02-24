### Lambda Event

`event.json` is the object that the Lambda function receives. It is a standard SNS-to-Lambda payload.

### CloudFormation Notifications

The `Message` body of the event is the actual CloudFormation notification. It is line-delimited data of the format `Key='Value'`.

It includes details about a specific event or state change within CloudFormation, such as a `Timestamp`, the `StackId` where the event originated, the `ResourceType` of the resource associated with event, etc.

### Resource Properties

The CloudFormation notification includes a `ResourceProperties` value, which matches the `Properties` defined on the resource in the template, represented as JSON. For example, the properties for an SNS topic may look like this:

```json
{
  "Tags" : [ "Key": "MyKey", "Value": "Some key value" ],
  "TopicName" : "MyTopicName"
}
```

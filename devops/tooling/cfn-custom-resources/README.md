```yaml
Resources:
  MyTags:
    Type: Custom::CloudWatchAlarmTags
    Properties:
      ServiceToken: arn:aws:lambda:ca-central-1:578003269847:function:StackSet-cfn-custom-resou-CloudWatchAlarmTaggerFun-BY3KGvhxtgfW
      AlarmArn: !GetAtt MyAlarm.Arn
      Tags:
        - { Key: my-tag, Value: tktktk }
```

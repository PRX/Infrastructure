# PRX-Utility-2021-06-22

Provides some general-purpose whole-template transformations.

## Pseudo parameters

Adds the following pseudo parameters:

- `PRX::AWSOrganizationID` – e.g., `"o-abcde12345"`
- `PRX::Timestamp` – The integer number of seconds since 1970 as a string (e.g., `"1643398521"`)

These pseudo parameters are only compatible with the full function notation for `Ref`. The short form (`!Ref`) will not work.

```yaml
MyRole:
  Type: AWS::IAM::Role
  Properties:
    AssumeRolePolicyDocument:
      Version: "2012-10-17"
      Statement:
        - Action: sts:AssumeRole
          Condition:
            StringEquals:
              aws:PrincipalOrgID: # !Ref PRX::AWSOrganizationID would not work
                Ref: PRX::AWSOrganizationID
          Effect: Allow
          Principal:
            AWS: "*"
```

// As of 2023-09-30, there's a bug in the AWS SDK that is included with Node.js
// Lambda functions (3.188.0) that prevents this from working. I switched back
// to nodejs-16.x to be able to use the v2 SDK, which does not have the bug.
const AWS = require('aws-sdk');

const sts = new AWS.STS({
  apiVersion: '2011-06-15',
  region: process.env.AWS_REGION,
});

class Base64DecodeError extends Error {
  constructor(...params) {
    super(...params);
    this.name = 'Base64DecodeError';
  }
}

function base64decode(str) {
  try {
    return Buffer.from(str, 'base64');
  } catch (err) {
    throw new Base64DecodeError(`Invalid non-base64 data: ${str}`);
  }
}

exports.handler = async (event) => {
  const recordsToRelay = event.Records.filter((r) => r.kinesis?.data);
  const Records = recordsToRelay.map((r) => {
    return {
      Data: base64decode(r.kinesis.data),
      PartitionKey: r.kinesis.partitionKey,
    };
  });
  console.log(JSON.stringify(Records));

  const destinationStreamWriterRoleArn =
    process.env.DESTINATION_STREAM_WRITER_ROLE_ARN;

  const role = await sts
    .assumeRole({
      RoleArn: destinationStreamWriterRoleArn,
      RoleSessionName: 'kinesis-relay',
    })
    .promise();

  const kinesis = new AWS.Kinesis({
    apiVersion: '2013-12-02',
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: role.Credentials.AccessKeyId,
      secretAccessKey: role.Credentials.SecretAccessKey,
      sessionToken: role.Credentials.SessionToken,
    },
  });

  kinesis
    .putRecords({
      StreamARN: process.env.DESTINATION_KINESIS_STREAM_ARN,
      Records: Records,
    })
    .promise();
};

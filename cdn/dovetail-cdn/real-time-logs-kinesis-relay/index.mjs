import { Kinesis, PutRecordsCommand } from '@aws-sdk/client-kinesis';
import { STS, AssumeRoleCommand } from '@aws-sdk/client-sts';

const sts = new STS({ region: process.env.AWS_REGION });

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

export const handler = async (event) => {
  const recordsToRelay = event.Records.filter((r) => r.kinesis?.data);
  const Records = recordsToRelay.map((r) => {
    return {
      Data: base64decode(r.kinesis.data),
      PartitionKey: r.kinesis.partitionKey,
    };
  });

  const destinationStreamWriterRoleArn =
    process.env.DESTINATION_KINESIS_STREAM_WRITER_ROLE_ARN;

  const role = await sts.send(
    new AssumeRoleCommand({
      RoleArn: destinationStreamWriterRoleArn,
      RoleSessionName: 'kinesis-relay',
    }),
  );

  const kinesis = new Kinesis({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: role.Credentials.AccessKeyId,
      secretAccessKey: role.Credentials.SecretAccessKey,
      sessionToken: role.Credentials.SessionToken,
    },
  });

  await kinesis.send(
    new PutRecordsCommand({
      StreamARN: process.env.DESTINATION_KINESIS_STREAM_ARN,
      Records: Records,
    }),
  );
};

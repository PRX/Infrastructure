// import { KinesisClient, PutRecordsCommand } from '@aws-sdk/client-kinesis';

// const kinesis = new KinesisClient({ region: process.env.AWS_REGION });

export const handler = async (event) => {
  const recordsToRelay = event.Records.filter((r) => r.kinesis?.data);
  const Records = recordsToRelay.map((r) => {
    return { Data: r.kinesis.data, PartitionKey: r.kinesis.partitionKey };
  });
  console.log(JSON.stringify(Records));

  // await kinesis.send(
  //   new PutRecordsCommand({
  //     Records,
  //   }),
  // );
};

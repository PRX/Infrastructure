const AWS = require('aws-sdk');

const codepipeline = new AWS.CodePipeline();

exports.handler = (event, context, callback) => {
    const job = event['CodePipeline.job'];
    const s3Location = job.data.inputArtifacts[0].location.s3Location;

    const params = {
        CopySource: `${s3Location.bucketName}/${s3Location.objectKey}`,
        Bucket: process.env.INFRASTRUCTURE_CODE_BUCKET,
        Key: 'tktktktk'
    };

    s3.copyObject(params, (err, data) => {
          if (err) {
              codepipeline.putJobFailureResult({
                  jobId: job.id,
                  failureDetails: {
                      message: JSON.stringify(err),
                      type: 'JobFailed',
                      externalExecutionId: context.invokeid
                  }
              }, (e, d) => {
                  callback(err);
              });
          } else {
              codepipeline.putJobSuccessResult({ jobId: job.id }, (e, d) => {
                  callback(null);
              });
          }
    });
};

const AWS = require('aws-sdk');

const codepipeline = new AWS.CodePipeline();

exports.handler = (event, context, callback) => {
    const job = event['CodePipeline.job'];

    console.log(job);

    try {
        console.log('Starting capture...');

        codepipeline.putJobSuccessResult({ jobId: job.id }, (e, d) => {
            callback(null, '...Done!');
        });

    } catch (e) {
        console.error('...Unhandled error!');
        failPipelineAction(job, context, callback, e);
    }
};

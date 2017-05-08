const AWS = require('aws-sdk');

const s3 = new AWS.S3({apiVersion: '2006-03-01'});
const codepipeline = new AWS.CodePipeline();

exports.handler = (event, context, callback) => {
    const job = event['CodePipeline.job'];

    console.log(job);

    try {
        console.log('Starting capture...');

        const artifacts = job.data.inputArtifacts;

        const repo = artifacts.find(e => /RepoSource/.test(e.name));
        const config = artifacts.find(e => /TemplateConfig/.test(e.name));

        const capture = JSON.stringify({
          TemplateConfigArchiveS3Version: config.revision,
          InfrastructureGitCommit: repo.revision
        });

        console.log(`...Capturing: ${capture}...`);

        const env = /Staging/.test(config.name) ? 'staging' : 'production';
        const ts = Date.now();
        const key = `${env}/${ts}.json`;

        console.log(`...S3 object: ${key}...`);

        s3.putObject({
            Bucket: process.env.CAPTURED_STATES_BUCKET,
            Key: key,
            Body: capture
        }, (err, data) => {
            if (err) {
                console.error(`...S3 putObject failed!`);
                failPipelineAction(job, context, callback, err);
            } else {
                console.log('...Notifying CodePipeline job of success...');
                codepipeline.putJobSuccessResult({ jobId: job.id }, (e, d) => {
                    if (e) {
                        console.error('CodePipeline result failed!');
                        callback(e);
                    } else {
                        callback(null, '...Done!');
                    }
                });
            }
        });
    } catch (e) {
        console.error('...Unhandled error!');
        failPipelineAction(job, context, callback, e);
    }
};

function failPipelineAction(job, context, callback, err) {
    console.log('...Notifying CodePipeline job of failure!');

    const params = {
        jobId: job.id,
        failureDetails: {
            message: JSON.stringify(err),
            type: 'JobFailed',
            externalExecutionId: context.invokeid
        }
    };

    codepipeline.putJobFailureResult(params, (e, d) => {
        if (e) {
            callback(e);
        } else {
            callback(null, err);
        }
    });
}

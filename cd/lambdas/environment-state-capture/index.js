// Invoked by: CodePipelin
// Returns: Error or status message
//
// The only S3 bucket this function touches is InfrastructureSnapshotsBucket
//
// Used to capture the state of deploys as they happen as part of a CodePipeline
// deployment. This function can be used to capture state for multiple
// environments, based on the input artifacts that are provided to the Invoke
// action within CodePipeline.
//
// This function is invoked immediately following a CloudFormation deploy action
// within a pipeline, and captures information about both the template and the
// template configuration used for that deploy. These data are, specifically,
// the Git commit hash of the Infrastructure repository artifact for the run of
// the pipeline that invoked the function, as well as the S3 version ID of the
// zip file that contains the template configuration.
//
// The state is written to a JSON file in S3, whose name is a timestamp of
// when the state was captured.
//
// This should always callback to the CodePipeline API to indicate success or
// failure.

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
            Bucket: process.env.INFRASTRUCTURE_SNAPSHOTS_BUCKET,
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

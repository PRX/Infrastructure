// Invoked by: CodePipeline
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

    try {
        console.log('Starting capture...');

        makeSnapshot(job, context, callback, (env, snapshot) => {
            console.log(`...Capturing: ${snapshot}...`);

            // Snapshots are named with a timestamp, eg staging/123456.json
            const ts = Date.now();
            const key = `${env}/${ts}.json`;

            console.log(`...S3 object: ${key}...`);

            s3.putObject({
                Bucket: process.env.INFRASTRUCTURE_SNAPSHOTS_BUCKET,
                Key: key,
                Body: snapshot
            }, (err, data) => {
                if (err) {
                    console.error(`...S3 putObject failed!`);
                    failPipelineAction(job, context, callback, err);
                } else {
                    console.log('...Notifying CodePipeline job of success...');
                    codepipeline.putJobSuccessResult({
                        jobId: job.id
                    }, (e, d) => {
                        if (e) {
                            console.error('CodePipeline result failed!');
                            callback(e);
                        } else {
                            callback(null, '...Done!');
                        }
                    });
                }
            });
        });
    } catch (e) {
        console.error('...Unhandled error!');
        failPipelineAction(job, context, callback, e);
    }
}

function makeSnapshot(job, context, callback, cb) {
    const artifacts = job.data.inputArtifacts;

    console.log(`...Found ${artifacts.length} artifacts...`);

    let snapshot;
    let env;

    const repo = artifacts.find(a => /RepoSource/.test(a.name));

    // If we're capturing Staging state, there will be two artifacts, and
    // we need to record the artifact revision value of both: the
    // Infrastructure repo artifact (Git SHA), and the staging template config
    // artifact (S3 version ID)
    if (artifacts.length === 2) {
        console.log(`...Creating staging snapshot...`);

        env = 'staging';

        const config = artifacts.find(a => /TemplateConfig/.test(a.name));

        cb(env, JSON.stringify({
            InfrastructureGitCommit: repo.revision,
            TemplateConfigArchiveS3Version: config.revision
        }));
    } else {
        // For production state, only the Infrastructure repo artifact is
        // immediately available.
        console.log(`...Creating production snapshot...`);

        env = 'production';

        // To get the config version, ask S3 for the version ID of the most
        // recent version
        // TODO This is potentially inaccurate; there may be a better way
        console.log('...Getting production config version ID...');
        s3.headObject({
            Bucket: process.env.INFRASTRUCTURE_CONFIG_BUCKET,
            Key: process.env.INFRASTRUCTURE_CONFIG_PRODUCTION_KEY,
        }, (err, data) => {
            if (err) {
                console.error(`...S3 headObject failed!`);
                failPipelineAction(job, context, callback, err);
            } else {
                cb(env, JSON.stringify({
                    InfrastructureGitCommit: repo.revision,
                    TemplateConfigArchiveS3Version: data.VersionId
                }));
            }
        });
    }
}

function failPipelineAction(job, context, callback, err) {
    console.log('...Notifying CodePipeline job of failure!');

    codepipeline.putJobFailureResult({
        jobId: job.id,
        failureDetails: {
            message: JSON.stringify(err),
            type: 'JobFailed',
            externalExecutionId: context.invokeid
        }
    }, (e, d) => {
        e ? callback(e) : callback(null, err);
    });
}

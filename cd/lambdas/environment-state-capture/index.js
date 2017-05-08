const AWS = require('aws-sdk');

const codepipeline = new AWS.CodePipeline();

exports.handler = (event, context, callback) => {
    const job = event['CodePipeline.job'];

    console.log(job);

    try {
        console.log('Starting capture...');

        const artifacts = job.data.InputArtifacts;

        const repo = artifacts.find(e => e.name.test(/RepoSource/));
        const config = artifacts.find(e => e.name.test(/TemplateConfig/));

        const capture = JSON.stringify({
          TemplateConfigArchiveS3Version: config.revision,
          InfrastructureGitCommit: repo.revision
        });

        console.log(capture);

        codepipeline.putJobSuccessResult({ jobId: job.id }, (e, d) => {
            callback(null, '...Done!');
        });

    } catch (e) {
        console.error('...Unhandled error!');
        failPipelineAction(job, context, callback, e);
    }
};

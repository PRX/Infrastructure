const AWS = require('aws-sdk');
const fs = require('fs');
const unzip = require('unzipper');
const JSZip = require("jszip");

const s3 = new AWS.S3({apiVersion: '2006-03-01'});
const codepipeline = new AWS.CodePipeline();

exports.handler = (event, context, callback) => {
    const job = event['CodePipeline.job'];

    try {
        console.log('Starting sync...');

        const sync = syncCode(job, context, callback);
        const tag = publishRevision(job, context, callback);

        Promise.all([tag, sync])
            .then(() => {
                console.log('...Notifying CodePipeline job of success!');
                codepipeline.putJobSuccessResult({ jobId: job.id }, (e, d) => {
                    callback(null, '...Done!');
                });
            })
            .catch(e => failPipelineAction(job, context, callback, e));
    } catch (e) {
        console.error('...Unhandled error!');
        failPipelineAction(job, context, callback, e);
    }
};

function syncCode(job) {
    return (new Promise((resolve, reject) => {
        const inputLocation = job.data.inputArtifacts[0].location.s3Location;
        const sha = job.data.inputArtifacts[0].revision;

        const objectKey = inputLocation.objectKey;
        const artifactId = objectKey.split('/').pop().split('.')[0];

        const filename = `/tmp/${artifactId}.zip`;
        const file = fs.createWriteStream(filename);

        const params = {
            Bucket: inputLocation.bucketName,
            Key: inputLocation.objectKey
        };

        console.log(`...Getting artifact: ${params.Bucket}/${params.Key}...`);

        s3.getObject(params)
            .createReadStream()
            .on('error', e => reject(e))
            .pipe(file);

        file.on('close', () => {
            console.log(`...Finished writing artifact to ${filename}...`);

            const path = `/tmp/${artifactId}`;

            fs.createReadStream(filename)
                .pipe(unzip.Extract({ path: path }))
                .on('close', () => {
                    console.log(`...Finished unzipping ${filename}...`);

                    const files = getFiles(path);

                    console.log(`...Uploading ${files.length} files...`);
                    const promises = files.map(f => uploadFile(f, sha));

                    Promise.all(promises)
                        .then(() => resolve())
                        .catch(e => reject(e));

                }).on('error', (e) => {
                    console.error(e);
                    reject(e);
                });
        });
    }));
}

// Uploads a file that was unzipped from the input artifact to a tmp dir to S3,
// with a key prefix that includes the artifact's revision (Git sha)
function uploadFile(path, revision) {
    return (new Promise((resolve, reject) => {
        // Remove tmp dir path part from path
        const file = path.replace(/\/tmp\/[A-Za-z0-9]+\//, '');
        const key = `sync/Infrastructure/${revision}/${file}`;

        const stream = fs.createReadStream(path);

        s3.putObject({
            Bucket: process.env.INFRASTRUCTURE_CODE_BUCKET,
            Key: key,
            Body: stream
        }, (err, data) => {
            if (err) {
                reject(err);
            } else {
                console.log(`...Put ${file} to S3...`);

                resolve();
            }
        });
    }));
}

// Gets the revision value (Git sha) of the input artifact, and puts it in a
// JSON file that gets zipped and sent to S3 as an output artifact
function publishRevision(job, context, callback) {
    return (new Promise((resolve, reject) => {
        const sha = job.data.inputArtifacts[0].revision;
        const s3Location = job.data.outputArtifacts[0].location.s3Location;

        console.log(`...Publishing revision: ${sha}...`);

        // Make JSON
        const body = JSON.stringify({ commit: sha });

        // Add the JSON to the zip as a file called state.json
        const zip = new JSZip();
        zip.file('state.json', body);

        // TODO File name should use the file name of the artifact
        const ts = Date.now();

        // Write the zip to disk (/tmp/state-1234.zip), and then send to S3
        // using the bucket/key provided as the output artifact location
        zip.generateNodeStream({ streamFiles: true })
            .pipe(fs.createWriteStream(`/tmp/state-${ts}.zip`))
            .on('finish', () => {
                const stream = fs.createReadStream(`/tmp/state-${ts}.zip`);

                console.log(`...Created zipped JSON file; sending to S3...`);

                s3.putObject({
                    Bucket: s3Location.bucketName,
                    Key: s3Location.objectKey,
                    Body: stream
                }, (err, data) => {
                    if (err) {
                        reject(err);
                    } else {
                        console.log(`...Put output artifact to S3...`);
                        resolve();
                    }
                });
            });
    }));
}

// Utility function to get files in a directory recusively
function getFiles(dir, files_){
    files_ = files_ || [];

    const files = fs.readdirSync(dir);

    for (var i in files) {
        const name = dir + '/' + files[i];

        if (fs.statSync(name).isDirectory()) {
            getFiles(name, files_);
        } else {
            files_.push(name);
        }
    }
    return files_;
}

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

    codepipeline.putJobFailureResult(params, (e, d) => callback(e));
}

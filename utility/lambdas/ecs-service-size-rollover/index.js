// Invoked by: CloudFormation
// Returns: A `Data` object to a pre-signed URL
//
// Used as part of an ECS service custom resource, which allows for the
// DesiredSize of a service to be persisted across CloudFormation deploys.
// The name of the a cluster and service is passed in as part of the event data,
// and a query is made to the ECS API to get the current value, which is then
// returned and made available to other CloudFormation resources.

const https = require('https');
const url = require('url');
const AWS = require('aws-sdk');

const ecs = new AWS.ECS();

const REQUEST_TYPE_DELETE = 'Delete';

const STATUS_SUCCESS = 'SUCCESS';
// const STATUS_FAILED = 'FAILED';

const HTTP_PUT = 'PUT';

const RESPONSE_DATA_KEY_DESIRED_COUNT = 'DesiredCount';

// Send response to the pre-signed S3 URL
function sendResponse(event, context, responseStatus, responseData) {
    const crResponse = {
        Status: responseStatus,
        Reason: `CloudWatch Logs: ${context.logStreamName}`,
        PhysicalResourceId: context.logStreamName,
        StackId: event.StackId,
        RequestId: event.RequestId,
        LogicalResourceId: event.LogicalResourceId,
        Data: responseData,
    };

    const responseBody = JSON.stringify(crResponse);

    const parsedUrl = url.parse(event.ResponseURL);
    const options = {
        hostname: parsedUrl.hostname,
        port: 443,
        path: parsedUrl.path,
        method: HTTP_PUT,
        headers: {
            'content-type': '',
            'content-length': responseBody.length,
        },
    };

    const request = https.request(options, () => {
        context.done();
    });

    request.on('error', (error) => {
        console.log(`sendResponse Error: ${error}`);
        // Tell AWS Lambda that the function execution is done
        context.done();
    });

    // write data to request body
    request.write(responseBody);
    request.end();
}

exports.handler = (event, context) => {
    // For Delete requests, immediately send a SUCCESS response.
    if (event.RequestType === REQUEST_TYPE_DELETE) {
        sendResponse(event, context, STATUS_SUCCESS);
        return;
    }

    ecs.describeServices({
        cluster: event.ResourceProperties.ClusterName,
        services: [event.ResourceProperties.ServiceName],
    }, (err, data) => {
        if (data && data.services && data.services[0]) {
            const service = data.services[0];

            const responseData = {
                [RESPONSE_DATA_KEY_DESIRED_COUNT]: service.desiredCount,
            };

            sendResponse(event, context, STATUS_SUCCESS, responseData);
        } else {
            const defaultCount = process.env.DEFAULT_DESIRED_COUNT || 2;
            const responseData = {
                [RESPONSE_DATA_KEY_DESIRED_COUNT]: defaultCount,
            };

            sendResponse(event, context, STATUS_SUCCESS, responseData);
        }
    });
};


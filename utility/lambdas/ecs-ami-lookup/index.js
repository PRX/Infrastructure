// Invoked by: CloudFormation
// Returns: A `Data` object to a pre-signed URL
//
// Used as part of an ECS AMI Lookup custom resource in CloudFormation
// templates, to return the current AMI ID for ECS optimized images. The ID
// is found using the `describeImages` action from the EC2 API. The region is
// passed in as a property of the custom resource.

const https = require('https');
const url = require('url');
const AWS = require('aws-sdk');

const ECS_AMI_FILTER = 'amzn-ami*amazon-ecs-optimized';

exports.handler = (event, context) => {
    console.log(`REQUEST RECEIVED:\n ${JSON.stringify(event)}`);

    // For Delete requests, immediately send a SUCCESS response.
    if (event.RequestType === 'Delete') {
        sendResponse(event, context, 'SUCCESS');
        return;
    }

    const ec2 = new AWS.EC2({ region: event.ResourceProperties.Region });

    const params = {
        Filters: [{ Name: 'name', Values: ECS_AMI_FILTER }],
        Owners: ['amazon']
    };

    // Get AMI IDs with the specified name pattern and owner
    ec2.describeImages(params, (err, results) => {
        if (err) {
            responseData = { Error: 'DescribeImages call failed' };
            console.log(`${responseData.Error}:\n ${err}`);
        } else {
            let images = results.Images;
            // Sort images by name in decscending order. The names contain the AMI version, formatted as YYYY.MM.Ver.
            images.sort(function(x, y) { return y.Name.localeCompare(x.Name); });

            for (var j = 0; j < images.length; j++) {
                if (isBeta(images[j].Name)) continue;
                responseStatus = 'SUCCESS';
                responseData['Id'] = images[j].ImageId;
                break;
            }
        }
        sendResponse(event, context, responseStatus, responseData);
    });
};

// Check if the image is a beta or rc image. The Lambda function won't return any of those images.
function isBeta(imageName) {
    return imageName.toLowerCase().indexOf('beta') > -1 || imageName.toLowerCase().indexOf('.rc') > -1;
}

// Send response to the pre-signed S3 URL
function sendResponse(event, context, responseStatus, responseData) {

    var responseBody = JSON.stringify({
        Status: responseStatus,
        Reason: "See the details in CloudWatch Log Stream: " + context.logStreamName,
        PhysicalResourceId: context.logStreamName,
        StackId: event.StackId,
        RequestId: event.RequestId,
        LogicalResourceId: event.LogicalResourceId,
        Data: responseData
    });

    console.log("RESPONSE BODY:\n", responseBody);

    var parsedUrl = url.parse(event.ResponseURL);
    var options = {
        hostname: parsedUrl.hostname,
        port: 443,
        path: parsedUrl.path,
        method: "PUT",
        headers: {
            "content-type": "",
            "content-length": responseBody.length
        }
    };

    console.log("SENDING RESPONSE...\n");

    var request = https.request(options, function(response) {
        console.log("STATUS: " + response.statusCode);
        console.log("HEADERS: " + JSON.stringify(response.headers));
        // Tell AWS Lambda that the function execution is done
        context.done();
    });

    request.on("error", function(error) {
        console.log("sendResponse Error:" + error);
        // Tell AWS Lambda that the function execution is done
        context.done();
    });

    // write data to request body
    request.write(responseBody);
    request.end();
}

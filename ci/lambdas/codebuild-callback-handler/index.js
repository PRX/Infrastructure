// Invoked by: SNS Subscription
// Returns: Error or status message
//
// Triggered after a CodeBuild run finishes and is responsible for updating
// the GitHub status, and sending some notifications.

exports.handler = (event, context, callback) => {
    try {
        callback(null, 'Done');
    } catch(e) {
        console.error('Unhandled exception!');
        callback(e);
    }
};

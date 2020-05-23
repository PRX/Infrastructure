exports.handler = async event => ({
    statusCode: event.rawPath.substring(1, 4),
    headers: {
        location: `https://${decodeURIComponent(event.pathParameters.proxy)}`,
    },
});

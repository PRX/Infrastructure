/**
 * This expects to handle origin requests from a CloudFront distribution. The
 * origin path should be of the format "/301/www.example.com". There should be
 * no default root object.
 *
 * Examples
 * ========
 * Viewer request: www.old-domain.com
 * Origin request: 123456.execute-api.us-east-1.amazonaws.com/301/www.new-domain.com/
 * Raw path: /301/www.new-domain.com/
 * Proxy parameter: www.new-domain.com/
 * Response: 301 https://www.new-domain.com/
 *
 * Viewer request: www.old-domain.com/path/to/file
 * Origin request: 123456.execute-api.us-east-1.amazonaws.com/301/www.new-domain.com/path/to/file
 * Raw path: /301/www.new-domain.com/path/to/file
 * Proxy parameter: www.new-domain.com/path/to/file
 * Response: 301 https://www.new-domain.com/path/to/file
 */
exports.handler = async (event, context) => ({
  statusCode: event.rawPath.substring(1, 4),
  headers: {
    location: `https://${decodeURIComponent(event.pathParameters.proxy)}`,
    'x-prx-id': context.awsRequestId,
  },
});

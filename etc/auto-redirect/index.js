/**
 * This expects to handle origin requests from a CloudFront distribution. The
 * origin path should be of the format "/301/www.example.com". There should be
 * no default root object.
 *
 * To force the redirection location to drop the path part of the viewer
 * request URL, append ______ (six underscores) to the end of the origin path
 * on the CloudFront distribution.
 *
 * Examples
 * ========
 * CloudFront origin path: /301/www.new-domain.com
 * Viewer request: www.old-domain.com
 * Origin request: 123456.execute-api.us-east-1.amazonaws.com/301/www.new-domain.com/
 * Raw path: /301/www.new-domain.com/
 * Proxy parameter: www.new-domain.com/
 * Response: 301 https://www.new-domain.com/
 *
 * CloudFront origin path: /301/www.new-domain.com
 * Viewer request: www.old-domain.com/path/to/file
 * Origin request: 123456.execute-api.us-east-1.amazonaws.com/301/www.new-domain.com/path/to/file
 * Raw path: /301/www.new-domain.com/path/to/file
 * Proxy parameter: www.new-domain.com/path/to/file
 * Response: 301 https://www.new-domain.com/path/to/file
 *
 * CloudFront origin path: /301/www.new-domain.com/path/to/include/in/redirect______
 * Viewer request: www.old-domain.com/path/to/drop/from/redirect
 * Origin request: 123456.execute-api.us-east-1.amazonaws.com/301/www.new-domain.com/path/to/include/in/redirect______/path/to/drop/from/redirect
 * Raw path: /301/www.new-domain.com/path/to/include/in/redirect______/path/to/drop/from/redirect
 * Proxy parameter: www.new-domain.com/path/to/include/in/redirect______/path/to/drop/from/redirect
 * Response: 301 https://www.new-domain.com/path/to/include/in/redirect
 */
exports.handler = async (event, context) => ({
  statusCode: event.rawPath.substring(1, 4),
  headers: {
    location: `https://${
      decodeURIComponent(event.pathParameters.proxy).split('______')[0]
    }`,
    'x-prx-id': context.awsRequestId,
  },
});

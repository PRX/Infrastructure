/**
 * This expects to handle origin requests from a CloudFront distribution. The
 * origin path configured on the distribution should be of the format
 * "/301/www.example.com". There should be no default root object.
 *
 * To force the redirection location to drop the path part of the viewer
 * request URL, append ______ (six underscores) to the end of the origin path
 * on the CloudFront distribution.
 *
 * The query string of the viewer request will always be preserved as part of
 * the redirection location (e.g., old.com?foo => new.com/?foo). If the query
 * string separator (`?`) is present in the viewer request but there is no
 * query string, the separator will **not** be included in the redirection
 * location (e.g., `old.com/foo?` => "new.com/foo"). Be sure the CloudFront
 * distribution query string caching policy is appropriate for your use case.
 *
 * Examples
 * ========
 * Request to the root path of the old domain with no redirect path
 *     CloudFront origin path: /301/www.new-domain.com
 *     Viewer request: www.old-domain.com
 *     Origin request: 123456.execute-api.us-east-1.amazonaws.com/301/www.new-domain.com/
 *     Raw path: /301/www.new-domain.com/
 *     Proxy parameter: www.new-domain.com/
 *     Response: 301 https://www.new-domain.com/
 *
 * Request to an arbitrary path of the old domain with no redirect path
 *     CloudFront origin path: /301/www.new-domain.com
 *     Viewer request: www.old-domain.com/path/to/file
 *     Origin request: 123456.execute-api.us-east-1.amazonaws.com/301/www.new-domain.com/path/to/file
 *     Raw path: /301/www.new-domain.com/path/to/file
 *     Proxy parameter: www.new-domain.com/path/to/file
 *     Response: 301 https://www.new-domain.com/path/to/file
 *
 * Request to an arbitrary path of the old domain with a redirect path
 *     CloudFront origin path: /301/www.new-domain.com/archive
 *     Viewer request: www.old-domain.com/path/to/file
 *     Origin request: 123456.execute-api.us-east-1.amazonaws.com/301/www.new-domain.com/archive/path/to/file
 *     Raw path: /301/www.new-domain.com/archive/path/to/file
 *     Proxy parameter: www.new-domain.com/archive/path/to/file
 *     Response: 301 https://www.new-domain.com/archive/path/to/file
 *
 * Request to arbitrary path of the old domain with a redirect path included,
 * where the path of the original request is dropped
 *     CloudFront origin path: /301/www.new-domain.com/path/to/include/in/redirect______
 *     Viewer request: www.old-domain.com/path/to/drop/from/redirect
 *     Origin request: 123456.execute-api.us-east-1.amazonaws.com/301/www.new-domain.com/path/to/include/in/redirect______/path/to/drop/from/redirect
 *     Raw path: /301/www.new-domain.com/path/to/include/in/redirect______/path/to/drop/from/redirect
 *     Proxy parameter: www.new-domain.com/path/to/include/in/redirect______/path/to/drop/from/redirect
 *     Response: 301 https://www.new-domain.com/path/to/include/in/redirect
 */
export const handler = async (event, context) => ({
  statusCode: event.rawPath.substring(1, 4),
  headers: {
    location: `https://${
      decodeURIComponent(event.pathParameters.proxy).split('______')[0]
    }${event.rawQueryString?.length ? `?${event.rawQueryString}` : ''}`,
    'x-prx-id': context.awsRequestId,
  },
});

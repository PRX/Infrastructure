export const handler = async (event) => {
  const request = event.Records[0].cf.request;

  // The `/f` path is reserved to indicate an f.prxu.org feed origin. The `/f`
  // path part must be removed to make a valid origin request.
  if (request.uri.startsWith('/f/')) {
    request.uri = request.uri.slice(2);

    const headUrl = `https://${request.origin.custom.domainName}${request.uri}`;

    // Check the feed file for a redirect marker
    const res = await fetch(headUrl, { method: 'HEAD' });
    if (res.headers.has('x-amz-meta-dovetail-feed-cdn-redirect')) {
      // The feed file in S3 being requested has been marked with a
      // redirect header. Respond with a 301 to the given URL, rather than
      // with the actual feed.
      return {
        status: 301,
        headers: {
          location: [
            {
              key: 'Location',
              value: res.headers.get('x-amz-meta-dovetail-feed-cdn-redirect'),
            },
          ],
          'cache-control': [
            {
              key: 'Cache-Control',
              value: 'max-age=18000', // 5 hours
            },
          ],
        },
      };
    } else {
      // Not a redirect; continue the origin request normally.
      return request;
    }
  } else {
    return { status: 404 };
  }
};

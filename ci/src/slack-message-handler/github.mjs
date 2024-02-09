import { request } from 'node:https';

// https://docs.github.com/en/rest/commits/commits#compare-two-commits
// Returns information comparing two commits for a given repository
export async function compareCommits(ownerAndRepo, before, after) {
  return new Promise((resolve, reject) => {
    const gitHubToken = process.env.GITHUB_ACCESS_TOKEN;

    if (
      before === '0000000000000000000000000000000000000000' ||
      after === '0000000000000000000000000000000000000000'
    ) {
      resolve({});
    }

    const options = {
      host: 'api.github.com',
      path: `/repos/${ownerAndRepo}/compare/${before}...${after}?per_page=16`,
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github.v3+json',
        Authorization: `token ${gitHubToken}`,
        'User-Agent': 'PRX/CI (slack-message-handler)',
        'Content-Length': Buffer.byteLength(''),
      },
    };

    console.log(options.path);

    const req = request(options, (res) => {
      res.setEncoding('utf8');

      let json = '';
      res.on('data', (chunk) => {
        json += chunk;
      });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(json));
        } else {
          reject(new Error(`GitHub request failed! ${res.statusCode}`));
        }
      });
    });

    // Generic request error handling
    req.on('error', (e) => reject(e));

    req.write('');
    req.end();
  });
}

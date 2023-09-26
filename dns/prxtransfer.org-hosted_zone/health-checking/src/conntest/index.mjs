import * as ftp from 'basic-ftp';

export const handler = async (event) => {
  const client = new ftp.Client();
  client.ftp.verbose = false;
  try {
    await client.access({
      host: process.env.FQDN,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASSWORD,
      secure: false,
    });
    console.info('Connection test succeeded!');
  } catch (err) {
    console.error(err);
    throw err;
  }
  client.close();
};

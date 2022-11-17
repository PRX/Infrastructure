module.exports = (accountId) => {
  switch (accountId) {
    case '561178107736':
      return 'PRX Legacy';
    case '578003269847':
      return 'PRX DevOps';
    case '048723829744':
      return 'PRX Main';
    case '838846856186':
      return 'PRX Feed CDN Production';
    case '976680550710':
      return 'The World';
    case '151502348212':
      return 'PRX Data Production';
    case '639773875692':
      return 'PRX publicmedia.social';
    default:
      return accountId;
  }
};

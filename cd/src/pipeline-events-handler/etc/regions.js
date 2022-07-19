module.exports = (region) => {
  switch (region) {
    case 'us-east-1':
      return 'N. Virginia';
    case 'us-east-2':
      return 'Ohio';
    case 'us-west-1':
      return 'N. California';
    case 'us-west-2':
      return 'Oregon';
    case 'af-south-1':
      return 'Cape Town';
    case 'ap-east-1':
      return 'Hong Kong';
    case 'ap-south-1':
      return 'Mumbai';
    case 'ap-northeast-3':
      return 'Osaka';
    case 'ap-northeast-2':
      return 'Seoul';
    case 'ap-southeast-1':
      return 'Singapore';
    case 'ap-southeast-2':
      return 'Sydney';
    case 'ap-northeast-1':
      return 'Tokyo';
    case 'ca-central-1':
      return 'C. Canada';
    case 'eu-central-1':
      return 'Frankfurt';
    case 'eu-west-1':
      return 'Ireland';
    case 'eu-west-2':
      return 'London';
    case 'eu-south-1':
      return 'Milan';
    case 'eu-west-3':
      return 'Paris';
    case 'eu-north-1':
      return 'Stockholm';
    case 'me-south-1':
      return 'Bahrain';
    case 'sa-east-1':
      return 'São Paulo';
    default:
      return region;
  }
};

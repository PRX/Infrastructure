const REF_KEY = 'Ref';

function refs(fragment, key, ref) {
  switch (ref) {
    case 'PRX::Timestamp':
      fragment[key] = `${(+new Date() / 1000).toFixed(0)}`;
      break;
    case 'PRX::AWSOrganizationID':
      fragment[key] = process.env.ORGANIZATION_ID;
      break;
    default:
      break;
  }
}

function transform(fragment) {
  for (let key in fragment) {
    const node = fragment[key];

    if (Array.isArray(node)) {
      node.forEach(transform);
    } else if (
      typeof node === 'object' &&
      !Array.isArray(node) &&
      node !== null
    ) {
      // If we're looking at an object node that has only a single key, and
      // that key is Ref, the object should be replaced with the calculated
      // Ref value.
      // e.g., { "Prop": { "Ref": "Time" } } becomes { "Prop": "10 AM" }
      if (Object.keys(node).length === 1 && Object.keys(node)[0] === REF_KEY) {
        refs(fragment, key, node[Object.keys(node)[0]]);
      } else {
        transform(node);
      }
    }
  }
}

exports.handler = async (event) => {
  transform(event.fragment);

  return {
    requestId: event.requestId,
    status: 'SUCCESS',
    fragment: event.fragment,
  };
};

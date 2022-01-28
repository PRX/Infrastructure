function refs(fragment, key) {
  if (fragment[key] === '$PRX!Ref Timestamp') {
    fragment[key] = +new Date();
  }
}

function transform(fragment) {
  for (let key in fragment) {
    if (typeof fragment[key] === 'object') {
      transform(fragment[key]);
    } else if (typeof fragment[key] === 'string') {
      if (fragment[key].startsWith('$PRX!Ref')) {
        refs(fragment, key);
      }
    }
  }
}

exports.handler = async (event) => {
  console.log(JSON.stringify(event));

  transform(event.fragment);

  console.log(JSON.stringify(event));

  return {
    requestId: event.requestId,
    status: 'SUCCESS',
    fragment: event.fragment,
  };
};

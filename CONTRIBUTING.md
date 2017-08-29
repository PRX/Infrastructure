JavaScript should follow the included ESLint rules. These follow the Airbnb
style guide, save for a few minor changes to that relate to coding specifically
for AWS Lambda functions.

Ensure that Airbnb config is available, as the included `.eslintrc` inherits
from that.

```
(
  export PKG=eslint-config-airbnb;
  npm info "$PKG@latest" peerDependencies --json | command sed 's/[\{\},]//g ; s/: /@/g' | xargs npm install --save-dev "$PKG@latest"
)
```

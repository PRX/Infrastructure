This means that standard practices like code reviews and Git merges can be applied to infrastructure code, and the deployment of changes to the AWS resources that run applications can be managed much more explicitly.

## Coding Standards

Follow these rules for Git commits: https://chris.beams.io/posts/git-commit/

### Python

Python code shoud be follow the default Flake8 settings.

Ensure that Flake8 is installed and your editor is configured to check for problems.

`pip install flake8`

### JavaScript

JavaScript should follow the included ESLint rules. These follow the Airbnb style guide, save for a few minor changes to that relate to coding specifically for AWS Lambda functions.

Ensure that Airbnb config is available, as the included `.eslintrc` inherits from that, and that your editor is configured to check for problems.

```
(
  export PKG=eslint-config-airbnb;
  npm info "$PKG@latest" peerDependencies --json | command sed 's/[\{\},]//g ; s/: /@/g' | xargs npm install --save-dev "$PKG@latest"
)
```

### YAML

### CloudFormation Templates

Templates should be linted to be error-free with [cfn-lint](https://github.com/awslabs/cfn-python-lint).

Always write templates in YAML. CloudFormation templates can be hard to parse. Always use clear, verbose naming and add inline comments when appropriate. Group resources by their function, not by their type. Add the filename at the top of the file as a comment (this makes it easier to identify which template was used to launch a stack).






- stack protection

- notes about learning fundementals of AWS



Lambda functions should contain a README file in the directory with the code, or a README section at the top of the code file. Unless absolutely necessary, Lambda functions should be a single text file with no external libraries (to make managing them through the AWS Console as easy as possible). Python is the preferred language to use for functions in the CI stack.

This means that standard practices like code reviews and Git merges can be applied to infrastructure code, and the deployment of changes to the AWS resources that run applications can be managed much more explicitly.

## Coding Standards

Follow these rules for Git commits: https://chris.beams.io/posts/git-commit/

### Python

Python code should be automatically formatted using [Black](https://black.readthedocs.io/en/stable/#), and statically checked using Pylance (or similar).

### JavaScript

JavaScript should follow the included ESLint rules. These follow the Airbnb style guide, save for a few minor changes to that relate to coding specifically for AWS Lambda functions.

Ensure that Airbnb config is available, as the included `.eslintrc` inherits from that, and that your editor is configured to check for problems.

```
(
  export PKG=eslint-config-airbnb;
  npm info "$PKG@latest" peerDependencies --json | command sed 's/[\{\},]//g ; s/: /@/g' | xargs npm install --save-dev "$PKG@latest"
)
```

JavaScript files should be automatically formatted using Prettier.

### YAML

YAML files should be automatically formatted using Prettier. It may be helpful to only format modifications, since many YAML files are not formatted, and would result in large deltas.

### CloudFormation Templates

Templates should be linted to be error-free with [cfn-lint](https://github.com/awslabs/cfn-python-lint).

There is also an atom plugin https://atom.io/packages/atom-cfn-lint.

Always write templates in YAML. CloudFormation templates can be hard to parse. Always use clear, verbose naming and add inline comments when appropriate. Group resources by their function, not by their type. Add the filename at the top of the file as a comment (this makes it easier to identify which template was used to launch a stack).

#### Function syntax

Always prefer the short form syntax (YAML tags) of functions, except in the following situations:

1. When function nesting does not support short form, such as using `Fn::ImportValue` with `Fn::Join`.

2. When it would lead to the function being the only thing on the line:

```yaml
# Undesirable
Pets:
  - Animal: Dog
    Name: Scraps
  - !If
    - HasACat
    - Animal: Cat
      Name: Cinnamon
    - !Ref AWS::NoValue
# Preferred
Pets:
  - Animal: Dog
    Name: Scraps
  - Fn::If:
      - HasACat
      - Animal: Cat
        Name: Cinnamon
      - !Ref AWS::NoValue
```

- stack protection

- notes about learning fundementals of AWS



Lambda functions should contain a README file in the directory with the code, or a README section at the top of the code file. Unless absolutely necessary, Lambda functions should be a single text file with no external libraries (to make managing them through the AWS Console as easy as possible). Python is the preferred language to use for functions in the CI stack.

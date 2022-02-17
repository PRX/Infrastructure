## Coding Standards

Follow these rules for Git commits: https://chris.beams.io/posts/git-commit/

CI builds will enforce the following linters and static code checkers:

- [cfn-lint](https://github.com/aws-cloudformation/cfn-lint)
- [Black](https://black.readthedocs.io/en/stable/#)
- [Flake8](https://flake8.pycqa.org/en/latest/)
- [ESLint](https://eslint.org/)
- [Prettier](https://prettier.io/)
- TypeScript [tsc](https://www.typescriptlang.org/docs/handbook/compiler-options.html)

It's recommended you configure your IDE to continuously run those tools to catch any errors before committing. When possible, configure the tools to run automatically (e.g., on save).

### CloudFormation Templates

Always write templates in YAML. CloudFormation templates can be hard to parse. Always use clear, verbose naming and add inline comments and whitespace when appropriate. Group resources by their function, not by their type. Add the filename at the top of the file as a comment (this makes it easier to identify which template was used to launch a stack).

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

# Example Development Environment

- Use [asdf](https://asdf-vm.com/) for managing Node.js and Ruby runtimes.
- Install the versions indicated in `.tool-versions`
- `npm install` – This will some install linters and checkers, and packages needed by them
- Use `pyenv` for managing Python version
- Use `pyenv-virtualenv` for virtual environments
- `pyenv install 3.8.12`
- `pyenv virtualenv 3.8.12 venv_infrastructure`
- `pip install -r requirements.txt`

This should install all tooling required in a way that doesn't pollute your global environment. You may need to configure your IDE or install additional plugins to integrate these tools into your editor. Be sure paths are configured to look in the right spots for `asdf` or `pyenv`, or however you choose to install runtimes.

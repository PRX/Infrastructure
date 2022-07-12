# This project does not have any sort of root-level deployable artifact. This
# Dockerfile is used only to create a reproducible environment to run a test
# suite against the entire codebase, primarily linters and code style checkers.
# The resulting Docker image is intended to be run in a continuous integration
# service, like AWS CodeBuild.
#
# `npm test` should run the entire test suite, even non-Node tests.

# Should use an image that matches the Node.js and Python versions listed in
# .tool-versions and .python-version
FROM nikolaik/python-nodejs:python3.10-nodejs16-alpine

WORKDIR /app
COPY . .

RUN npm install
RUN pip install -r requirements.txt

ENTRYPOINT [ "npm" ]

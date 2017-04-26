#!/bin/sh
set -e

mkdir -p .deploy
cd lambdas; find * -maxdepth 0 -type d|while read dirname; do cd "$dirname"; zip -r "$dirname" *; mv "$dirname".zip ../../.deploy; cd ..; done; cd ..

aws s3 sync .deploy/ s3://prx-infrastructure-code-us-east-2/ci --acl private --region us-east-2 --delete

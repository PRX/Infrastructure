#!/bin/sh
set -e

mkdir -p .deploy

mkdir -p .deploy/notifications
cd ./notifications/lambdas; find * -maxdepth 0 -type d|while read dirname; do cd "$dirname"; zip -r "$dirname" *; mv "$dirname".zip ../../../.deploy/notifications; cd ..; done; cd ..; cd ..

mkdir -p .deploy/ci
cd ./ci/lambdas; find * -maxdepth 0 -type d|while read dirname; do cd "$dirname"; zip -r "$dirname" *; mv "$dirname".zip ../../../.deploy/ci; cd ..; done; cd ..; cd ..

mkdir -p .deploy/cd
cd ./cd/lambdas; find * -maxdepth 0 -type d|while read dirname; do cd "$dirname"; zip -r "$dirname" *; mv "$dirname".zip ../../../.deploy/cd; cd ..; done; cd ..; cd ..

aws s3 sync .deploy/ s3://prx-infrastructure-code-us-east-2/ --acl private --region us-east-2

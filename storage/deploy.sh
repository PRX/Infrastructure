#!/bin/bash
set -e

source ../.env

aws cloudformation deploy \
        --template-file ./storage.yml \
        --stack-name "$STORAGE_STACK_NAME"

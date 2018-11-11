#!/bin/bash

set -e
set -x

SOLEXCC_HOME=/home/apsync/solexcc
NODE_EXE=$SOLEXCC_HOME/node/bin/node
APP_HOME=$SOLEXCC_HOME/app

pushd $APP_HOME
PORT=80 $NODE_EXE app.js


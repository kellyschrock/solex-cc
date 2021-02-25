#!/bin/bash

set -e
set -x

SOLEXCC_HOME=$HOME/solexcc
NODE_EXE=$(which nodejs)
APP_HOME=$SOLEXCC_HOME/app

pushd $APP_HOME
PORT=80 $NODE_EXE app.js


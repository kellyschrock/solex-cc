#!/bin/bash

set -e
set -x

pushd /home/apsync/solexcc
screen -L -d -m -S solexcc -s /bin/bash ./start_solexcc.sh >start_solexcc.log 2>&1

exit 0

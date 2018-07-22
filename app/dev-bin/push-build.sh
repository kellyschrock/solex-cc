#!/bin/sh

DEST="apsync@10.0.0.10:~/solexcc/app"

if [ $# -eq 1 ]; 
then
    DEST=$1
fi

echo Pushing to $DEST

SCRIPT_DIR="$( cd "$( dirname "$0" )" && pwd )"
echo $SCRIPT_DIR

cd $SCRIPT_DIR
cd ..
# should be in app dir now

rsync -aruvz --exclude=node_modules --exclude=*config.json --exclude=startup.json * $DEST


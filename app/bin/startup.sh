#!/bin/sh

HERE=`pwd`

echo $0 Starting up in $HERE

if [ -d $HERE/download ]; 
then
    echo Removing stale packages
    rm -rf $HERE/download
fi

echo Done



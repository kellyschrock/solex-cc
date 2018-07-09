#!/bin/sh

HERE=`pwd`

echo $0 Starting up in $HERE

usage() {
    echo 
    echo Usage: $0 path target
    echo 
}

if [ $# -lt 2]; 
then
    usage
    exit 127
fi

path=$1
target=$2

unzip -o $path -d $target

echo Done



#!/bin/sh

HERE=`pwd`

# echo $0 Starting up in $HERE

die() {
    echo $1
    exit 127
}

usage() {
    echo 
    echo Usage: $0 path target
    echo 
    exit 127
}

if [ $# -lt 2 ]; 
then
    usage
fi

path=$1
target=$2

unzip -o $path -d $target > /dev/null 2>&1

cd $target || die "Can't cd to $target"

if [ -e package.json ]; 
then
    which npm && npm install || die "Need to run npm for this worker, but can't find it"
fi

echo "Installed $path to $target"


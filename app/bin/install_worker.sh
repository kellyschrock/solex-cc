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
}

if [ $# -lt 2]; 
then
    usage
    exit 127
fi

path=$1
target=$2

unzip -o $path -d $target

cd $target || die "Can't cd to $target"

if [ -e package.json ]; 
then
    which npm && npm install
fi

echo Done



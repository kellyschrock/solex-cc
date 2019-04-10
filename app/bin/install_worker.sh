#!/bin/sh

HERE=`pwd`

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
    which npm && npm install || die "Failed to run npm for worker at $target"
fi

echo "Installed $path to $target"

rm -f $path

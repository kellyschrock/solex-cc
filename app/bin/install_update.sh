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

unzip -o $path -d $target > /dev/null 2>&1 || die "Cannot unzip ${path} to ${target}"
ls $target/files.zip || die "Cannot find $target/files.zip"
ls $target/install.sh || die "Cannot find $target/install.sh"

rc=$($target/install.sh)

rm $target/files.zip
rm $target/install.sh

exit $rc

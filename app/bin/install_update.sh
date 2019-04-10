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

tmp=/tmp/install_$(basename $path)

unzip -o $path -d $tmp > /dev/null 2>&1 || die "Cannot unzip ${path} to ${tmp}"
ls $tmp/files.zip > /dev/null 2>&1 || die "Cannot find $tmp/files.zip"
ls $tmp/install.sh  > /dev/null 2>&1 || die "Cannot find $tmp/install.sh"

echo Execute install script
cd $tmp
chmod +x $tmp/install.sh
$tmp/install.sh $target
rc=$?

echo $tmp/install.sh returned $rc

# clean up
rm $path
rm -rf $tmp

exit $rc


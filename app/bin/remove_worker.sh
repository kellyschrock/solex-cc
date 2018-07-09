#!/bin/sh

HERE=`pwd`

echo $0 Starting up in $HERE

if [ $# -lt 1 ];
then
    usage
    exit 127
fi

target=$1

rm -rf $target



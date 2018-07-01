#!/bin/sh

if [ "$(uname -m)" = "x86_64" ]; then
    echo 2055055
    exit 0
fi

d=`cat /proc/cpuinfo | grep ^Serial | cut -d":" -f2`
len=${#d}

if [ $len -lt 1 ]; then
    echo "Not available"
else
    echo $d
fi


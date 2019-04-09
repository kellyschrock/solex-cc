#!/bin/sh

# NOTE: RUN THIS FROM THE BASE DIRECTORY. TODO: Put a check in here to make sure.

if [ "$#" -lt 2 ]; then
    echo 
    echo Usage:
    echo $0 fromver ver
    echo
    echo Where fromver is a branch or tag to update from.
    echo
    exit 1
fi

here=`pwd`

if [ -d app ]; then
    echo In the dir where we need to be
else
    echo `pwd` is the wrong directory to run this from. Run from the base project directory.
    exit 1
fi

# Usage make-update.sh v1.0 1.0.1
fromver=$1
ver=$2

destdir=update/versions/$ver

mkdir -p $destdir 

echo putting output files in $destdir

# Make the update files package
zip -r9 $destdir/files.zip `git diff $fromver --name-only`

cd $destdir || exit 1

echo Now in `pwd`

# Have to have this, otherwise install won't do anything
cp ../../install.sh . || exit 1

echo $ver > version

zip -r9 solexcc-update-$ver.zip *

cd $here





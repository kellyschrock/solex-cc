#!/bin/sh

die() {
    echo $1
    exit 111
}

# Get destdir from the command line
if [ "$#" -lt 1 ]; then
    echo 
    echo Usage:
    echo $0 destdir
    echo
    echo Where destdir is where to install the update to.
    echo
    exit 1
fi

destdir=$1

# Unzip files.zip into it
unzip -o files.zip -d $destdir || die "Unable to unzip files.zip into $destdir"

# Set a flag to tell whether we need to run "npm install"
hasPackageJson=0
unzip -l files.zip app/package.json && hasPackageJson=1

# Make sure the version file is put in the right place under app
cp version $destdir || die "Unable to copy version into $destdir"

if [ $hasPackageJson -eq 1 ]; then
    cd $destdir
    npm install || die "Unable to run npm install from $destdir"
fi

exit 0


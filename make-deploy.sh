#!/bin/sh

zip -r9 --exclude=*node_modules* --exclude=*config.json* solexcc-deploy.zip app

cd deploy/solexcc
zip -r9 ../../solexcc-deploy.zip *
cd ../..




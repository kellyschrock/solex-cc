#!/bin/sh

cd app

zip -r9 --exclude=*node_modules* --exclude=*config.json* ../solexcc-deploy.zip *

cd ..


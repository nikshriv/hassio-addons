#!/bin/bash
CONFIG_PATH=/data/options.json

cd /hassio-addons/cync_lights_addon
pm2 start index.js --no-daemon

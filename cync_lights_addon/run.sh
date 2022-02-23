#!/bin/bash
CONFIG_PATH=/data/options.json

cd /hassio-addons/cync_lights_addon
forever start index.js

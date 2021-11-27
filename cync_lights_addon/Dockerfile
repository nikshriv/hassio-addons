ARG BUILD_FROM=hassioaddons/base-python:7.2.0
FROM ${BUILD_FROM}

# Set shell
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Add env
ENV LANG C.UTF-8

RUN apk add --no-cache \
    nodejs \
    npm \
    git && \
    python -m ensurepip --upgrade && \
    cd / && \
    git clone https://github.com/nikshriv/hassio-addons && \
    cd /hassio-addons/cync_lights_addon && \
    npm install --unsafe-perm && \
    chmod a+x run.sh
  
RUN pip install --no-cache-dir -r /hassio-addons/cync_lights_addon/requirements.txt

CMD [ "/hassio-addons/cync_lights_addon/run.sh" ]

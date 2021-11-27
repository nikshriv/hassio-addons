ARG BUILD_FROM
FROM $BUILD_FROM

# Add env
ENV LANG C.UTF-8

# Set shell
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
EXPOSE 3001/tcp

RUN apk add --no-cache \
    nodejs \
    npm \
    python3 \
    git && \
    python3 -m ensurepip && \
    cd / && \
    git clone https://github.com/nikshriv/hassio-addons && \
    cd /hassio-addons/cync_lights_addon && \
    npm install pm2 -g && \
    npm install --unsafe-perm && \
    pip3 install --no-cache-dir -r requirements.txt && \
    chmod a+x run.sh

CMD [ "/hassio-addons/cync_lights_addon/run.sh" ]

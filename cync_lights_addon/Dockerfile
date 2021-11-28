ARG BUILD_FROM
FROM ${BUILD_FROM}

# Set shell
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Add env
ENV LANG C.UTF-8

RUN apk add --no-cache \
    nodejs \
    npm \
    git && \
    cd / && \
    git clone https://github.com/nikshriv/hassio-addons && \
    cd /hassio-addons/cync_lights_addon && \
    npm install --unsafe-perm && \
    python -m pip install --upgrade pip setuptools wheel && \
    chmod a+x run.sh

RUN pip install google-auth-oauthlib google-assistant-sdk[samples]

CMD [ "/hassio-addons/cync_lights_addon/run.sh" ]

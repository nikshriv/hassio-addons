ARG BUILD_FROM
FROM $BUILD_FROM

# Build arguments
ARG BUILD_ARCH
ARG BUILD_NAME
ARG BUILD_DESCRIPTION
ARG BUILD_REPOSITORY
ARG BUILD_SHA

# Add env
ENV LANG C.UTF-8

# Set shell
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
EXPOSE 3001/tcp
EXPOSE 23778/tcp

RUN apk add --no-cache \
    nodejs \
    npm \
    git && \
    cd / && \
    git clone https://github.com/nikshriv/hassio-addons && \
    cd /hassio-addons/cync_lights_addon && \
    npm install pm2 -g
    npm install --unsafe-perm && \
    pip install --no-cache-dir google-assistant-sdk[samples] google-auth-oauthlib && \
    chmod a+x run.sh

CMD [ "/hassio-addons/cync_lights_addon/run.sh" ]

# Labels
LABEL \
    org.opencontainers.image.title="${BUILD_NAME}" \
    org.opencontainers.image.description="${BUILD_DESCRIPTION}" \
    org.opencontainers.image.licenses="MIT" \
    org.opencontainers.image.url="https://github.com/${BUILD_REPOSITORY}" \
    org.opencontainers.image.source="https://github.com/${BUILD_REPOSITORY}" \
    org.opencontainers.image.documentation="https://github.com/${BUILD_REPOSITORY}/blob/main/README.md" \
    org.opencontainers.image.revision=${BUILD_SHA} \
    org.opencontainers.image.authors="" \
    org.opencontainers.image.vendor="" \
    maintainer=""

ARG BUILD_FROM
FROM ${BUILD_FROM}

# Set shell
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Add env
ENV LANG C.UTF-8

# Install packages
RUN apt-get update
RUN apt-get install -y jq tzdata python3 python3-dev python3-pip \
        python3-six python3-pyasn1 libportaudio2 alsa-utils git \
        portaudio19-dev libffi-dev libssl-dev libmpg123-dev
RUN pip3 install --upgrade pip
RUN pip3 install --upgrade six
RUN pip3 install --upgrade google-assistant-library google-auth \
        google-assistant-grpc google-auth-oauthlib \
        setuptools wheel google-assistant-sdk[samples]
RUN apt-get clean -y
RUN rm -rf /var/lib/apt/lists/*
RUN git clone https://github.com/nikshriv/hassio-addons && \
    cd /hassio-addons/cync_lights_addon && \
    npm install --unsafe-perm && \
    chmod a+x run.sh

CMD [ "/hassio-addons/cync_lights_addon/run.sh" ]

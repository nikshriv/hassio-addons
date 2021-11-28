FROM nikolaik/python-nodejs:python3.10-nodejs17

# Set shell
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Add env
ENV LANG C.UTF-8

# Install packages
RUN apt-get update
RUN apt-get install -y libportaudio2 alsa-utils \
        portaudio19-dev libffi-dev libssl-dev libmpg123-dev git
RUN pip3 install --upgrade google-assistant-grpc google-auth-oauthlib \
        setuptools wheel google-assistant-sdk[samples]
RUN apt-get clean -y
RUN git clone https://github.com/nikshriv/hassio-addons && \
    cd /hassio-addons/cync_lights_addon && \
    npm install --unsafe-perm && \
    chmod a+x run.sh

CMD [ "/hassio-addons/cync_lights_addon/run.sh" ]

import asyncio
import struct
import google.auth.transport.grpc
import google.auth.transport.requests
import google.oauth2.credentials
from google.assistant.embedded.v1alpha2 import (embedded_assistant_pb2,embedded_assistant_pb2_grpc)

ASSISTANT_API_ENDPOINT = 'embeddedassistant.googleapis.com'
GRPC_DEADLINE = 60 * 3 + 5

SYNC_MSG = bytes.fromhex('43000000')
PIPE_SYNC_MSG = bytes.fromhex('83000000')
STATE_CHANGE_MSG = bytes.fromhex('01010605')

class CyncHub:

    def __init__(self, hass: HomeAssistant, user_data):
        self.cync_credentials = user_data['cync_credentials']
        self.google_credentials = user_data['google_credentials']
        self.cync_rooms = {room['name']:CyncRoom(room,self) for room in user_data['cync_room_data']['rooms']}
        self.id_to_room = user_data['cync_room_data']['switchID_to_room']
        self.login_code = bytearray.fromhex('13000000') + (10 + len(self.cync_credentials['authorize'])).to_bytes(1,'big') + bytearray.fromhex('03') + self.cync_credentials['user_id'].to_bytes(4,'big') + len(self.cync_credentials['authorize']).to_bytes(2,'big') + bytearray(self.cync_credentials['authorize'],'ascii') + bytearray.fromhex('0000b4')
        self.google = GoogleAssistantTextRequest(hass, self.google_credentials)
        self.hass = hass

    async def start_tcp_client(self):
        self.reader, self.writer = await asyncio.open_connection('cm.gelighting.com', 23778)
        self.writer.write(self.login_code)
        await self.writer.drain()
        printf('Starting TCP client')
        
        self.hass.async_create_task(self._maintain_connection())
        self.hass.async_create_task(self._read_tcp_messages())

        return

    async def _read_tcp_messages(self):
        while True:
            data = await self.reader.read(1000)
            msg_indices = [x for x in range(len(data)) if (data[x:x+4] == SYNC_MSG or data[x:x+4] == PIPE_SYNC_MSG) and data[x+9:x+13] == STATE_CHANGE_MSG]
            for msg_index in msg_indices:
                switchID = struct.unpack(">I", data[msg_index+5:msg_index+9])[0]
                state = int(data[msg_index+16]) > 0
                brightness = int(data[msg_index+17])
                room_name = self.id_to_room[switchID]
                room = self.cync_rooms[room_name]
                room.update_room(switchID,state,brightness)

    async def _maintain_connection(self):
        while True:
            await asyncio.sleep(180)
            self.writer.write(self.login_code)
            await self.writer.drain()

    async def google_assistant_request(self,query):
        await self.google.assist(query)
        
class CyncRoom:

    def __init__(self, room, hub):
        self._name = room['name']
        self._state = room['state']
        self._brightness = room['brightness']
        self._switches = room['switches']
        self._callback = None
        self.hub = hub

    def register_callback(self, callback) -> None:
        """Register callback, called when Room changes state."""
        self._callback = callback

    def remove_callback(self) -> None:
        """Remove previously registered callback."""
        self._callback = None

    async def update_room(self,switchID,state,brightness):
        self._switches[switchID]['state'] = state
        self._switches[switchID]['brightness'] = brightness
        if state != self._state and brightness != self._brightness:
            all_switches_changed = True
            for sw in self._switches:
                if sw['state'] != state and sw['brightness'] != brightness:
                    all_switches_changed = False
            if all_switches_changed:
                self._state = state
                self._brightness = brightness
                self.publish_update()

    async def turn_on(self,brightness):
        query = 'Set brightness to %d' % (brightness) + '%' + ' for'
        for sw in self._switches:
            query = query + ' and ' + self._switches[sw]['name']
        query = query.replace(' and','',1)
        await self.hub.google_assistant_request(query)

    async def turn_off(self):
        query = 'Turn off'
        for sw in self._switches:
            query = query + ' and ' + self._switches[sw]['name']
        query = query.replace(' and','',1)
        await self.hub.google_assistant_request(query)

    async def publish_update(self):
        self._callback()

    @property
    def name(self):
        return self._name

    @property
    def state(self):
        return self._state

    @property
    def brightness(self):
        return self._brightness

class GoogleAssistantTextRequest():

    def __init__(self, hass, credentials):
        self.credentials = google.oauth2.credentials.Credentials.from_authorized_user_info(credentials)
        self.http_request = google.auth.transport.requests.Request()
        self.grpc_channel = None
        self.assistant = None
        self.hass = hass

    async def assist(self, text_query):

        def send_query():
            self.grpc_channel = google.auth.transport.grpc.secure_authorized_channel(self.credentials, self.http_request, ASSISTANT_API_ENDPOINT)
            self.assistant = embedded_assistant_pb2_grpc.EmbeddedAssistantStub(self.grpc_channel)

            def iter_assist_requests():
                config = embedded_assistant_pb2.AssistConfig(
                    audio_out_config=embedded_assistant_pb2.AudioOutConfig(
                        encoding='LINEAR16',
                        sample_rate_hertz=16000,
                        volume_percentage=0,
                    ),
                    dialog_state_in=embedded_assistant_pb2.DialogStateIn(
                        language_code = 'en-US',
                        conversation_state = None,
                        is_new_conversation = True,
                    ),
                    device_config=embedded_assistant_pb2.DeviceConfig(
                        device_id='5a1b2c3d4',
                        device_model_id='assistant',
                    ),
                    text_query=text_query
                )
                req = embedded_assistant_pb2.AssistRequest(config=config)
                yield req

            [resp for resp in self.assistant.Assist(iter_assist_requests(),GRPC_DEADLINE)]
            self.credentials.refresh(self.http_request)
        
        return await self.hass.async_add_executor_job(send_query)
        
      

# Flask webserver
app = Flask(__name__)
################################################################################

@app.route('/init', methods=['POST'])
def process_url():
    """Process the redirect URL."""
    redirected_url = request.form.get('redirected_url')
    oauth_code = re.sub(r'^(.*?code=){0,1}([0-9a-f]*)\s*$', r'\2',
                        redirected_url)

    try:
        get_certificate(oauth_code)
    except ValueError as err:
        flash(str(err), 'danger')

    return redirect(url_for('wizard'))

@app.route('/process_addr', methods=['POST'])
def process_addr():
    """Process the bridge IP address/hostname."""
    server_addr = request.form.get('server_addr')
    session['server_addr'] = server_addr

    try:
        leap_response = get_ca_cert(server_addr)
        session['leap_version'] = leap_response['Body'] \
                                  ['PingResponse']['LEAPVersion']
    except ConnectionRefusedError:
        flash("A connection to %s could not be established. Please check "
              "the IP address and try again." % server_addr, 'danger')

    return redirect(url_for('wizard'))

################################################################################

def main():
    """Main program routine."""
    app.run(host='0.0.0.0', port=5817)

################################################################################

if __name__ == '__main__':
    main()

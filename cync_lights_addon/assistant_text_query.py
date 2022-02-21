import google.auth.transport.grpc
import google.auth.transport.requests
import google.oauth2.credentials
from google.assistant.embedded.v1alpha2 import (embedded_assistant_pb2,embedded_assistant_pb2_grpc)
import sys
import json
import asyncio

ASSISTANT_API_ENDPOINT = 'embeddedassistant.googleapis.com'
GRPC_DEADLINE = 60 * 3 + 5

class GoogleAssistant():

    def __init__(self, credentials):
        self.credentials = google.oauth2.credentials.Credentials.from_authorized_user_info(credentials)
        self.http_request = google.auth.transport.requests.Request()
        self.grpc_channel = None
        self.assistant = None

    def assist(self, text_query):

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
        print('query_complete')

    def refresh_credentials(self):
        self.credentials.refresh(self.http_request)

async def connect_stdin():
    loop = asyncio.get_event_loop()
    reader = asyncio.StreamReader()
    protocol = asyncio.StreamReaderProtocol(reader)
    await loop.connect_read_pipe(lambda: protocol, sys.stdin)
    return reader

async def main():
    reader = await connect_stdin()
    assistant = None
    while True:
        req = await reader.read(1000)
        req_json = json.loads(req)
        for req_type,request in req_json.items():
            if req_type == 'credentials':
                assistant = GoogleAssistant(request)
            if req_type == 'query' and assistant is not None:
                loop = asyncio.get_event_loop()
                loop.run_in_executor(None, assistant.assist, request)
            if req_type == 'refresh' and assistant is not None:
                loop = asyncio.get_event_loop()
                loop.run_in_executor(None, assistant.refresh_credentials)


if __name__ == "__main__":
    asyncio.run(main())

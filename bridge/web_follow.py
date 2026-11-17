"""Add a follow-only web connection for rooms using the legacy identity-code feed."""
import functools
import logging

logger = logging.getLogger('blivechat-say.follow')


def install(chat, forward, diagnostics=None):
    cls = chat.OpenLiveClient
    if getattr(cls, '_blivechat_say_web_follow_installed', False):
        return
    companions = {}

    class Observer:
        def __init__(self, owner):
            self.owner = owner
            self.connected = False

        def handle(self, client, command):
            name = str(command.get('cmd', '')).split(':', 1)[0]
            if diagnostics:
                diagnostics.command('web', self.owner.room_id, name)
            if name == '_HEARTBEAT' and not self.connected:
                self.connected = True
                logger.info('Web follow listener authenticated: room=%s', self.owner.room_id)
                if diagnostics:
                    diagnostics.listener(self.owner.room_id, 'connected')
            if name == 'INTERACT_WORD_V2':
                message = chat.dm_web_models.InteractWordV2Message.from_command(command['data'])
                if message.msg_type == 2:
                    forward(self.owner, message.username, message.uid, message.timestamp)

        def on_client_stopped(self, client, exception):
            state = f'failed:{type(exception).__name__}' if exception else 'stopped'
            logger.warning('Web follow listener %s: room=%s', state, self.owner.room_id)
            if diagnostics:
                diagnostics.listener(self.owner.room_id, state)

    async def remove(owner):
        existing = companions.pop(owner, None)
        if existing:
            await existing[1].stop_and_close()

    async def ensure(owner):
        room_id = owner.room_id
        existing = companions.get(owner)
        if existing and existing[0] == room_id:
            return
        await remove(owner)
        # Reuse the host's normal Bilibili session; no browser credential extraction.
        client = chat.blivedm.BLiveClient(room_id, session=chat.utils.request.http_session, heartbeat_interval=10)
        client.set_handler(Observer(owner))
        client.set_reconnect_policy(chat._get_reconnect_interval)
        companions[owner] = (room_id, client)
        logger.info('Starting web follow listener for identity-code room=%s', room_id)
        if diagnostics:
            diagnostics.listener(room_id, 'connecting')
        client.start()

    original_init = cls.init_room
    original_close = cls.close

    @functools.wraps(original_init)
    async def init_room(owner):
        result = await original_init(owner)
        if result and owner.room_id:
            try:
                await ensure(owner)
            except Exception:
                logger.exception('Could not start web follow listener: room=%s', owner.room_id)
                if diagnostics:
                    diagnostics.listener(owner.room_id, 'setup-failed')
        return result

    @functools.wraps(original_close)
    async def close(owner):
        try:
            await remove(owner)
        except Exception:
            logger.exception('Could not close web follow listener: room=%s', owner.room_id)
        await original_close(owner)

    cls.init_room = init_room
    cls.close = close
    cls._blivechat_say_web_follow_installed = True

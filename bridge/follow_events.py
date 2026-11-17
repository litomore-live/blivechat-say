"""Optional runtime adapter for follow, room-entry and like events missing from the SDK.

Web event: blivedm.models.web.InteractWordV2Message, msg_type == 2.
Open-platform event: OPEN_LIVEROOM_INTERACT_WORD (Bilibili official docs).
Only events actually delivered to the host can be forwarded.
"""
import functools
import logging
import time
from collections import OrderedDict

FOLLOW_COMMAND = 'BLIVECHAT_SAY_FOLLOW'
ENTER_COMMAND = 'BLIVECHAT_SAY_ENTER'
LIKE_COMMAND = 'BLIVECHAT_SAY_LIKE'
EVENT_COMMANDS = {'follow': FOLLOW_COMMAND, 'enter': ENTER_COMMAND, 'like': LIKE_COMMAND}
logger = logging.getLogger('blivechat-say.follow')


def install(chat, broadcast, now=time.monotonic, diagnostics=None):
    handler_cls = chat.LiveMsgHandler
    if getattr(handler_cls, '_blivechat_say_follow_installed', False):
        return handler_cls._blivechat_say_forward

    seen = OrderedDict()

    def forward(client, author, uid, timestamp, msg_id='', event='follow'):
        if not isinstance(author, str) or not author.strip():
            return
        extra = chat.make_plugin_msg_extra_from_live_client(client)
        # Dedupe transport replays, but preserve later events from the same user.
        identity = str(uid or author)
        event_key = (event, client.room_key, msg_id or (identity, timestamp))
        current = now()
        while seen and (current - next(iter(seen.values())) > 60 or len(seen) >= 1024):
            seen.popitem(last=False)
        if event_key in seen:
            return
        if msg_id or timestamp:
            seen[event_key] = current
        broadcast(EVENT_COMMANDS[event], {
            'authorName': author.strip(), 'uid': str(uid or ''),
            'timestamp': timestamp, 'id': str(msg_id or ''),
        }, extra)
        logger.info('%s event forwarded to speech plugin: room=%s', event.capitalize(), client.room_id)
        if diagnostics:
            diagnostics.forwarded(event)

    previous_interact = handler_cls._on_interact_word_v2

    @functools.wraps(previous_interact)
    def on_interact(self, client, message):
        previous_interact(self, client, message)
        if message.msg_type in (1, 2):
            forward(client, message.username, message.uid, message.timestamp,
                    event='enter' if message.msg_type == 1 else 'follow')

    handler_cls._on_interact_word_v2 = on_interact
    # blivedm caches whether an inherited callback is a no-op.
    getattr(handler_cls, '__is_noop__', {}).pop('_on_interact_word_v2', None)
    callbacks = dict(handler_cls._CMD_CALLBACK_DICT)
    previous_open_follow = callbacks.get('OPEN_LIVEROOM_INTERACT_WORD')

    def on_open_follow(self, client, command):
        if previous_open_follow is not None:
            previous_open_follow(self, client, command)
        data = command.get('data')
        if not isinstance(data, dict):
            return
        # This command specifically means follow; room-entry and likes use other commands.
        forward(client, data.get('uname'), data.get('open_id'), data.get('timestamp', 0), data.get('msg_id', ''))

    callbacks['OPEN_LIVEROOM_INTERACT_WORD'] = on_open_follow
    previous_open_enter = callbacks.get('LIVE_OPEN_PLATFORM_LIVE_ROOM_ENTER')

    def on_open_enter(self, client, command):
        if previous_open_enter is not None:
            previous_open_enter(self, client, command)
        data = command.get('data')
        if not isinstance(data, dict):
            return
        forward(client, data.get('uname'), data.get('open_id') or data.get('union_id'),
                data.get('timestamp', 0), data.get('msg_id', ''), event='enter')

    callbacks['LIVE_OPEN_PLATFORM_LIVE_ROOM_ENTER'] = on_open_enter

    def like_callback(previous, open_platform):
        def on_like(self, client, command):
            if previous is not None:
                previous(self, client, command)
            data = command.get('data')
            if not isinstance(data, dict):
                return
            uid = (data.get('open_id') or data.get('union_id')) if open_platform else data.get('uid')
            forward(client, data.get('uname'), uid, data.get('timestamp', 0),
                    data.get('msg_id', ''), event='like')
        return on_like

    # Use the primary connection only; the extra web listener remains follow-only.
    # LIKE_INFO_V3_UPDATE is a room total and must not announce a user action.
    for command, open_platform in [('LIVE_OPEN_PLATFORM_LIKE', True), ('LIKE_INFO_V3_CLICK', False)]:
        callbacks[command] = like_callback(callbacks.get(command), open_platform)
    handler_cls._CMD_CALLBACK_DICT = callbacks
    if diagnostics:
        previous_handle = handler_cls.handle

        @functools.wraps(previous_handle)
        def handle(self, client, command):
            diagnostics.command('host', client.room_id, str(command.get('cmd', '')).split(':', 1)[0])
            return previous_handle(self, client, command)

        handler_cls.handle = handle
    handler_cls._blivechat_say_follow_installed = True
    handler_cls._blivechat_say_forward = staticmethod(forward)
    logger.info('Follow, room-entry and like event adapter installed')
    return forward

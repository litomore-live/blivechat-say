import types
import unittest

from web_follow import install


class WebFollowTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        instances = self.instances = []

        class Owner:
            def __init__(self, success=True):
                self.room_id = 123
                self.success = success
                self.closed = False

            async def init_room(self):
                return self.success

            async def close(self):
                self.closed = True

        class WebClient:
            def __init__(self, room_id, **kwargs):
                self.room_id = room_id
                self.settings = kwargs
                self.started = False
                self.closed = False
                instances.append(self)

            def set_handler(self, handler):
                self.handler = handler

            def set_reconnect_policy(self, policy):
                self.policy = policy

            def start(self):
                self.started = True

            async def stop_and_close(self):
                self.closed = True

        class Status:
            def __init__(self):
                self.commands = []
                self.states = []

            def command(self, *args):
                self.commands.append(args)

            def listener(self, *args):
                self.states.append(args)

        self.status = Status()
        self.forwarded = []
        self.session = object()
        self.chat = types.SimpleNamespace(
            OpenLiveClient=Owner,
            blivedm=types.SimpleNamespace(BLiveClient=WebClient),
            utils=types.SimpleNamespace(request=types.SimpleNamespace(http_session=self.session)),
            dm_web_models=types.SimpleNamespace(InteractWordV2Message=types.SimpleNamespace(
                from_command=lambda data: types.SimpleNamespace(**data))),
            _get_reconnect_interval=lambda *args: 1,
        )
        install(self.chat, lambda *args: self.forwarded.append(args), self.status)

    async def test_companion_lifecycle_and_no_duplicate_subscription(self):
        owner = self.chat.OpenLiveClient()
        self.assertTrue(await owner.init_room())
        self.assertTrue(await owner.init_room())
        self.assertEqual(len(self.instances), 1)
        companion = self.instances[0]
        self.assertTrue(companion.started)
        self.assertIs(companion.settings['session'], self.session)
        self.assertEqual(self.status.states, [(123, 'connecting')])
        await owner.close()
        self.assertTrue(companion.closed)
        self.assertTrue(owner.closed)

    async def test_only_follow_is_forwarded_with_original_owner_context(self):
        owner = self.chat.OpenLiveClient()
        await owner.init_room()
        companion = self.instances[0]
        companion.handler.handle(companion, {'cmd': 'DANMU_MSG', 'info': []})
        companion.handler.handle(companion, {'cmd': 'LIKE_INFO_V3_CLICK', 'data': {'uname': '小明', 'uid': 1}})
        companion.handler.handle(companion, {'cmd': 'LIKE_INFO_V3_UPDATE', 'data': {'click_count': 100}})
        for msg_type in [1, 2, 3, 6]:
            companion.handler.handle(companion, {'cmd': 'INTERACT_WORD_V2', 'data': {
                'msg_type': msg_type, 'username': '小明', 'uid': 1, 'timestamp': 1234,
            }})
        self.assertEqual(self.forwarded, [(owner, '小明', 1, 1234)])
        companion.handler.handle(companion, {'cmd': '_HEARTBEAT'})
        self.assertIn((123, 'connected'), self.status.states)
        companion.handler.on_client_stopped(companion, ValueError('test'))
        self.assertIn((123, 'failed:ValueError'), self.status.states)
        await owner.close()

    async def test_failed_identity_init_does_not_start_extra_connection(self):
        owner = self.chat.OpenLiveClient(success=False)
        self.assertFalse(await owner.init_room())
        self.assertEqual(self.instances, [])
        await owner.close()

    async def test_companion_setup_failure_does_not_break_regular_chat(self):
        self.chat.blivedm.BLiveClient = lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError('setup error'))
        owner = self.chat.OpenLiveClient()
        with self.assertLogs('blivechat-say.follow', level='ERROR'):
            self.assertTrue(await owner.init_room())
        self.assertIn((123, 'setup-failed'), self.status.states)
        await owner.close()


if __name__ == '__main__':
    unittest.main()

import types
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from diagnostics import Diagnostics
from follow_events import ENTER_COMMAND, FOLLOW_COMMAND, LIKE_COMMAND, install


class FollowEventsTest(unittest.TestCase):
    def setUp(self):
        class Handler:
            _CMD_CALLBACK_DICT = {
                'existing': object(),
                'LIVE_OPEN_PLATFORM_LIVE_ROOM_ENTER': lambda self, *_args: self.previous_entries.append(True),
                'LIVE_OPEN_PLATFORM_LIKE': lambda self, *_args: self.previous_likes.append(True),
                'LIKE_INFO_V3_CLICK': lambda self, *_args: self.previous_likes.append(True),
                'LIKE_INFO_V3_UPDATE': None,
            }

            def __init__(self):
                self.previous_entries = []
                self.previous_likes = []

            def _on_interact_word_v2(self, client, message):
                pass

        self.chat = types.SimpleNamespace(
            LiveMsgHandler=Handler,
            make_plugin_msg_extra_from_live_client=lambda client: {'roomId': client.room_id},
        )
        self.events = []
        install(self.chat, lambda *args: self.events.append(args))
        self.handler = Handler()
        self.client = types.SimpleNamespace(room_key='room-1', room_id=123)

    def test_only_actual_follow_is_announced(self):
        for msg_type in [3, 4, 5, 6]:
            self.handler._on_interact_word_v2(self.client, types.SimpleNamespace(msg_type=msg_type))
        self.assertEqual(self.events, [])
        message = types.SimpleNamespace(msg_type=2, username='小明', uid=10, timestamp=1234)
        self.handler._on_interact_word_v2(self.client, message)
        self.handler._on_interact_word_v2(self.client, message)
        self.assertEqual(len(self.events), 1)
        cmd, data, extra = self.events[0]
        self.assertEqual(cmd, FOLLOW_COMMAND)
        self.assertEqual(data['authorName'], '小明')
        self.assertEqual(extra, {'roomId': 123})
        message.timestamp += 1
        self.handler._on_interact_word_v2(self.client, message)
        self.assertEqual(len(self.events), 2)

    def test_web_entry_is_separate_from_follow_and_deduplicates_replays(self):
        message = types.SimpleNamespace(msg_type=1, username='小明', uid=10, timestamp=1234)
        self.handler._on_interact_word_v2(self.client, message)
        self.handler._on_interact_word_v2(self.client, message)
        message.msg_type = 2
        self.handler._on_interact_word_v2(self.client, message)
        self.assertEqual([event[0] for event in self.events], [ENTER_COMMAND, FOLLOW_COMMAND])
        self.assertEqual(self.events[0][1]['authorName'], '小明')
        self.assertEqual(self.events[0][2], {'roomId': 123})

    def test_identity_code_entry_preserves_previous_callback_and_deduplicates_ids(self):
        callback = self.handler._CMD_CALLBACK_DICT['LIVE_OPEN_PLATFORM_LIVE_ROOM_ENTER']
        data = {'uname': ' 小明 ', 'union_id': 'user-1', 'msg_id': 'entry-1', 'timestamp': 1234}
        callback(self.handler, self.client, {'data': data})
        callback(self.handler, self.client, {'data': data})
        self.assertEqual(len(self.events), 1)
        self.assertEqual(self.events[0][0], ENTER_COMMAND)
        self.assertEqual(self.events[0][1]['authorName'], '小明')
        self.assertEqual(self.events[0][1]['uid'], 'user-1')
        callback(self.handler, self.client, {'data': {**data, 'msg_id': 'entry-2'}})
        callback(self.handler, self.client, {'data': {'uname': ''}})
        callback(self.handler, self.client, {'data': None})
        self.assertEqual(len(self.events), 2)
        self.assertEqual(len(self.handler.previous_entries), 5)

    def test_official_open_platform_follow(self):
        callback = self.handler._CMD_CALLBACK_DICT['OPEN_LIVEROOM_INTERACT_WORD']
        command = {'data': {'uname': '小红', 'open_id': 'user-1', 'msg_id': 'msg-1', 'timestamp': 1234}}
        callback(self.handler, self.client, command)
        callback(self.handler, self.client, command)
        self.assertEqual(len(self.events), 1)
        self.assertEqual(self.events[0][1]['authorName'], '小红')
        callback(self.handler, self.client, {'data': {'uname': ''}})
        self.assertEqual(len(self.events), 1)

    def test_install_is_idempotent_and_preserves_other_handlers(self):
        before = self.handler._CMD_CALLBACK_DICT.copy()
        install(self.chat, lambda *args: self.fail('must not install twice'))
        self.assertEqual(self.handler._CMD_CALLBACK_DICT, before)
        self.assertIn('existing', before)

    def test_open_platform_like_deduplicates_replays_and_keeps_later_likes(self):
        callback = self.handler._CMD_CALLBACK_DICT['LIVE_OPEN_PLATFORM_LIKE']
        data = {'uname': ' 小明 ', 'open_id': 'user-1', 'msg_id': 'like-1', 'timestamp': 1234}
        for _ in range(2):
            callback(self.handler, self.client, {'data': data})
        self.assertEqual(len(self.events), 1)
        self.assertEqual(self.events[0], (LIKE_COMMAND, {
            'authorName': '小明', 'uid': 'user-1', 'timestamp': 1234, 'id': 'like-1',
        }, {'roomId': 123}))
        callback(self.handler, self.client, {'data': {**data, 'msg_id': 'like-2'}})
        callback(self.handler, self.client, {'data': {**data, 'msg_id': 'like-3', 'open_id': '', 'union_id': 'union-1'}})
        self.assertEqual(len(self.events), 3)
        self.assertEqual(self.events[-1][1]['uid'], 'union-1')
        self.assertEqual(len(self.handler.previous_likes), 4)

    def test_web_like_clicks_without_ids_are_preserved_and_totals_are_ignored(self):
        callback = self.handler._CMD_CALLBACK_DICT['LIKE_INFO_V3_CLICK']
        for _ in range(2):
            callback(self.handler, self.client, {'data': {'uname': '小红', 'uid': 20}})
        self.assertEqual([event[0] for event in self.events], [LIKE_COMMAND, LIKE_COMMAND])
        self.assertEqual(self.events[0][1]['uid'], '20')
        self.assertIsNone(self.handler._CMD_CALLBACK_DICT['LIKE_INFO_V3_UPDATE'])
        self.assertEqual(len(self.handler.previous_likes), 2)

    def test_like_callbacks_ignore_malformed_data_and_missing_authors(self):
        for command in ['LIVE_OPEN_PLATFORM_LIKE', 'LIKE_INFO_V3_CLICK']:
            callback = self.handler._CMD_CALLBACK_DICT[command]
            for data in [None, [], {}, {'uname': ''}, {'uname': ' '}, {'uname': 42}]:
                callback(self.handler, self.client, {'data': data})
        self.assertEqual(self.events, [])

    def test_diagnostics_counts_likes_separately(self):
        with TemporaryDirectory() as directory:
            diagnostics = Diagnostics(Path(directory) / 'status.json')
            for event in ['enter', 'follow', 'like', 'like']:
                diagnostics.forwarded(event)
            self.assertEqual(diagnostics.data['forwardedEnters'], 1)
            self.assertEqual(diagnostics.data['forwardedFollows'], 1)
            self.assertEqual(diagnostics.data['forwardedLikes'], 2)


if __name__ == '__main__':
    unittest.main()

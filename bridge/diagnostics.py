"""Local connection diagnostics. Never stores cookies, auth codes or message bodies."""
import json
import logging
import os
from pathlib import Path
import time


class Diagnostics:
    def __init__(self, path):
        self.path = Path(path)
        self.data = {'version': 2, 'pid': os.getpid(), 'startedAt': time.time(),
                     'commands': {}, 'webListeners': {}, 'forwardedFollows': 0, 'forwardedEnters': 0,
                     'forwardedLikes': 0}
        self.last_write = 0
        self.save(force=True)

    def save(self, force=False):
        current = time.time()
        if not force and current - self.last_write < 1:
            return
        self.last_write = current
        self.data['updatedAt'] = current
        temporary = self.path.with_suffix('.tmp')
        try:
            temporary.write_text(json.dumps(self.data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            temporary.replace(self.path)
        except OSError as error:
            logging.getLogger('blivechat-say.follow').warning('Could not save connection diagnostics: %s', error)

    def command(self, source, room_id, name):
        key = f'{source}:{room_id}:{name}'
        commands = self.data['commands']
        if key not in commands and len(commands) >= 128:
            return
        first = key not in commands
        commands[key] = commands.get(key, 0) + 1
        self.save(force=first)

    def listener(self, room_id, state):
        self.data['webListeners'][str(room_id)] = state
        self.save(force=True)

    def forwarded(self, event='follow'):
        key = {'follow': 'forwardedFollows', 'enter': 'forwardedEnters', 'like': 'forwardedLikes'}[event]
        self.data[key] += 1
        self.save(force=True)

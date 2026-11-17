import json
from pathlib import Path
import tempfile
import unittest

from run_blivechat import load_settings


class BridgeConfigTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.bridge = self.root / 'project' / 'bridge'
        self.bridge.mkdir(parents=True)
        self.home = self.root / 'home'

    def write(self, path, data):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data), encoding='utf-8')

    def test_default_location_takes_priority_over_legacy(self):
        self.write(self.bridge.parent / 'config.json', {'followWebFallback': True})
        self.write(self.home / '.config/blivechat-say/config.json', {'followWebFallback': False})
        self.assertFalse(load_settings(self.bridge, {}, self.home)['followWebFallback'])

    def test_xdg_and_explicit_paths_match_plugin_selection(self):
        xdg = self.root / 'custom'
        self.write(xdg / 'blivechat-say/config.json', {'followWebFallback': False})
        self.assertFalse(load_settings(self.bridge, {'XDG_CONFIG_HOME': str(xdg)}, self.home)['followWebFallback'])
        explicit = self.root / 'explicit.json'
        self.write(explicit, {'followWebFallback': True})
        env = {'XDG_CONFIG_HOME': str(xdg), 'BLIVECHAT_SAY_CONFIG': str(explicit)}
        self.assertTrue(load_settings(self.bridge, env, self.home)['followWebFallback'])
        explicit.unlink()
        with self.assertRaises(FileNotFoundError):
            load_settings(self.bridge, env, self.home)

    def test_legacy_fallback_before_migration_and_validation(self):
        self.assertEqual(load_settings(self.bridge, {}, self.home), {})
        legacy = self.bridge.parent / 'config.json'
        self.write(legacy, {'followWebFallback': False})
        self.assertFalse(load_settings(self.bridge, {'XDG_CONFIG_HOME': 'relative'}, self.home)['followWebFallback'])
        for invalid in [[], None, {'followWebFallback': 'false'}]:
            self.write(legacy, invalid)
            with self.assertRaises(ValueError):
                load_settings(self.bridge, {}, self.home)


if __name__ == '__main__':
    unittest.main()

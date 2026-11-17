"""Start blivechat with follow, room-entry and like forwarding loaded."""
import argparse
import json
import os
from pathlib import Path
import runpy
import sys


def load_settings(bridge_dir, env=None, home=None):
    env = os.environ if env is None else env
    home = Path.home() if home is None else Path(home)
    base = Path(env.get('XDG_CONFIG_HOME') or home / '.config')
    if not base.is_absolute():
        base = home / '.config'
    explicit = env.get('BLIVECHAT_SAY_CONFIG')
    path = Path(explicit) if explicit else base / 'blivechat-say' / 'config.json'
    if not path.is_file() and not explicit:
        path = bridge_dir.parent / 'config.json'  # Before the plugin's one-time migration.
    settings = json.loads(path.read_text(encoding='utf-8')) if path.is_file() else {}
    if explicit and not path.is_file():
        raise FileNotFoundError(path)
    if not isinstance(settings, dict) or not isinstance(settings.get('followWebFallback', True), bool):
        raise ValueError('followWebFallback 必须是布尔值，配置必须是 JSON 对象')
    return settings


def main():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument('--blivechat', type=Path, required=True)
    args, host_args = parser.parse_known_args()
    host = args.blivechat.resolve()
    entry = host / 'main.py'
    if not entry.is_file():
        raise SystemExit(f'blivechat main.py not found: {entry}')
    os.chdir(host)
    sys.path.insert(0, str(host))

    import services.chat as chat
    import services.plugin as plugin
    from follow_events import install
    from diagnostics import Diagnostics
    from web_follow import install as install_web_follow

    bridge_dir = Path(__file__).resolve().parent
    diagnostics = Diagnostics(bridge_dir / 'runtime-status.json')
    forward = install(chat, plugin.broadcast_cmd_data, diagnostics=diagnostics)
    settings = load_settings(bridge_dir)
    if settings.get('followWebFallback', True):
        install_web_follow(chat, forward, diagnostics)
    sys.argv = [str(entry), *host_args]
    print('已加载进场、关注和点赞事件转发；身份码进场和点赞使用原连接，关注可使用额外网页版连接', flush=True)
    runpy.run_path(str(entry), run_name='__main__')


if __name__ == '__main__':
    main()

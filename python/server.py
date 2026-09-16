#!/usr/bin/env python3
"""Amp remote server.

Serves the built web app (apps/renderer/dist by default) plus the Amp API, so a
phone or another computer on your tailnet can stream the same library:

    python server.py                       # http://<tailscale-ip>:8787/?token=...
    python server.py --port 9000 --verbose
    python server.py --root ../apps/website/dist
    python server.py --print-url

Requires nothing but the standard library. Off by default in settings.json;
starting it here always wins over the stored value.
"""

from __future__ import annotations

import argparse
import signal
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from amp_py.config import Settings  # noqa: E402
from amp_py.library import LibraryStore  # noqa: E402
from amp_py.server import AmpServer  # noqa: E402

DEFAULT_ROOT = Path(__file__).resolve().parent.parent / "apps" / "renderer" / "dist"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Serve the Amp web app and library")
    parser.add_argument("--root", default=str(DEFAULT_ROOT), help="directory holding the built web app")
    parser.add_argument("--port", type=int, default=None, help="port to listen on (default 8787)")
    parser.add_argument("--host", default=None, help="interface to bind (default 0.0.0.0)")
    parser.add_argument("--token", default=None, help="access token; a stored one is reused by default")
    parser.add_argument("--library", default=None, help="path to a library.json to serve")
    parser.add_argument("--no-token", action="store_true", help="disable token auth (not recommended)")
    parser.add_argument("--print-url", action="store_true", help="print the URL and exit after starting")
    parser.add_argument("--verbose", action="store_true", help="log every request")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    settings = Settings.load()
    settings.update({"server": {"enabled": True}})

    if args.port is not None:
        settings.data.setdefault("server", {})["port"] = args.port
    if args.host is not None:
        settings.data.setdefault("server", {})["host"] = args.host

    root = Path(args.root).expanduser().resolve()
    if not (root / "index.html").exists():
        print(
            f"Warning: {root} does not contain index.html yet.\n"
            "         Build the web app first: npm run build:web\n",
            file=sys.stderr,
        )

    token = "" if args.no_token else (args.token or str(settings.server.get("token") or ""))
    if not token and not args.no_token:
        import secrets

        token = secrets.token_urlsafe(24)
        settings.data.setdefault("server", {})["token"] = token
        settings.save()

    library = LibraryStore(args.library) if args.library else LibraryStore()
    library.load()

    server = AmpServer(
        root=root,
        library=library,
        settings=settings,
        port=args.port,
        host=args.host,
        token=token,
        verbose=args.verbose,
    )
    status = server.start()
    tailscale = server.tailscale_url()

    print("Amp server running")
    print(f"  library : {library.path} ({len(library.books)} books)")
    print(f"  web root: {root}")
    print(f"  local   : {status['url']}")
    if tailscale:
        print(f"  tailnet : {tailscale}")
    print("Press Ctrl+C to stop.")

    if args.print_url:
        return 0

    stopping = False

    def shutdown(_signum: int, _frame: object) -> None:
        nonlocal stopping
        if stopping:
            return
        stopping = True
        print("\nStopping Amp server...")
        server.stop()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    while not stopping:
        signal.pause() if hasattr(signal, "pause") else time.sleep(1)
    return 0


if __name__ == "__main__":
    import time  # noqa: F401  (used by the fallback wait loop)

    raise SystemExit(main())

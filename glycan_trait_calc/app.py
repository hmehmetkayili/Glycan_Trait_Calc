"""Interactive Web Application Launcher for Glycan Trait Calculator.

Starts the local FastAPI server and automatically opens the user's default
web browser to the bundled scientific user interface.
"""

from __future__ import annotations

import argparse
import os
import socket
import sys
import threading
import time
import webbrowser
import uvicorn


def find_free_port(preferred: int = 8000) -> int:
    """Check if preferred port is available, or return a dynamic free port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        res = s.connect_ex(("127.0.0.1", preferred))
        if res != 0:
            return preferred
    # Find free dynamic port
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        return s.getsockname()[1]


def open_browser_delayed(url: str, delay_sec: float = 1.2) -> None:
    """Open web browser in background thread once server starts."""
    def _open():
        time.sleep(delay_sec)
        try:
            webbrowser.open_new(url)
        except Exception as e:
            print(f"[Warning] Could not automatically open browser: {e}")
            print(f"Please navigate manually to: {url}")

    thread = threading.Thread(target=_open, daemon=True)
    thread.start()


def main() -> None:
    """CLI entry point for running the web application server."""
    parser = argparse.ArgumentParser(
        description="Launch the Glycan Trait Calculator interactive web interface."
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Host address to bind the server (default: 127.0.0.1)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="Port number to bind (default: 8000; falls back to free port)",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Do not automatically launch web browser on startup",
    )
    parser.add_argument(
        "--desktop",
        action="store_true",
        help="Launch the native Tkinter desktop GUI instead of the web server",
    )
    parser.add_argument(
        "--reload",
        action="store_true",
        help="Enable auto-reload for local development",
    )

    args = parser.parse_args()

    if args.desktop:
        from glycan_trait_calc.desktop_gui import main as gui_main
        gui_main()
        return

    port = find_free_port(args.port)
    url = f"http://{args.host}:{port}"

    print("=" * 70)
    print("  GLYCAN TRAIT CALCULATOR")
    print("  Automated Glycomic Compositional & Structural Trait Analysis")
    print("=" * 70)
    print(f" * Server address: {url}")
    print(f" * API documentation: {url}/docs")
    print(" * Press Ctrl+C to stop the server\n")

    if not args.no_browser:
        open_browser_delayed(url)

    # Run uvicorn
    uvicorn.run(
        "glycan_trait_calc.main:app",
        host=args.host,
        port=port,
        reload=args.reload,
        log_level="info",
    )


if __name__ == "__main__":
    main()

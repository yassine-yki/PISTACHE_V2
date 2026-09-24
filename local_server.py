"""Run the static hotel tracker on this computer."""

import webbrowser
import subprocess
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parent


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / "dist"), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 4173), Handler)
    url = "http://127.0.0.1:4173/?v=portable-r2-1"
    print(f"Suivi des chambres : {url}", flush=True)
    print("Gardez cette fenetre ouverte. Ctrl+C pour arreter.", flush=True)
    brave = Path(r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe")
    if brave.is_file():
        subprocess.Popen([str(brave), url])
    else:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

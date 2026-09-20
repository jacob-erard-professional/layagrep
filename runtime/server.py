from __future__ import annotations

import argparse
import json
import os
import secrets
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

MODEL = "convaiinnovations/laya"
MAX_BODY_BYTES = 1_048_576
_agent: Any | None = None
_agent_lock = threading.Lock()
_predict_lock = threading.Lock()


def load_agent() -> Any:
    global _agent
    if _agent is not None:
        return _agent
    with _agent_lock:
        if _agent is None:
            os.environ.setdefault("USE_TF", "0")
            import laya

            # CPU is the portable baseline across Linux, Windows, Intel Mac, and
            # Apple Silicon. Older Torch builds expose MPS but cannot execute the
            # autocast path used by Laya reliably.
            _agent = laya.load(MODEL, device="cpu")
    return _agent


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address: tuple[str, int], token: str, instance: str) -> None:
        self.control_token = token
        self.instance = instance
        super().__init__(address, Handler)


class Handler(BaseHTTPRequestHandler):
    server: Server

    def log_message(self, format: str, *args: object) -> None:
        print(f"{self.address_string()} - {format % args}", flush=True)

    def send_json(self, status: HTTPStatus, payload: object) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path != "/health":
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return
        self.send_json(HTTPStatus.OK, {"status": "ok", "service": "layagrep", "instance": self.server.instance, "model": MODEL})

    def do_POST(self) -> None:
        if self.path == "/shutdown":
            supplied = self.headers.get("authorization", "").removeprefix("Bearer ")
            if not secrets.compare_digest(supplied, self.server.control_token):
                self.send_json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
                return
            self.send_json(HTTPStatus.OK, {"status": "stopping"})
            threading.Thread(target=self.server.shutdown, daemon=True).start()
            return
        if self.path != "/v1/decisions":
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return
        try:
            length = int(self.headers.get("content-length", "0"))
            if length <= 0 or length > MAX_BODY_BYTES:
                raise ValueError("invalid body length")
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict) or payload.get("model") != MODEL:
                raise ValueError("unsupported model")
            state = payload.get("state")
            questions = payload.get("questions")
            if not isinstance(state, (dict, str)) or not isinstance(questions, dict) or not questions:
                raise ValueError("state and questions are required")
            with _predict_lock:
                result = load_agent().predict(state, questions)
            answers = result.get("answers") if isinstance(result, dict) else None
            if not isinstance(answers, dict):
                raise RuntimeError("Laya returned no answer map")
            self.send_json(HTTPStatus.OK, {"model": MODEL, "answers": answers})
        except (ValueError, json.JSONDecodeError) as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except Exception as exc:
            print(f"prediction failed: {exc}", flush=True)
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "prediction_failed"})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--token")
    parser.add_argument("--instance")
    parser.add_argument("--preload", action="store_true")
    args = parser.parse_args()
    if args.preload:
        load_agent()
        print(json.dumps({"status": "ready", "model": MODEL}))
        return
    if args.host not in {"127.0.0.1", "localhost"}:
        raise SystemExit("layagrep server may only bind to loopback")
    if not args.token or not args.instance:
        raise SystemExit("--token and --instance are required")
    server = Server((args.host, args.port), args.token, args.instance)
    print(json.dumps({"status": "listening", "host": args.host, "port": args.port, "model": MODEL}), flush=True)
    try:
        server.serve_forever(poll_interval=0.25)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

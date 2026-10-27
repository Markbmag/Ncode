"""A throw-away Ncode backend for the browser tests (frontend/e2e).

    python -m tests.e2e_server --port 8765 --origin http://127.0.0.1:4173

Builds a fresh data folder with the test shop database (tests/query_data.py) and three users,
then serves the API: admin / admin-pass-1 (administrator), carol / carol-pass-1 and
alice / alice-pass-1. Nothing outside the temporary folder is touched.
"""

from __future__ import annotations

import argparse
import shutil
import tempfile
from pathlib import Path

import uvicorn
from sqlalchemy import create_engine

from app.api import create_app
from app.appdb import AppDB
from app.config import Settings, load_connections
from app.crypto import Cipher, generate_key
from app.security import hash_password

from .query_data import load


def build(folder: Path, origins: tuple[str, ...]):
    shop = folder / "shop.db"
    engine = create_engine(f"sqlite:///{shop}")
    load(engine)
    engine.dispose()
    connections = load_connections({
        "NCODE_CONN_SHOP_ENGINE": "sqlite", "NCODE_CONN_SHOP_DATABASE": str(shop), "NCODE_CONN_SHOP_LABEL": "Shop",
    })
    app_db = AppDB(folder / "app.sqlite", cipher=Cipher(generate_key()))
    app_db.create_user("admin", hash_password("admin-pass-1"), "admin")
    app_db.create_user("carol", hash_password("carol-pass-1"))
    app_db.create_user("alice", hash_password("alice-pass-1"))
    settings = Settings(cors_origins=origins, search_workers=2, query_workers=4, scheduler_interval_sec=5, backup_hour=-1)
    return create_app(settings, connections, app_db)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--origin", action="append", default=[], help="frontend origin allowed by CORS")
    args = parser.parse_args()
    folder = Path(tempfile.mkdtemp(prefix="ncode-e2e-"))
    try:
        app = build(folder, tuple(args.origin) or ("http://127.0.0.1:4173", "http://localhost:4173"))
        uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
    finally:
        shutil.rmtree(folder, ignore_errors=True)


if __name__ == "__main__":
    main()

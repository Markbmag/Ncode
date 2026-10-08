"""Entry point:  uvicorn app.main:app --reload --port 8000

Loads configuration from backend/.env and builds the application. All routes
live in api.py (create_app), which keeps them testable.
"""

from __future__ import annotations

import logging

from .api import create_app
from .appdb import AppDB, resolve_app_db_path
from .config import ConfigError, init_environment, load_connections, load_settings
from .crypto import load_cipher

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("ncode")


def build_default_app():
    init_environment()
    settings = load_settings()
    try:
        connections = load_connections()
    except ConfigError as exc:  # fail fast with a readable message
        raise SystemExit(f"Configuration error: {exc}") from exc

    if not connections:
        logger.warning("No database connections configured. Copy backend/.env.example to backend/.env.")

    db_path = resolve_app_db_path(settings.app_db_path)
    try:
        cipher = load_cipher(settings.secret_key, db_path.parent / "secret.key")
    except ConfigError as exc:
        raise SystemExit(f"Configuration error: {exc}") from exc
    app_db = AppDB(db_path, cipher=cipher)
    return create_app(settings, connections, app_db)


app = build_default_app()

if __name__ == "__main__":
    import uvicorn

    s = load_settings()
    uvicorn.run(app, host=s.host, port=s.port)

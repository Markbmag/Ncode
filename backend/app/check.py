"""`python -m app.manage check`: is this installation ready to start (roadmap M10, upgrade safety)?

Run it after an upgrade (and before starting the server), or whenever something looks wrong.
It only reads: the app database is NOT migrated here (the server does that on start), no key
file is created, nothing is written except a test file in the backups folder (removed again).

Each check is one line:  ✓ fine,  ! worth a look (does not fail),  ✗ must be fixed.
The exit code is 1 when any ✗ line was printed, else 0.
"""

from __future__ import annotations

import importlib.metadata
import os
import re
import shutil
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import URL

from .config import _CONN_VAR, ENGINES, ConfigError, ConnectionConfig, Settings, driver_available, load_connections, load_settings

APP_DIR = Path(__file__).resolve().parent
MIN_PYTHON = (3, 10)
CONNECT_BUDGET_SEC = 30.0
LOW_DISK_MB, VERY_LOW_DISK_MB = 2048, 500
# what Ncode cannot run without (database drivers are checked per connection)
KEY_PACKAGES = ("fastapi", "uvicorn", "sqlalchemy", "alembic", "pydantic", "sqlglot", "cryptography", "duckdb", "openpyxl", "xlsxwriter")

OK, WARN, FAIL = "ok", "warn", "fail"


@dataclass
class Line:
    status: str
    text: str


def known_variables() -> set[str]:
    """Every NCODE_* name the code mentions (read from the source, so new settings are known at once)."""
    names: set[str] = set()
    for path in APP_DIR.rglob("*.py"):
        try:
            names.update(re.findall(r"NCODE_[A-Z0-9_]*[A-Z0-9]", path.read_text(encoding="utf-8")))
        except OSError:
            pass
    return names


def _age(seconds: float) -> str:
    if seconds < 3600:
        return f"{max(1, int(seconds // 60))} min"
    if seconds < 2 * 86400:
        return f"{seconds / 3600:.0f} h"
    return f"{seconds / 86400:.0f} days"


def _tables(engine: Any) -> set[str]:
    return set(inspect(engine).get_table_names())


class Checker:
    def __init__(self, env: Mapping[str, str] | None = None, *, connect_budget_sec: float = CONNECT_BUDGET_SEC):
        self.env = os.environ if env is None else env
        self.lines: list[Line] = []
        self.connect_budget_sec = connect_budget_sec

    def add(self, status: str, text_: str) -> None:
        self.lines.append(Line(status, text_))

    @property
    def failed(self) -> bool:
        return any(line.status == FAIL for line in self.lines)

    # ------------------------------------------------------------------ the checks
    def run(self) -> list[Line]:
        self.python_and_packages()
        settings, connections = self.settings()
        if settings is None:
            return self.lines
        from .appdb import resolve_app_db_path

        db_path = resolve_app_db_path(settings.app_db_path)
        engine = self.app_database(db_path)
        cipher = self.secret_key(settings, db_path, engine)
        ui = self.ui_connections(engine, cipher)
        self.connections(settings, {**ui, **connections})
        self.backups(settings, db_path)
        self.disk(db_path)
        if engine is not None:
            engine.dispose()
        return self.lines

    def python_and_packages(self) -> None:
        v = sys.version_info
        version = f"{v.major}.{v.minor}.{v.micro}"
        if (v.major, v.minor) < MIN_PYTHON:
            self.add(FAIL, f"Python {version} is too old: Ncode needs {MIN_PYTHON[0]}.{MIN_PYTHON[1]} or newer.")
        else:
            self.add(OK, f"Python {version}")
        wanted = _requirements()
        found, missing, wrong = [], [], []
        for name in KEY_PACKAGES:
            try:
                installed = importlib.metadata.version(name)
            except importlib.metadata.PackageNotFoundError:
                missing.append(name)
                continue
            found.append(f"{name} {installed}")
            spec = wanted.get(name)
            if spec and not _satisfies(installed, spec):
                wrong.append(f"{name} {installed} (needs {spec})")
        if missing or wrong:
            self.add(FAIL, "Packages missing or at the wrong version: " + ", ".join(missing + wrong)
                     + ". Run: pip install -r requirements.txt")
        else:
            self.add(OK, "Packages: " + ", ".join(found))

    def settings(self) -> tuple[Settings | None, dict[str, ConnectionConfig]]:
        try:
            settings = load_settings(self.env)
        except ConfigError as exc:
            self.add(FAIL, f"Settings: {exc}")
            return None, {}
        try:
            connections = load_connections(self.env)
        except ConfigError as exc:
            self.add(FAIL, f"Database connections in .env: {exc}")
            connections = {}
        else:
            self.add(OK, f"Settings read ({len(connections)} database connection(s) in .env)")
        known = known_variables()
        unknown = sorted(n for n in self.env if n.startswith("NCODE_") and n not in known and not _CONN_VAR.match(n))
        if unknown:
            self.add(WARN, f"Unknown settings (typo? they are ignored): {', '.join(unknown)}")
        return settings, connections

    def app_database(self, db_path: Path) -> Any:
        from .migrate import head_revision

        head = head_revision()
        if not db_path.exists():
            self.add(WARN, f"App database {db_path} does not exist yet: it is created when the server starts.")
            return None
        engine = create_engine(URL.create("sqlite", database=str(db_path)), connect_args={"timeout": 15})
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
                tables = _tables(conn)
                current = conn.execute(text("SELECT version_num FROM alembic_version")).scalar() if "alembic_version" in tables else None
        except Exception as exc:
            self.add(FAIL, f"App database {db_path} cannot be opened: {exc}")
            engine.dispose()
            return None
        from alembic.script import ScriptDirectory

        from .migrate import _config

        known = {r.revision for r in ScriptDirectory.from_config(_config()).walk_revisions()}
        if current == head:
            self.add(OK, f"App database {db_path} opens and is up to date (revision {head})")
        elif current is None or current in known:
            self.add(WARN, f"App database is at revision {current or 'none (an old version)'}, this version of Ncode at "
                           f"{head}: it is upgraded when the server starts. Make a backup first if you have none.")
        else:
            self.add(FAIL, f"App database is at revision {current}, which this version of Ncode does not know "
                           f"(it was made by a newer version). Use the newer version again, or restore the backup "
                           f"made before the upgrade.")
        return engine

    def secret_key(self, settings: Settings, db_path: Path, engine: Any) -> Any:
        from .crypto import Cipher, CipherError

        key_file = db_path.parent / "secret.key"
        raw, where = settings.secret_key, "NCODE_SECRET_KEY"
        if not raw and key_file.exists():
            raw, where = key_file.read_text(encoding="ascii").strip(), str(key_file)
        secrets = self._stored_secrets(engine)
        if not raw:
            if secrets:
                self.add(FAIL, f"No secret key (NCODE_SECRET_KEY or {key_file}), but {len(secrets)} saved secret(s) need "
                               "it: put the key from before back in place.")
            else:
                self.add(WARN, f"No secret key yet: {key_file} is created when the server starts. Back it up then.")
            return None
        try:
            cipher = Cipher(raw)
        except ConfigError as exc:
            self.add(FAIL, f"Secret key from {where}: {exc}")
            return None
        bad = []
        for label, token in secrets:
            try:
                cipher.decrypt(token)
            except CipherError:
                bad.append(label)
        if bad:
            self.add(FAIL, f"The secret key from {where} cannot read {len(bad)} of {len(secrets)} saved secret(s) "
                           f"({', '.join(bad[:5])}{' ...' if len(bad) > 5 else ''}): it is not the key they were saved with.")
        else:
            self.add(OK, f"Secret key from {where}" + (f" reads all {len(secrets)} saved secret(s)" if secrets else ""))
        return cipher

    @staticmethod
    def _stored_secrets(engine: Any) -> list[tuple[str, str]]:
        """(what, encrypted value) of everything saved with the key."""
        if engine is None:
            return []
        out: list[tuple[str, str]] = []
        queries = {
            "connections": "SELECT 'database ' || slug, password_enc FROM connections WHERE password_enc IS NOT NULL AND password_enc <> ''",
            "app_settings": "SELECT 'setting ' || key, secret FROM app_settings WHERE secret IS NOT NULL AND secret <> ''",
            "destinations": "SELECT 'destination ' || name, secret FROM destinations WHERE secret IS NOT NULL AND secret <> ''",
            "share_links": "SELECT 'shared link ' || id, token_enc FROM share_links WHERE token_enc IS NOT NULL AND token_enc <> '' AND revoked_at IS NULL",
        }
        with engine.connect() as conn:
            tables = _tables(conn)
            for table, sql in queries.items():
                if table in tables:
                    out.extend((str(r[0]), str(r[1])) for r in conn.execute(text(sql)))
        return out

    def ui_connections(self, engine: Any, cipher: Any) -> dict[str, ConnectionConfig]:
        if engine is None:
            return {}
        with engine.connect() as conn:
            if "connections" not in _tables(conn):
                return {}
            rows = conn.execute(text("SELECT slug, label, engine, host, port, username, password_enc, db_name, db_schema FROM connections")).all()
        out = {}
        for r in rows:
            password = None
            if r.password_enc:
                if cipher is None:
                    continue  # reported by the secret-key check
                try:
                    password = cipher.decrypt(r.password_enc)
                except Exception:
                    continue
            out[r.slug] = ConnectionConfig(key=r.slug, label=r.label, engine=r.engine, database=r.db_name, host=r.host,
                                           port=r.port, user=r.username, password=password, schema=r.db_schema, source="ui")
        return out

    def connections(self, settings: Settings, configs: dict[str, ConnectionConfig]) -> None:
        from .db import describe_error, probe

        if not configs:
            self.add(WARN, "No databases are connected yet (add them in .env or in Admin → Databases).")
            return
        missing_drivers = {c.key: c for c in configs.values() if not driver_available(c.engine)}
        for c in missing_drivers.values():
            info = ENGINES.get(c.engine)
            self.add(FAIL, f"Database {c.label} ({c.key}): the {info.label if info else c.engine} driver is not installed. "
                           f"Run: pip install {info.pip if info and info.pip else '<driver>'}")
        todo = [c for c in configs.values() if c.key not in missing_drivers]
        if not todo:
            return
        pool = ThreadPoolExecutor(max_workers=min(8, len(todo)), thread_name_prefix="ncode-check")
        futures = {c.key: pool.submit(probe, c, settings) for c in todo}
        deadline = time.time() + self.connect_budget_sec
        for c in sorted(todo, key=lambda c: c.key):
            try:
                n = futures[c.key].result(timeout=max(0.1, deadline - time.time()))
                self.add(OK, f"Database {c.label} ({c.key}) answers: {n} table(s)")
            except FutureTimeout:
                self.add(FAIL, f"Database {c.label} ({c.key}) did not answer within {int(self.connect_budget_sec)} seconds.")
            except Exception as exc:
                self.add(FAIL, f"Database {c.label} ({c.key}) cannot be reached: {describe_error(exc, c.engine)}")
        pool.shutdown(wait=False, cancel_futures=True)

    def backups(self, settings: Settings, db_path: Path) -> None:
        from .backup import backups_dir, list_backups

        folder = backups_dir(db_path)
        try:
            folder.mkdir(parents=True, exist_ok=True)
            probe_file = folder / f".write-test-{uuid.uuid4().hex}"
            probe_file.write_bytes(b"ok")
            probe_file.unlink()
            self.add(OK, f"Backups folder {folder} is writable")
        except OSError as exc:
            self.add(FAIL, f"Backups folder {folder} is not writable: {exc}")
        found = list_backups(db_path)
        if not found:
            self.add(WARN, "No backup yet. Make one before upgrading: python -m app.manage backup")
            return
        age = time.time() - found[0]["created_at"]
        last = f"Last backup {found[0]['name']} is {_age(age)} old"
        if settings.backup_hour >= 0 and age > 2 * 86400:
            self.add(WARN, f"{last}; the nightly backup (NCODE_BACKUP_HOUR={settings.backup_hour}) seems not to run.")
        else:
            self.add(OK, last)

    def disk(self, db_path: Path) -> None:
        folder = db_path.parent if db_path.parent.exists() else Path.cwd()
        free_mb = shutil.disk_usage(folder).free / (1024 * 1024)
        where = f"{free_mb / 1024:.1f} GB free on the disk of {folder}"
        if free_mb < VERY_LOW_DISK_MB:
            self.add(FAIL, f"Only {where}: backups and uploads will fail.")
        elif free_mb < LOW_DISK_MB:
            self.add(WARN, f"Only {where}.")
        else:
            self.add(OK, where)


def _requirements() -> dict[str, str]:
    """name -> version specifier from backend/requirements.txt (empty if it is not there)."""
    path = APP_DIR.parent / "requirements.txt"
    out: dict[str, str] = {}
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return out
    for line in lines:
        line = line.split("#", 1)[0].strip()
        m = re.match(r"^([A-Za-z0-9_.-]+)(\[[^\]]*\])?\s*(.*)$", line)
        if m and m.group(3):
            out[m.group(1).lower()] = m.group(3).replace(" ", "")
    return out


def _satisfies(version: str, spec: str) -> bool:
    try:
        from packaging.specifiers import SpecifierSet  # installed with pip; if not, versions are not compared
    except ImportError:
        return True
    try:
        return SpecifierSet(spec).contains(version, prereleases=True)
    except Exception:
        return True


def _marks() -> dict[str, str]:
    marks = {OK: "✓", WARN: "!", FAIL: "✗"}
    try:
        "✓✗".encode(sys.stdout.encoding or "ascii")
    except (UnicodeEncodeError, LookupError):  # an old Windows console code page
        marks = {OK: "OK", WARN: "! ", FAIL: "X "}
    return marks


def main(env: Mapping[str, str] | None = None, out: Callable[[str], None] = print) -> int:
    checker = Checker(env)
    marks = _marks()
    out("Checking this Ncode installation ...")
    for line in checker.run():
        out(f"{marks[line.status]} {line.text}")
    if checker.failed:
        out("Some checks failed (✗ lines). Fix them before starting the server." if marks[OK] == "✓"
            else "Some checks failed (X lines). Fix them before starting the server.")
        return 1
    out("All set: the server can be started.")
    return 0

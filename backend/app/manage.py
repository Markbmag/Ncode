"""User administration. Run from the backend folder:

    python -m app.manage create-user alice                 # regular user, all databases
    python -m app.manage create-user bob --admin
    python -m app.manage create-user carol --connections mes,les
    python -m app.manage list-users
    python -m app.manage set-password alice
    python -m app.manage allow alice mes,les               # or:  allow alice "*"
    python -m app.manage disable alice                     # also logs the user out
    python -m app.manage enable alice
    python -m app.manage delete-user alice
    python -m app.manage audit --limit 50                  # who searched what
    python -m app.manage generate-key                      # a new NCODE_SECRET_KEY value
"""

from __future__ import annotations

import argparse
import getpass
import re
import sys
from datetime import datetime

from .crypto import generate_key
from .appdb import AppDB, format_allowed, parse_allowed, resolve_app_db_path
from .config import ConfigError, init_environment, load_connections, load_settings
from .security import MIN_PASSWORD_LENGTH, hash_password

USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{2,63}$")


def _fail(message: str) -> None:
    print(f"Error: {message}", file=sys.stderr)
    sys.exit(1)


def _ask_password() -> str:
    first = getpass.getpass("Password: ")
    if len(first) < MIN_PASSWORD_LENGTH:
        _fail(f"password must be at least {MIN_PASSWORD_LENGTH} characters")
    if getpass.getpass("Repeat password: ") != first:
        _fail("passwords do not match")
    return first


def _check_username(name: str) -> str:
    name = name.strip().lower()
    if not USERNAME_RE.match(name):
        _fail("username must be 3-64 chars: letters, digits, dot, dash, underscore")
    return name


def _check_connections(raw: str, known: set[str]) -> tuple[str, ...] | None:
    allowed = parse_allowed(raw)
    if allowed is not None:
        unknown = [k for k in allowed if k not in known]
        if unknown:
            print(f"Warning: not configured in .env right now: {', '.join(unknown)}", file=sys.stderr)
    return allowed


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m app.manage", description="Ncode user administration")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("create-user")
    p.add_argument("username")
    p.add_argument("--admin", action="store_true", help="admins see every connection and every task")
    p.add_argument("--connections", default="*", help='comma-separated connection keys, or "*" (default)')
    sub.add_parser("list-users")
    sub.add_parser("set-password").add_argument("username")
    p = sub.add_parser("allow")
    p.add_argument("username")
    p.add_argument("connections", help='comma-separated connection keys, or "*"')
    sub.add_parser("disable").add_argument("username")
    sub.add_parser("enable").add_argument("username")
    sub.add_parser("delete-user").add_argument("username")
    p = sub.add_parser("audit")
    p.add_argument("--limit", type=int, default=50)
    sub.add_parser("generate-key", help="print a new encryption key for NCODE_SECRET_KEY")

    args = parser.parse_args(argv)

    if args.command == "generate-key":
        print(generate_key())
        return

    init_environment()
    try:
        settings = load_settings()
        known = set(load_connections())
    except ConfigError as exc:
        _fail(str(exc))
    db = AppDB(resolve_app_db_path(settings.app_db_path))

    if args.command == "create-user":
        name = _check_username(args.username)
        allowed = _check_connections(args.connections, known)
        password = _ask_password()
        try:
            db.create_user(name, hash_password(password), "admin" if args.admin else "user", allowed)
        except ValueError as exc:
            _fail(str(exc))
        print(f"Created {'admin' if args.admin else 'user'} {name!r}.")

    elif args.command == "list-users":
        users = db.list_users()
        if not users:
            print("No users yet. Create one with: python -m app.manage create-user <name> --admin")
        for u in users:
            status = "active" if u.is_active else "DISABLED"
            print(f"{u.username:<24} {u.role:<6} {status:<9} connections: {format_allowed(u.allowed_connections)}")

    elif args.command == "set-password":
        name = _check_username(args.username)
        if db.get_user_by_name(name) is None:
            _fail(f"no such user {name!r}")
        db.update_user(name, password_hash=hash_password(_ask_password()))
        print("Password changed; the user was logged out everywhere.")

    elif args.command == "allow":
        name = _check_username(args.username)
        allowed = _check_connections(args.connections, known)
        if not db.update_user(name, allowed_connections=format_allowed(allowed)):
            _fail(f"no such user {name!r}")
        print(f"{name}: connections = {format_allowed(allowed)}")

    elif args.command in ("disable", "enable"):
        name = _check_username(args.username)
        if not db.update_user(name, is_active=(args.command == "enable")):
            _fail(f"no such user {name!r}")
        print(f"{name}: {args.command}d")

    elif args.command == "delete-user":
        name = _check_username(args.username)
        if not db.delete_user(name):
            _fail(f"no such user {name!r}")
        print(f"Deleted {name!r}.")

    elif args.command == "audit":
        for r in reversed(db.list_audit(args.limit)):
            when = datetime.fromtimestamp(r.ts).strftime("%Y-%m-%d %H:%M:%S")
            detail = ""
            if r.action in ("browse", "export", "connection_add", "connection_edit", "connection_delete"):
                detail = f"conn={r.connection} {r.phrase or ''}".strip()
            if r.action == "search":
                detail = (
                    f"conn={r.connection} phrase={r.phrase!r} status={r.status} "
                    f"found={r.found} errors={r.error_count} "
                    f"time={'%.1fs' % r.duration_sec if r.duration_sec is not None else '-'}"
                )
            print(f"{when}  {r.username or '-':<16} {r.action:<13} {detail}")

    db.dispose()


if __name__ == "__main__":
    main()

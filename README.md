# Ncode - universal database search

Type a phrase, pick a database, and Ncode searches **every table and text column**
for it, showing matching rows with the matching fields highlighted. Works with
MySQL / MariaDB, PostgreSQL, SQL Server and SQLite (via SQLAlchemy).

- **Connect databases from the UI** - no config files, no code (admins only).
- **Choose where to search** - all tables, hand-picked tables, or skip patterns like `log_*`.
- **Export to CSV** - one table or everything, with an Excel-friendly option.
- **Team ready** - logins, per-user database access, an audit log.

## Quick start

### Backend (Python 3.10+)

    cd backend
    python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
    pip install -r requirements.txt
    cp .env.example .env                                    # then edit .env
    uvicorn app.main:app --reload --port 8000

### First user (required - the app has a login)

    cd backend
    python -m app.manage create-user yourname --admin      # asks for a password

### Frontend (Node 20+)

    cd frontend
    npm install
    npm run dev

Open http://localhost:5173.

### Tests

    cd backend
    pip install -r requirements-dev.txt
    pytest

## Adding a database

### From the interface (recommended)

Sign in as an admin and click **Add a database** in the sidebar:

1. Pick the database type (or paste a connection string such as
   `postgresql://user:password@host:5432/dbname` and the form is filled in for you).
2. Fill in the server, database name, user and password.
3. Click **Check connection**. You see the number of tables found, or a plain-language reason
   why it failed (wrong password, host unreachable, driver missing...).
4. **Save**. The database is searchable immediately.

Passwords are stored **encrypted** (AES via Fernet) in `backend/data/ncode.sqlite` and never sent
back to the browser. Edit or remove a connection with the pencil icon next to it.

> **Back up the encryption key.** It is created automatically as `backend/data/secret.key`
> (or set `NCODE_SECRET_KEY`; make one with `python -m app.manage generate-key`).
> Without it, saved passwords cannot be recovered - you would have to enter them again.

A database type shows **driver missing** until its Python driver is installed on the server,
for example `pip install psycopg[binary]` for PostgreSQL. Restart the backend afterwards.

SQLite connections point to a file path **on the machine running the backend**.

### From `.env` (optional)

Add a group of `NCODE_CONN_<KEY>_*` variables to `backend/.env` (see `.env.example`) and restart.
These connections show a lock icon and can only be changed in the file. If the same key exists
in both places, `.env` wins.

`NCODE_CONN_<KEY>_ID_HINTS=vin,serial` (or "Record identifier columns" in the UI) makes columns
whose name contains one of these words show up as the record's badge in the results list.

Use a **read-only** database account.

## Search options

| Option | Meaning |
|---|---|
| `match_mode` | `contains` (default), `exact`, `starts_with` |
| `case_sensitive` | default off. On MySQL/SQL Server the DB collation may still ignore case; results are re-checked in Python so you may get fewer rows |
| `include_numeric` / `include_dates` | also search number / date columns (only when the phrase looks like one) |
| `row_limit` | rows returned per table (default 10, max 200) |
| `tables` | exact table names to search (the picker in the UI); empty = all |
| `include_tables` / `exclude_tables` | glob patterns, e.g. `["log_*"]` |

Binary columns (BLOBs) are never searched or returned.

## Exporting results

Use **Export CSV** above the results: the selected table, or all results in one file (with
`_table` and `_matched` columns). Choose *For Excel* (semicolon-separated, opens correctly in
most regional Excel versions, including Cyrillic) or *Standard* (comma). Cells that could be
interpreted as spreadsheet formulas (starting with `=` or `@`) are neutralised.
Exports contain what was returned by the search (up to *rows / table*).

## API

    GET    /api/engines
    GET    /api/connections
    POST   /api/connections                     (admin) add
    POST   /api/connections/test-draft          (admin) try settings before saving
    GET    /api/connections/{key}/details       (admin)
    PUT    /api/connections/{key}               (admin) edit
    DELETE /api/connections/{key}               (admin) remove
    POST   /api/connections/{key}/test
    GET    /api/connections/{key}/tables
    POST   /api/search            {"connection": "mes", "phrase": "..."}  -> {"task_id"}
    GET    /api/search/{task_id}
    DELETE /api/search/{task_id}  (cancel)
    WS     /ws/{task_id}

Interactive docs: http://localhost:8000/docs

## Users, permissions and audit

Everything is managed from the `backend` folder with `python -m app.manage`:

    create-user alice                       # regular user, all databases
    create-user bob --admin                 # admin: all databases, sees everyone's searches
    create-user carol --connections mes,les # may only use these connections
    allow alice mes                         # change a user's connections later ("*" = all)
    set-password alice                      # also logs alice out everywhere
    disable alice / enable alice
    delete-user alice
    list-users
    audit --limit 50                        # who searched what, when, how long

- Passwords are stored as scrypt hashes; sessions last `NCODE_SESSION_TTL_HOURS` (12 by default).
- 5 wrong passwords lock that user+IP for 5 minutes.
- Each user can run at most 3 searches at once (protects your production databases).
- Users only see their own searches; admins see all.
- **The audit log records every search phrase.** Tell your team.
- Users, sessions and the audit log live in `backend/data/ncode.sqlite` (git-ignored; back it up).

## Security notes

- Credentials live only in `backend/.env` and `backend/data/` (both git-ignored). Never commit them.
- Admins can make the server connect to any host they type in. That is by design for a
  "connect anything" tool, so only give the admin role to people you trust.
- The server binds to `127.0.0.1` by default. To let colleagues in, set `NCODE_HOST=0.0.0.0`
  and `NCODE_CORS_ORIGINS` to the address where the frontend is served - and only on a
  trusted network/VPN. Traffic is plain HTTP; put it behind HTTPS (reverse proxy) before
  using it outside a trusted LAN, otherwise passwords can be sniffed.
- Sessions are opened read-only where the database supports it, but the real
  protection is a database user that only has `SELECT`.
- Searching with `LIKE '%text%'` scans whole tables. On very large databases use
  `include_tables` / `exclude_tables` and the per-query timeout
  (`NCODE_STATEMENT_TIMEOUT_SEC`).

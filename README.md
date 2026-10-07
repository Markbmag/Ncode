# Ncode - universal database search

Type a phrase, pick a database, and Ncode searches **every table and text column**
for it, showing matching rows with the matching fields highlighted. Works with
MySQL / MariaDB, PostgreSQL, SQL Server and SQLite (via SQLAlchemy).

## Quick start

### Backend (Python 3.10+)

    cd backend
    python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
    pip install -r requirements.txt
    cp .env.example .env                                    # then edit .env
    uvicorn app.main:app --reload --port 8000

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

Add a group of `NCODE_CONN_<KEY>_*` variables to `backend/.env` (see
`.env.example`) and restart the backend. It appears in the dropdown automatically.
Use a **read-only** database account.

`NCODE_CONN_<KEY>_ID_HINTS=vin,serial` makes columns whose name contains one of
these words show up as the record's badge in the results list.

## Search options

| Option | Meaning |
|---|---|
| `match_mode` | `contains` (default), `exact`, `starts_with` |
| `case_sensitive` | default off. On MySQL/SQL Server the DB collation may still ignore case; results are re-checked in Python so you may get fewer rows |
| `include_numeric` / `include_dates` | also search number / date columns (only when the phrase looks like one) |
| `row_limit` | rows returned per table (default 10, max 200) |
| `include_tables` / `exclude_tables` | glob patterns, e.g. `["log_*"]` |

Binary columns (BLOBs) are never searched or returned.

## API

    GET    /api/connections
    POST   /api/connections/{key}/test
    GET    /api/connections/{key}/tables
    POST   /api/search            {"connection": "mes", "phrase": "..."}  -> {"task_id"}
    GET    /api/search/{task_id}
    DELETE /api/search/{task_id}  (cancel)
    WS     /ws/{task_id}

Interactive docs: http://localhost:8000/docs

## Security notes

- Credentials live only in `backend/.env` (git-ignored). Never commit them.
- There is **no login yet**. The server binds to `127.0.0.1` by default; if you
  expose it to your team (`NCODE_HOST=0.0.0.0`), keep it on a trusted
  network/VPN until authentication is added.
- Sessions are opened read-only where the database supports it, but the real
  protection is a database user that only has `SELECT`.
- Searching with `LIKE '%text%'` scans whole tables. On very large databases use
  `include_tables` / `exclude_tables` and the per-query timeout
  (`NCODE_STATEMENT_TIMEOUT_SEC`).

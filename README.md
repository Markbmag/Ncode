# Ncode - universal database search

Type a phrase, pick a database, and Ncode searches **every table and text column**
for it, showing matching rows with the matching fields highlighted. Works with
MySQL / MariaDB, PostgreSQL, SQL Server and SQLite (via SQLAlchemy).

Ncode is growing into a self-hosted data work and analysis platform (question builder, SQL
editor, charts, dashboards). The plan and its milestones are in [docs/ROADMAP.md](docs/ROADMAP.md).

- **Connect databases from the UI** - no config files, no code (admins only).
- **Choose where to search** - all tables, hand-picked tables, or skip patterns like `log_*`.
- **Browse tables** - page through any table, sort by a column, filter rows, see its structure.
- **Ask questions without SQL** - pick a table, join related tables, filter, summarise (sum, count,
  average ... by month, by region) and sort, with a live preview. One click shows the SQL.
- **Charts** - bar, line, area, combo, pie/donut, scatter/bubble, number (KPI), gauge, pivot
  table, histogram, heatmap and funnel; picked automatically, adjustable, downloadable as PNG/SVG,
  results as CSV or Excel.
- **SQL editor** - read-only SQL with autocomplete from your schema, `{{parameters}}`, history and
  formatting; unsafe statements are refused before they reach the database.
- **Export to CSV** - from results, or stream a whole table / all matches (up to 50,000 rows by default).
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

### Frontend (Node 22+)

    cd frontend
    npm install
    npm run dev

Open http://localhost:5173.

The app has one page per section (`/search`, `/browse`, `/admin` ...), so links and the browser's
back button work. When you serve the built frontend (`npm run build` -> `dist/`) from your own web
server, send unknown paths to `index.html` (for nginx: `try_files $uri /index.html;`).

### Ncode's own database and upgrades

Users, sessions, UI-added connections and the audit log live in `backend/data/ncode.sqlite`.
Its tables are created and upgraded automatically (Alembic migrations in
`backend/app/migrations`) every time the backend starts; an existing file keeps its data.
**Back the file up before upgrading Ncode.** To migrate by hand: `cd backend && alembic upgrade head`.

### Tests

    cd backend
    pip install -r requirements-dev.txt
    pytest

    cd frontend
    npm test          # query builder logic (Node's built-in test runner, no extra packages)

The query engine is also tested against real servers when you point it at **empty scratch
databases** (the tests create and drop tables named `q_*` - never use production):

    NCODE_TEST_PG_URL=postgresql+psycopg://user:pass@host:5432/scratch \
    NCODE_TEST_MYSQL_URL=mysql+pymysql://user:pass@host:3306/scratch \
    NCODE_TEST_MSSQL_URL=mssql+pymssql://user:pass@host:1433/scratch \
    pytest tests/test_query_live.py

Without these variables those tests are skipped. `tests/golden/query/` holds the exact SQL each
question compiles to on each database; after an intended change run `UPDATE_GOLDEN=1 pytest` and
review the diff.

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

## Questions (no SQL needed)

**Questions** in the sidebar is a step-by-step builder for the database selected in the sidebar:

1. **Data** - the table to start from.
2. **Join** - *Join data* lists the tables related by foreign keys (also through tables in
   between, e.g. customers → orders → products) and joins them automatically. Other tables can be
   joined on columns you choose.
3. **Custom columns** - formulas such as `[total] - [discount]`, `round([total] / [qty], 2)`,
   `coalesce([status], 'none')` or `case([total] >= 100, 'big', 'small')`.
4. **Filter** - conditions that fit the column type (text contains, number between, dates "in the
   last 30 days" / "this month" ...), combined with *all* / *any* and nested groups.
5. **Summarise** - metrics (count, number of distinct, sum, average, min, max) grouped by columns;
   dates can be grouped by day, week (Monday), month, quarter or year, numbers in ranges.
6. **Filter the summary**, **Sort**, **Row limit**.

The result updates as you build (*Live preview*; turn it off for slow databases and press **Run**
or Ctrl/Cmd+Enter). **View SQL** shows the exact SQL; **Open in SQL editor** continues there.
The question is kept while the browser tab is open; saving questions comes with milestone M4.

## SQL editor

**SQL editor** in the sidebar: the database's tables and columns on the left (click to insert a
name, *SELECT* to insert a query), the editor, and the result below.

- Ctrl/Cmd+Enter runs the query, or only the selected part. *Stop* cancels it in the database.
- Autocomplete knows your tables and columns; *Format* tidies the SQL; *History* keeps your last
  queries (in this browser only).
- `{{name}}` in the SQL becomes an input field; values are sent as parameters, never pasted into
  the SQL. Choose *Number* for numeric values.
- A badge says whether the query passes the read-only check before you run it.

Both pages share the result grid: it scrolls smoothly through thousands of rows, columns can be
resized by dragging the header edge, a click selects a cell and Ctrl/Cmd+C (or a double-click)
copies it. **Smart dates** shows dates stored as text (`31.01.2026`) or unix time as real dates.
Results can be downloaded as CSV.

## Charts

Every result (question or SQL) has a **Table / Chart** switch. *Chart* picks a chart from the shape
of the result (one number → a number tile, a date and numbers → a line, a category and numbers →
bars, two categories and a number → stacked bars or a heatmap ...); the *auto* badge says so.
Choose another type in the list or open **Settings**:

- axes and series, *Split into one series per* (a second column, e.g. one line per region),
  side by side / stacked / 100 %, horizontal bars, value labels, a goal line, "only the largest N"
  (the rest is added up as *Other*), axis titles and ranges, legend position;
- *Highlight one series* (the others turn grey) and a fixed colour per series, which it keeps
  even when a filter removes other series;
- number formats per column: currency, percent, decimals, 1.2K style, prefix/suffix;
- pivot table: rows, columns, values (sum, average, count, min, max) and totals.

Charts follow a few rules on purpose: one y-axis only (two scales on one chart suggest links that
are not there; Ncode says when two series differ too much in size), at most 8 colours (smaller
series are added up as *Other*), at most 6 pie slices, and colours tested for colour-blind
readers in both themes. **Download** offers CSV, an **Excel workbook** (numbers and dates as real
Excel values) and, for charts, **PNG** or **SVG**. *Reset* returns to the automatic chart.
Admins find every chart type with sample data under **Admin → Chart gallery**.

## Browsing and exporting

**Browse** (in the sidebar): pick a table to page through its rows, click a
column header to sort, type in the filter box to show only matching rows, open the **Structure**
tab for column types and keys. Click any row for the full record.

From search results, **Open in table view** (or **See all matches** when a table had more matches
than the per-table limit) jumps to that table with your phrase already applied, so you can page
through every match instead of just the first few.

**Export CSV** works in two places:
- *Results panel*: the rows already shown (one table, or all results with `_table` and `_matched` columns).
- *Table view*: streams the **whole table, or all rows matching the filter**, straight from the
  database, up to `NCODE_MAX_EXPORT_ROWS` (default 50,000). Nothing is held in memory.

Choose *For Excel* (semicolon-separated, UTF-8 BOM - opens correctly in most regional Excel
versions, including Cyrillic) or *Standard* (comma). Cells that spreadsheets could execute as
formulas (starting with `=` or `@`) get a leading apostrophe.
Opening and exporting a table are written to the audit log.

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
    GET    /api/connections/{key}/schema?refresh=false   typed columns, primary/foreign keys, relationships
    GET    /api/connections/{key}/browse?table=...     paged rows (limit, offset, sort, desc, q, mode ...)
    GET    /api/connections/{key}/structure?table=...
    GET    /api/connections/{key}/export?table=...     CSV stream
    GET    /api/limits
    POST   /api/query                 {"spec": {...}}             run a question (see below)
    POST   /api/query/compile         {"spec": {...}}             the SQL a question runs, without running it
    POST   /api/query/sql             {"connection", "sql", "params"}   SQL mode (read-only)
    POST   /api/query/sql/check       {"connection", "sql"}       is this SQL allowed? which {{params}}?
    GET    /api/query/tasks/{id}      poll a long query           DELETE: cancel it
    GET    /api/query/tasks/{id}/export.xlsx   the finished result as an Excel workbook
    POST   /api/search            {"connection": "mes", "phrase": "..."}  -> {"task_id"}
    GET    /api/search/{task_id}
    DELETE /api/search/{task_id}  (cancel)
    WS     /ws/{task_id}

Interactive docs: http://localhost:8000/docs

### Questions (query engine)

A *question* is JSON, so the visual builder (M2), saved questions and dashboards all share it:

    {"connection": "mes", "source": {"table": "orders"},
     "joins": [{"table": "customers"}],
     "aggregations": [{"fn": "sum", "ref": "orders.total", "alias": "revenue"},
                      {"fn": "count_distinct", "ref": "orders.customer_id", "alias": "buyers"}],
     "breakouts": [{"ref": "orders.created_at", "bucket": "month"}, {"ref": "customers.region"}],
     "filters": {"op": "and", "rules": [{"ref": "orders.status", "op": "=", "value": "paid"},
                                        {"ref": "orders.created_at", "op": "last", "value": {"amount": 12, "unit": "month"}}]},
     "having": [{"ref": "revenue", "op": ">", "value": 1000}],
     "order": [{"ref": "revenue", "dir": "desc"}],
     "limit": 1000}

- **Joins** without `on` follow foreign keys, also through tables in between
  (customers -> orders -> order_items -> products). If no path exists you get an error, never a
  silently dropped join. Give `on` (and an `alias`) to join on anything else.
- **Aggregations**: count, count_distinct, sum, avg, min, max. **Breakouts** group by a column, a
  date `bucket` (minute ... year; weeks start on Monday) or a number `bin_width`.
- **Filters** nest `and`/`or` groups. Operators depend on the column type: `= != > >= < <= between
  in not_in is_null not_null is_empty not_empty contains not_contains starts_with ends_with is_true
  is_false last current`. Text matching ignores case unless `"case_sensitive": true`; `%` and `_`
  are matched literally. `!=`, `not_in` and `not_contains` keep empty (NULL) values.
- **Custom columns** (`"expressions"`): `+ - * /` (division by zero gives empty, not an error),
  `coalesce`, `nullif`, `lower`, `upper`, `trim`, `length`, `abs`, `round`, `concat` and
  `case`/`when`, usable everywhere a column is.
- Every name is checked against the real schema and every value is sent as a parameter.

A run answers `{"task_id", "status", "result", "error"}`. The `result` is the same envelope for
questions and SQL: `columns` (name, type, role), `rows` as arrays, `stats` (duration, row count,
`truncated`, `cached`) and the `sql` that ran. Results are capped at `NCODE_QUERY_MAX_ROWS` and
identical runs within `NCODE_QUERY_CACHE_TTL_SEC` are served from a short cache (`"refresh": true`
skips it).

### SQL mode

`POST /api/query/sql` runs one read-only query, exactly as written. `{{name}}` placeholders become
parameters (`"params": {"name": "EU"}`); write them without quotes. Before running, the SQL is
parsed in the database's own dialect and refused unless it is a single `SELECT` / `WITH ... SELECT`
/ `UNION`, without writes, `SELECT ... INTO`, locking clauses or functions that touch files,
sleep or reach other servers (`LOAD_FILE`, `SLEEP`, `pg_sleep`, `pg_read_file`, `xp_cmdshell`,
`OPENROWSET` ...). Only admins may read system catalogs (`information_schema`, `pg_catalog`, `sys`
...). Rows are capped per database without rewriting your SQL, so `ORDER BY` and `WITH` keep working.

`/schema` normalises column types to `string`, `number`, `boolean`, `date`, `datetime`, `time`,
`json`, `binary` or `unknown` (the original type is in `db_type`) and lists the foreign keys between
visible tables as `relationships`. Admins can see it as **Admin -> Data model**.

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
  protection is a database user that only has `SELECT`. **SQL Server has no read-only session
  switch**: there, SQL mode relies on the SQL guard and on the login's permissions, so give Ncode a
  login with `db_datareader` only. A MySQL account must not have the `FILE` privilege.
- Queries (questions and SQL mode) stop after `NCODE_STATEMENT_TIMEOUT_SEC`; users can cancel
  them; each user may run `NCODE_MAX_CONCURRENT_QUERIES` at once; every run is in the audit log
  (action `query` or `sql`, with the SQL).
- Searching with `LIKE '%text%'` scans whole tables. On very large databases use
  `include_tables` / `exclude_tables` and the per-query timeout
  (`NCODE_STATEMENT_TIMEOUT_SEC`).

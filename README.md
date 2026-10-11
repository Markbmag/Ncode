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
- **Combine databases and files** - join results from several databases and uploaded CSV / Excel /
  Parquet files on a key (e.g. VIN), with a report of the keys that found no match.
- **Analyse** - profile any table or result column by column, get an automatic X-ray dashboard,
  compare with last month / last year, running totals, shares, ranks, outliers, trend lines.
- **Data model** - friendly column names and formats, dates stored as text read as real dates,
  relationships for databases without foreign keys, and named metrics everyone shares.
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
**Back the file up before upgrading Ncode** (and `backend/data/datasets/`, the uploaded files).
To migrate by hand: `cd backend && alembic upgrade head`. After pulling a new version, run
`pip install -r requirements.txt` (backend) and `npm install` (frontend) again: new milestones can add packages.

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

**New question** in the sidebar is a step-by-step builder for the database selected in the sidebar:

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
An unsaved question is kept while the browser tab is open; **Save** puts it in the library.

## Library: saving and sharing

**Save** (builder or SQL editor) stores the question, its chart and its parameters in a
**collection**. **Library** in the sidebar lists them:

- *Start*: your favourites (the star) and recently changed questions; the search box finds
  questions by name or description.
- *My collection* is private: only you (and admins) see it. Create other collections (and
  collections inside them) with **+**; a new top-level collection is yours.
- **Share** (on a collection you own) gives people *Can view* or *Can edit*, by name or to
  *Everyone*. Access covers the collections inside it too. Editors can save, move and archive
  questions; only the owner and admins can share, move or archive the collection itself. Running a
  question still needs access to its database (`python -m app.manage allow ...`).
- An opened question shows *edited* when it differs from what is saved: **Save** updates it,
  the **⋯** menu has *Save as new question*, *Discard changes*, *Rename*, *Duplicate*, *Move* and
  *Archive*. People with view access can only *Save as new* (into a collection of theirs).
- **Archive** keeps archived questions and collections; restore them or delete them for good.

**Parameters** let one question answer many variants. In SQL, every `{{name}}` becomes an input
(the ⚙ next to it sets label, type text/number/date, default and *required*). In the builder,
the sliders button on a filter (*Ask for the value*) turns it into a parameter: its value is asked for above the result, and
without a value the filter is left out. The values are part of the link (`?p.region=EU`), so a
link opens the question with the same values. Dashboard filters (M5) will set them.

### Importing from DataDesk

    cd backend
    python -m app.manage import-datadesk path/to/app-data.sqlite --map db1=mes,db2=crm --dry-run
    python -m app.manage import-datadesk path/to/app-data.sqlite --map db1=mes,db2=crm --report import.md

`--map` says which Ncode connection each DataDesk database is. The dry run only prints the report;
without it, everything goes into a collection **DataDesk import** owned by `--owner` (default: the
first admin). Each DataDesk dashboard becomes a dashboard, in a sub-collection of the same name that
also holds its reports (cards two per row). Single-table reports become builder questions,
SQL reports SQL questions (only if they pass the read-only check), multi-database reports wait for
multi-source questions (each source joined to the first on its key column with a FULL JOIN, as
DataDesk merged them - but Ncode keeps every row, where DataDesk kept only the last row per key).
The report lists every report and why something was not converted. DataDesk's file is only read;
running the import again skips what was imported before, creates the dashboards of an import made
before dashboards existed and converts multi-database reports that an earlier import kept as
placeholders ("upgraded").

## SQL editor

**SQL editor** in the sidebar: the database's tables and columns on the left (click to insert a
name, *SELECT* to insert a query), the editor, and the result below.

- Ctrl/Cmd+Enter runs the query, or only the selected part. *Stop* cancels it in the database.
- Autocomplete knows your tables and columns; *Format* tidies the SQL; *History* keeps your last
  queries (in this browser only).
- `{{name}}` in the SQL becomes an input field; values are sent as parameters, never pasted into
  the SQL. Its ⚙ sets the type (text, number, date), a default and a label.
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

## Combining sources and uploads

**Combine** in the sidebar builds a *multi-source question*:

1. **Sources** (up to 6): a saved question, a table, SQL on any of your databases, or an uploaded
   file. Each source is read on its own database (at most `NCODE_FEDERATION_SOURCE_ROWS` rows,
   100,000 by default) and gets a short name used by the joins and in SQL (`mes_builds`).
2. **Join**: every further source is joined to the ones above it - *keep all rows on the left*
   (LEFT JOIN), *only rows with a match* (INNER), *keep all rows on both sides* (FULL) or on the
   right - on up to four key columns. Ncode suggests a key when both sides have a column with the
   same name. Keys are compared *automatically* (numbers as numbers, text trimmed), *as text*,
   *as text ignoring case*, *as numbers* or *exactly as stored*. **Write SQL instead** combines the
   sources with your own SELECT over their names (DuckDB SQL; read-only, no files, no settings).
3. Then filter, summarise, sort and chart the combined rows exactly like a question - and save it.

**Match report** (next to the result) shows, per join, how many keys on each side found no
partner ("37.5 % of MES builds keys have no match in LES shipments (15 of 40)"), examples of such
keys, keys that repeat (each repeat multiplies rows - the totals grow) and empty keys. A source that
returned more rows than allowed is flagged, because the combination then only sees the first rows.

Saved multi-source questions behave like the others: they live in collections, go on dashboards
(dashboard filters can target a column of the combined rows or a parameter) and take parameters:
filters set to *ask for the value*, `{{name}}` in SQL, and the parameters of saved questions used as
sources (a value is passed on to every source question with a parameter of that name). Viewing one
never grants more than you already have: every source still needs your access to its database,
question or file.

**Uploads** (sidebar) takes CSV / TSV (separator and encoding detected, or chosen), Excel `.xlsx`
(first sheet or a named one) and Parquet, up to `NCODE_DATASET_MAX_MB` (100 MB) and
`NCODE_DATASET_MAX_ROWS` (1,000,000 rows). Column types are recognised (numbers, dates such as
`01.09.2026`, date-times, text); a column that mixes numbers and text stays text. Ncode keeps its own
compact copy in `backend/data/datasets/` (back it up with `ncode.sqlite`), not the original file.
Uploaded files live in collections, like questions. `NCODE_UPLOADS_ENABLED=false` turns uploads off.

Everything is combined in an in-process **DuckDB** (installed by `requirements.txt`), with memory
and thread limits (`NCODE_FEDERATION_MEMORY_MB`, `NCODE_FEDERATION_THREADS`) and, before anything you
wrote runs, no access to files, the network, extensions or its own settings.

## Analysing: profiles, X-ray, calculations

- **Profile** (Browse → a table → *Profile*, or *Profile* above any result): per column the empty
  values, distinct values, min / median / mean / max, a histogram, the most common values, outliers
  (beyond 1.5 × the interquartile range), and for text that looks like dates a hint to read it as
  dates. Numbers get a correlation table ("how they move together"). A table profile reads at most
  `NCODE_PROFILE_SAMPLE_ROWS` rows (20,000) plus one row count - the cost guard; a result profile
  uses the rows on screen and runs no query.
- **X-ray** (Browse → *X-ray*, Admin → Data model, or a saved question's **⋯** → *X-ray*): a first
  dashboard made from the profile - number of rows, sums of the main numbers, rows and sums over
  time, rows per category, distributions. For a question it keeps the question's joins and filters.
  *Save as dashboard* turns every card into a saved question in your collection.
- **Calculate** (a step in the builder and in Combine, *Calculations* in the SQL editor): on the rows
  returned - *compare with previous* (the same series one day / week / month / quarter / year earlier,
  matched by date, so a missing month is not mistaken for the previous one), *% change*, *running
  total*, *moving average*, *% of total* and *rank* (overall or within a group), *flag outliers*. A
  series is one value of the other columns (one region), so a running total restarts per region.
- Charts (line, bar, area) have a **trend line** and an optional **forecast** that continues it a
  few periods (a straight line, not a prediction model).

## Data model (admins)

**Admin → Data model**, per database:

- Click a column to give it a **display name** and a **description** (shown in the builder, in result
  headers and tooltips), say **what it is** (money, percentage, category, id ...), set a **format**
  (money in EUR, percent, decimals - used by tables and charts unless a chart sets its own; sums,
  averages, minima and maxima of the column keep it), **hide** it (not offered in the builder and not
  in "all columns"; still usable by name - not a permission) or **read it as dates**: text such as
  `2026-01-31`, `31.01.2026 08:15` or unix time (seconds or milliseconds) becomes a real date-time
  in the database's own SQL, so filters and "by month" work; other values become empty. On
  PostgreSQL an impossible date like `31.02.2026` stops the query; elsewhere it becomes empty
  (SQLite moves it to 3 March).
- **Relationships added by hand** for databases without foreign keys: the builder then joins and
  suggests joins as if they were foreign keys. The database is not changed.
- **Metrics**: a named calculation on a table - e.g. *Paid revenue* = sum of total where status is
  paid - picked in Summarise (*★ Saved metric*). Changing a metric changes every question that uses
  it; archiving hides it from the picker while saved questions keep working.
- A saved question's **⋯ → Use as a model** makes it a starting point like a table: *New question* →
  *… or start from a model*, and Combine.

Everyone who may use a database sees its data model; only admins change it.

## Dashboards

**Dashboards** in the sidebar → **New dashboard** (name and collection) opens it in edit mode:

- **Question** adds a saved question as a card, **Text** a note (Markdown: `# heading`, `**bold**`,
  `*italic*`, lists, links), **Heading** a section title. Drag a card by its title bar, resize it
  from the bottom-right corner; the ✎ on a card changes its title, the table/chart button how it is
  shown on this dashboard (the question itself is not changed).
- **Tab** splits the dashboard into tabs (double-click a tab to rename it).
- **Filters** adds dashboard filters - date range, single date, list of values, text, number - with
  a default and *required*. For each card choose what the filter changes: a **parameter** of the
  question (`{{name}}` in SQL, a filter set to *ask for the value* in the builder; a parameter with
  the same name is connected automatically) or, for questions built without SQL, a **column**
  directly. A date range on a single-date parameter passes its start date ("since").
- **Save** keeps the layout, **Cancel** throws the changes away.

Viewing: change a filter and only the cards it is connected to run again (the badge on a card says
how many filters apply to it). Filter values and the tab are part of the link, so a link opens the
same view. ↻ refreshes every card (bypassing the cache); auto-refresh every 30 s ... 15 min (saved
with the dashboard as its default). **TV mode** shows the dashboard alone, full screen. The **⋯** of
a card opens its question in the editor (with the filter values as parameters) and downloads the
card as CSV, Excel or PNG; the dashboard's **⋯** has *Print / save as PDF*, *Duplicate*, *Rename*,
*Move* and *Archive*. Cards load a few at a time (as many as `NCODE_MAX_CONCURRENT_QUERIES` allows).

Dashboards live in collections and follow their sharing. A dashboard never shows more than the
viewer may see: a card whose question is not shared with them says so, and running a card still
needs access to its database. Editors can rearrange cards they cannot see but not add such questions.

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

### Library

    GET    /api/collections                       visible collections (flat tree) + your own collection's id
    POST   /api/collections                       {"name", "description", "parent_id"}
    GET    /api/collections/{id}                  the collection, its path, sub-collections and questions
    PATCH  /api/collections/{id}                  rename / move ("parent_id") / archive ("archived": true)
    DELETE /api/collections/{id}                  an archived collection with everything in it
    GET    /api/collections/{id}/permissions      own and inherited grants (owner and admins)
    PUT    /api/collections/{id}/permissions      {"grants": [{"user": "bob", "level": "view"}, {"role": "all", "level": "edit"}]}
    GET    /api/questions?q=&favorites=&collection=
    POST   /api/questions                         {"name", "collection_id", "kind": "builder"|"sql"|"federated", "spec", "viz", "parameters"}
    GET    /api/questions/{id}   PATCH /api/questions/{id}   DELETE /api/questions/{id} (archived only)
    POST   /api/questions/{id}/duplicate
    POST   /api/questions/{id}/run                {"params": {"region": "EU"}} -> a query task, as above
    PUT    /api/questions/{id}/favorite           (DELETE to remove the star)
    GET    /api/library/archive                   GET /api/library/people

A builder question's `spec` is the question JSON above; a filter rule with `"param": "region"` takes
its value from the parameter. A SQL question's `spec` is `{"sql": "...", "limit": 2000}`. Parameters
are `[{"name", "label", "type": "text"|"number"|"date", "default", "required"}]`. Questions are
checked when saved (unknown columns, SQL that is not read-only are refused).

### Multi-source questions and uploads

    POST   /api/federated/run                     {"spec", "parameters", "params", "wait_ms", "refresh"} -> a query task
    POST   /api/federated/check                   {"spec", "parameters"} -> the clean spec and the parameters it uses
    GET    /api/datasets?q=&collection=           uploaded files you can see
    POST   /api/datasets?filename=plan.csv&name=&collection_id=&delimiter=auto|comma|semicolon|tab|pipe&header=true&encoding=utf-8|latin-1|utf-16&sheet=
                                                  body: the file itself (Content-Type: application/octet-stream)
    GET    /api/datasets/{id}   PATCH (name, description, collection_id, archived)   DELETE (archived only)

A multi-source `spec`:

    {"version": 1,
     "sources": [{"alias": "mes", "type": "question", "question_id": 12},
                 {"alias": "les", "type": "sql", "connection": "les", "sql": "SELECT vin, shipped_at FROM shipments"},
                 {"alias": "plan", "type": "dataset", "dataset_id": 3}],
     "joins": [{"source": "les", "type": "left", "on": [{"left": "mes.vin", "right": "les.vin", "match": "text_ci"}]},
               {"source": "plan", "type": "left", "on": [{"left": "mes.vin", "right": "plan.VIN"}]}],
     "post": {"breakouts": [{"ref": "plant"}], "aggregations": [{"fn": "count"}]},
     "limit": 2000}

Source types: `question`, `builder` (`"spec"`: a question JSON), `sql` and `dataset`. Instead of
`joins`, `"mode": "sql", "sql": "SELECT ... FROM mes JOIN les ..."`. `post` is a question without
its own table (the combined rows are the table `result`; columns whose names clash get the source
name in front, `mes_vin`). The result envelope adds `federation`: rows read per source, per-join
statistics (`left_unmatched_keys`, `right_repeated_keys`, samples ...) and the combined columns.

### Data model, analysis

    GET    /api/semantic/{conn}/fields            PUT /api/semantic/{conn}/fields/{table}/{column}   (admins)
           {"display_name", "description", "semantic_type", "format", "hidden", "parse_as_date"}
    GET    /api/semantic/{conn}/relationships     POST (admins) {"from_table", "from_columns", "to_table", "to_columns"}   DELETE .../{id}
    GET    /api/metrics?connection=               POST /api/metrics   PUT /api/metrics/{id}   PATCH {"archived": true}   (admins)
    POST   /api/profile/table                     {"connection", "table"} -> a query task; result.analysis.profile
    POST   /api/query/tasks/{id}/profile          the profile of a finished result
    POST   /api/xray                              {"connection", "table"} | {"question_id"} -> a query task; result.analysis.cards

In a question, `{"fn": "metric", "metric": 3}` uses a saved metric and `"where": {...}` on any
aggregation counts only matching rows (`{"fn": "sum", "ref": "orders.total", "where": {"rules": [...]}}`).
`"transforms": [{"type": "previous_period", "column": "revenue", "period": "year"}]` works on builder,
SQL (`/api/query/sql` and saved SQL questions) and multi-source questions; types are `running_total`,
`moving_average` (`window`), `pct_change`, `previous_period` (`period`), `rank` and `pct_of_total` (`by` =
group), `outliers` (`method`: `iqr` or `zscore`). Result columns can carry `display_name`, `description`,
`semantic_type`, `format` (from the data model) and `generated` (added by a calculation).

### Dashboards

    GET    /api/dashboards?q=&favorites=&collection=
    POST   /api/dashboards                        {"name", "description", "collection_id"}
    GET    /api/dashboards/{id}                   filters, tabs, cards (each with the question as far as you may see it)
    PUT    /api/dashboards/{id}                   {"filters", "tabs", "cards", "settings"}: the whole definition
    PATCH  /api/dashboards/{id}                   rename / move / archive;  DELETE (archived only)
    POST   /api/dashboards/{id}/duplicate         PUT|DELETE /api/dashboards/{id}/favorite
    POST   /api/dashboards/{id}/cards/{key}/run   {"filters": {"period": ["2026-01-01", "2026-03-31"]}} -> a query task

A card is `{"key", "kind": "question"|"text"|"heading", "question_id", "tab", "layout": {"x", "y",
"w", "h"} (12 columns), "viz", "title", "text", "mappings": {"<filter id>": {"param": "since"} |
{"field": "orders.created_at"}}}`; a filter is `{"id", "label", "type":
"date_range"|"date"|"text"|"category"|"number", "default", "required"}`.

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
    import-datadesk app-data.sqlite --map db1=mes --dry-run   # see "Importing from DataDesk"

- Passwords are stored as scrypt hashes; sessions last `NCODE_SESSION_TTL_HOURS` (12 by default).
- 5 wrong passwords lock that user+IP for 5 minutes.
- Each user can run at most 3 searches at once (protects your production databases).
- Users only see their own searches; admins see all.
- **The audit log records every search phrase.** Tell your team.
- Users, sessions, the audit log and the library (saved questions, collections, sharing) live in
  `backend/data/ncode.sqlite`, uploaded files in `backend/data/datasets/` (git-ignored; back both up).
- Deleting a user keeps their questions; their own collection becomes an admin-only collection.

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
  (action `query`, `sql` or `federated`, with the SQL or the sources).
- Multi-source questions run in DuckDB inside the backend process: before any SQL a user wrote
  runs, file and network access, extensions and setting changes are switched off for that
  session, and the SQL is checked by the same guard (plus DuckDB's file functions). Each source is
  read through the normal, read-only connection with your permissions. Uploaded files are stored
  as Parquet copies under `backend/data/datasets/`; whoever can see a file's collection can read all
  of its rows.
- Searching with `LIKE '%text%'` scans whole tables. On very large databases use
  `include_tables` / `exclude_tables` and the per-query timeout
  (`NCODE_STATEMENT_TIMEOUT_SEC`).

# Installing and running Ncode

Two ways: **Docker** (recommended for a server: HTTPS, restarts, one command) or **directly**
with Python and Node (development, or a Windows PC). Either way, back up `backend/data/`.

## With Docker (recommended for a server)

Needs Docker with Compose v2 (Docker Desktop on Windows/macOS, or Docker Engine on Linux).

1. Copy `backend/.env.example` to `backend/.env` and set your database connections (or add them
   later in the app). Set `NCODE_SECRET_KEY` (`python -m app.manage generate-key`, or leave it empty
   and a key file is created in the data volume - then back that volume up).
2. Next to `docker-compose.yml`, create a `.env` file with the address people will use:

       NCODE_SITE=ncode.company.local       # or a public name like ncode.example.com
       NCODE_TLS=internal                   # internal certificate; for a public name: your email (Let's Encrypt)
       # NCODE_EMBED_ORIGINS=https://portal.example.com   # only if other websites embed dashboards

3. Start it and create the first admin:

       docker compose up -d --build
       docker compose exec backend python -m app.manage create-user yourname --admin

4. Open `https://ncode.company.local` (the name must point to the server, e.g. a DNS entry or
   the `hosts` file).

What runs: **backend** (the API, not reachable from outside) and **web** (Caddy: serves the app,
forwards `/api` to the backend, does HTTPS and security headers, redirects http to https).
Ncode's data lives in the volume `ncode-data` (`/app/data` in the container): the app database,
uploads, backups and the key file.

**HTTPS on a LAN** (`NCODE_TLS=internal`): Caddy makes its own certificate authority. Browsers warn
until they trust its root certificate once:

    docker compose cp web:/data/caddy/pki/authorities/local/root.crt caddy-root.crt

then install `caddy-root.crt` as a trusted root (Windows: double-click → Install → *Local Machine* →
*Trusted Root Certification Authorities*; or roll it out by group policy). With a public name and
ports 80/443 open, `NCODE_TLS=you@example.com` gets a Let's Encrypt certificate instead.

**SQLite files** you want to connect to must be mounted into the backend container (see the
comment in `docker-compose.yml`) and added with their path inside the container.

**Updating:** see [Upgrading](#upgrading) (back up, `git pull`, `docker compose build`, check, start).

**Backups in Docker:** Admin → System → *Back up now* (and the automatic nightly backup) writes to
the volume; *Download* to keep a copy elsewhere. Restore:

    docker compose stop backend
    docker compose run --no-deps backend python -m app.manage restore /app/data/backups/<file>.zip --yes
    docker compose start backend

(`docker compose cp` copies a downloaded backup into the volume first if needed:
`docker compose cp ncode-backup-....zip backend:/app/data/backups/`.)

**Logs:** `docker compose logs -f backend`.

## Without Docker (development, or a small server)

#### Backend (Python 3.10+)

    cd backend
    python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
    pip install -r requirements.txt
    cp .env.example .env                                    # then edit .env
    uvicorn app.main:app --reload --port 8000

#### First user (required - the app has a login)

    cd backend
    python -m app.manage create-user yourname --admin      # asks for a password

#### Frontend (Node 22+)

    cd frontend
    npm install
    npm run dev

Open http://localhost:5173.

The app has one page per section (`/search`, `/browse`, `/admin` ...), so links and the browser's
back button work. When you serve the built frontend (`npm run build` -> `dist/`) from your own web
server, send unknown paths to `index.html` (for nginx: `try_files $uri /index.html;`).

#### Ncode's own database and upgrades

Users, sessions, UI-added connections and the audit log live in `backend/data/ncode.sqlite`.
Its tables are created and upgraded automatically (Alembic migrations in
`backend/app/migrations`) every time the backend starts; an existing file keeps its data.
**Back the file up before upgrading Ncode** (and `backend/data/datasets/`, the uploaded files) -
the steps are in [Upgrading](#upgrading). To migrate by hand: `cd backend && alembic upgrade head`.

#### Tests

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

## Backups

A backup is one zip with Ncode's own database (users, groups, library, dashboards, settings,
subscriptions) and the uploaded files - not the databases you connect to, and **not the
encryption key**: keep `backend/data/secret.key` (or `NCODE_SECRET_KEY`) somewhere safe, apart from
the backups. Without it, saved database passwords, the email password and webhook addresses cannot
be read after a restore.

- **Automatic:** every night at `NCODE_BACKUP_HOUR` (default 2 = 02:00 server time, `-1` = off);
  the newest `NCODE_BACKUP_KEEP` (default 7) are kept, in `backend/data/backups/`.
- **By hand:** Admin → System → *Back up now*, or `python -m app.manage backup [--to FOLDER]`.
- **Restore** (stop the server first): `python -m app.manage restore ncode-backup-....zip`. The
  current database and uploads are kept as `*.before-restore-<time>`; the restored database is
  brought up to date when the server starts.

## Upgrading

Every upgrade is the same five steps: **back up, get the new version, install, check, start**. The
app database is upgraded (migrated) automatically when the new version starts; an upgraded database
cannot be opened by the older version again, which is why the backup comes first.

### Windows (or Linux) without Docker

In PowerShell (on Linux: `source .venv/bin/activate` instead of the `Activate.ps1` line):

    # 1. stop the server (close its window, or stop the Windows service / scheduled task), then back up
    cd C:\Ncode\backend
    .venv\Scripts\Activate.ps1
    python -m app.manage backup                  # -> backend\data\backups\ncode-backup-<time>.zip
    # also keep a copy of backend\data\secret.key (or NCODE_SECRET_KEY) - it is not in the backup

    # 2. get the new version
    cd C:\Ncode
    git pull                                     # or unpack the new release over the old folder

    # 3. install what the new version needs
    cd backend
    pip install -r requirements.txt
    cd ..\frontend
    npm install
    npm run build                                # the built app in frontend\dist

    # 4. check
    cd ..\backend
    python -m app.manage check

    # 5. start the server as before (e.g. uvicorn app.main:app --host 0.0.0.0 --port 8000)

### Docker

    docker compose exec backend python -m app.manage backup      # 1. back up (while it still runs)
    git pull                                                     # 2. the new version
    docker compose build                                         # 3. new images (pip and npm run inside)
    docker compose run --rm --no-deps backend python -m app.manage check   # 4. check with the new image
    docker compose up -d                                         # 5. start; the database is migrated on start

Download the backup (Admin → System) or copy it out of the volume
(`docker compose cp backend:/app/data/backups/<file>.zip .`) if you want it outside the server.

### What `python -m app.manage check` looks at

It only reads (the app database is not migrated by it) and prints one line per check:
**✓** fine, **!** worth a look, **✗** must be fixed. The exit code is 1 when there is a ✗ line,
so scripts can stop there.

- Python version and the key packages (against `requirements.txt`);
- the settings parse, and `NCODE_*` variables Ncode does not know (usually typos, they are ignored);
- the app database opens and its migration revision: up to date, older (**!** - it is upgraded on
  start), or newer than this version (**✗** - the code was rolled back but not the database);
- the secret key is there and decrypts the saved database passwords, email password and webhooks;
- every database connection answers (or the reason it doesn't, e.g. wrong password, VPN off);
- the backups folder is writable, and how old the last backup is;
- free disk space.

### Rolling back

If the new version does not work for you, go back to the old code **and** the backup made in step 1:

1. stop the server;
2. go back to the old version: `git checkout <the previous tag, e.g. v1.0>` (or unpack the old
   release), then `pip install -r requirements.txt` and `npm install && npm run build` as above
   (Docker: `docker compose build`);
3. restore the backup: `python -m app.manage restore backend\data\backups\ncode-backup-<time>.zip`
   (Docker: `docker compose run --rm --no-deps backend python -m app.manage restore /app/data/backups/<file>.zip --yes`);
   the database and uploads in use are kept as `*.before-restore-<time>`;
4. keep the same secret key; run `python -m app.manage check`, then start the server.

Changes made in the new version after the backup (new questions, users ...) are lost by a roll back.

## Health and monitoring

- `GET /api/health` - the process is alive (for restarts).
- `GET /api/health/ready` - the app database answers; also reports the scheduler, free disk space
  and the last backup. 503 when not ready. Docker uses it as the backend's health check.
- `GET /metrics` - Prometheus format: requests by route and status with durations, queries by kind
  and outcome with durations, queries running, active users and sessions, app database size,
  uptime, age of the last backup. Readable by admins or with `Authorization: Bearer $NCODE_METRICS_TOKEN`.
  In Docker it is not exposed by Caddy; scrape `backend:8000/metrics` from the Docker network.
- Admin → System shows the same health checks; Admin → Usage the usage and slow queries.

## Settings (`backend/.env`)

All settings, with defaults and explanations, are in `backend/.env.example`.

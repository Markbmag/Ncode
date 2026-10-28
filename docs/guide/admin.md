# Administration

Admins manage everything from **Admin** in the app; a few things also from the command line
(`python -m app.manage ...` in the `backend` folder, or `docker compose exec backend python -m app.manage ...`).

## People (Admin → People)

**Users:** add a user (name, first password, role, email, databases, groups), edit, set a new
password (signs them out everywhere), switch sign-in off, delete. The last active admin cannot be
demoted, disabled or deleted. The list shows each user's groups, the databases they may use and
their last sign-in. Everyone can change their own password and email address with the account
button next to their name (bottom left).

**Groups** give many people the same access:

- **Databases:** a member may use the databases of their own setting *plus* those of their groups.
  To manage access only through groups, set the user's own databases to *Only these* with nothing ticked.
- **Collections:** Library → a collection → *Share* → *Group: ...* with *Can view* or *Can edit*.
- **Row-level security:** see below.

**Row-level security** limits which rows the members of a group see: e.g. group *Sales EU*, table
`orders`, column `region` is one of `EU, CH`. It applies wherever rows are read - questions built
without SQL, dashboards, subscriptions (run with the owner's rows), public links, multi-source
questions, profiles and X-rays, Browse and its CSV export. For the members, **SQL is off on that
database** (SQL cannot be filtered reliably), and **Search skips the table**. Several rules of one
group must all match; when a user is in several restricted groups, they see the rows of any of
them. `{username}` or `{email}` as a value means the person looking (e.g. `sales_rep` = `{username}`).
Admins always see everything. Values are compared exactly (`EU` is not `eu`). If a rule's column
disappears from the table, members get an error instead of all rows.

## From the command line

In the `backend` folder, `python -m app.manage`:

    create-user alice                       # regular user, all databases
    create-user bob --admin                 # admin: all databases, sees everyone's searches
    create-user carol --connections mes,les # may only use these connections
    allow alice mes                         # change a user's connections later ("*" = all)
    set-password alice                      # also logs alice out everywhere
    set-email alice alice@company.com       # where subscriptions go (users can also set it themselves)
    disable alice / enable alice
    delete-user alice
    list-users
    audit --limit 50                        # who searched what, when, how long
    backup / restore FILE.zip               # see install.md
    check                                   # ready to start? run after every upgrade (install.md#upgrading)
    import-datadesk app-data.sqlite --map db1=mes --dry-run   # see using.md, "Importing from DataDesk"

- Passwords are stored as scrypt hashes; sessions last `NCODE_SESSION_TTL_HOURS` (12 by default).
- 5 wrong passwords lock that user+IP for 5 minutes.
- Each user can run at most 3 searches at once (protects your production databases).
- Users only see their own searches; admins see all.
- **The audit log records every search phrase.** Tell your team.
- Users, sessions, the audit log and the library (saved questions, collections, sharing) live in
  `backend/data/ncode.sqlite`, uploaded files in `backend/data/datasets/` (git-ignored; back both up).
- Deleting a user keeps their questions; their own collection becomes an admin-only collection.

## Audit log (Admin → Audit)

Every sign-in (and failed attempt), search, query, export, change of settings, users, groups,
rules and sharing - with who, when, what (the search phrase or the first part of the SQL), the
outcome, rows and duration. Filter by person, action, text and dates; *CSV* downloads the filtered
entries (up to 50,000). Admin → Usage summarises the same log (queries per day, most used
questions and dashboards, slow and failed queries).

## Delivery and sharing

- **Admin → Delivery:** the site address, the email server and the Slack / Teams / Telegram /
  webhook destinations used by subscriptions and alerts ([using.md](using.md#subscriptions-alerts-and-sharing)).
- **Admin → Sharing:** public links and embedding, both off until switched on.

## System (Admin → System)

Backups (make, download, delete) and the server's health; see [install.md](install.md#backups).

## Broken content (Admin → Broken content)

Databases change: a table is renamed, a column dropped, a connection removed. Saved content that
still points at the old names would fail when someone opens it; this page lists it in one place,
grouped into questions, dashboards, subscriptions and uploaded files, each with a sentence saying
what is missing and an *Open* button:

- **questions** built without SQL (source table, joins, fields, filters, groups, sort, custom
  columns, metrics), **SQL questions** (only tables that certainly do not exist are reported - views,
  other schemas, temporary tables and table functions are left alone) and **multi-source questions**
  (each source: database tables, saved questions, uploaded files);
- **dashboards** with a card whose question was deleted or archived;
- **subscriptions** of a deleted question or dashboard;
- **uploaded files** whose data file is missing on the server, and questions on a removed database.

The report is made the first time the page is opened and kept until *Check again*, which reads every
database's structure again (one at a time per database, in parallel, at most 60 seconds each). A
database that cannot be reached is listed as *Couldn't check* with the reason - its questions are not
reported as broken. When the list is empty: "Everything points at existing tables and columns".
After renaming something in a database, open this page, *Check again*, and fix what it lists (open the
question and pick the new column, or restore the table).

## First steps for newcomers (M11)

- **Factory demo** (Admin → Databases): a practice database that everyone may use, created on the first
  start in `data/demo/factory.sqlite` with English and Russian names for its tables and columns, three
  metrics and examples (a shared collection *Factory demo* with five questions and the *Production
  overview* dashboard). *Hide the demo* removes it for everyone; `NCODE_DEMO=false` never creates it.
  `NCODE_DEMO_LANGUAGE=ru` names the examples in Russian (set it before the first start). The examples
  are ordinary content: change, move or delete them.
- **Start here**: the collection newcomers see first on the home page. The demo's collection is used
  until you choose another: Home → *Start here* → *Change* (admins only), pick a shared collection and
  *Show on the home page*. Put your team's verified dashboards there.
- **Names people recognise** (Admin → Data model): display names and descriptions for tables and
  columns, each with a Russian translation. They appear in pickers, Browse, Search, results, charts
  and the record panel; technical names stay visible as hints.
- **Glossary** (Glossary in the menu): admins add terms with English and Russian text, synonyms and links
  to metrics, columns and questions. Archive a term to hide it; delete only archived terms.
- **Verified** (⋯ menu of a question or dashboard → *Mark as verified*): the badge says "this is the
  official answer"; it goes away when someone changes the question's query (renaming, moving or a new
  chart keep it).

## Languages

Every user picks **English** or **Русский** with the EN / RU button next to their name (or on the
sign-in page); it is remembered in that browser. Messages that come from the server (errors from
a database, validation messages) stay in English.

**Adding or correcting a translation.** The English text is the key: `t('Save')` in the frontend
looks up `'Save'` in `frontend/src/i18n/ru/<area>.ts`. Plurals are `tn(n, '{n} row', '{n} rows')`
with three Russian forms (`'{n} строка|{n} строки|{n} строк'`), and a word with two meanings
gets a context, `tc('noun', 'Archive')` → `'noun::Archive'`. `npm test` fails when a text shown in
the app has no Russian, when two areas translate the same text differently, or when the
placeholders don't match.

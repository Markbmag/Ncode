"""Glossary (roadmap M11): business terms such as OEE, scrap rate or takt, in English and Russian.

    GET    /api/glossary?q=&archived=   terms, alphabetical (everyone signed in; the archive: admins)
    POST   /api/glossary                {"term", "definition", "translations", "synonyms", "related"} (admins)
    PUT    /api/glossary/{id}           the same fields: replaces the term (admins)
    PATCH  /api/glossary/{id}           {"archived": true | false} (admins)
    DELETE /api/glossary/{id}           an archived term (admins)

translations: {"ru": {"term": "Коэффициент брака", "definition": "..."}}; the UI shows the text
in its language and falls back to the base fields. synonyms: other names people look for, in any
language. related: what the term is computed from or shown in:

    {"kind": "metric", "id": 3}
    {"kind": "column", "connection": "mes", "table": "scrap", "column": "rate"}
    {"kind": "question", "id": 5}

Links are checked when they are added (the metric, the column - in the data model or in the
database - or the question must exist) and filtered when read: people see a link only when they
may use its database or open its question. Admins also see broken links (flagged "missing" or
"archived"), so editing a term never drops them silently. Read links carry the name to show.

Search runs here, not in SQL (SQLite's LIKE only folds ASCII): Unicode case-insensitive, ё = е,
every word of the query somewhere in the term, its synonyms, definition or translations; terms
whose name matches come first.
"""

from __future__ import annotations

import json
import time
import unicodedata
from dataclasses import dataclass
from typing import Annotated, Any, Callable, Literal

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import delete, insert, select, update
from sqlalchemy.engine import Engine

from .appdb import AppDB, User
from .content.store import ContentError, ContentStore, NotFound
from .content.tables import glossary_terms_table, questions_table
from .db import ConnectionRegistry
from .dberrors import db_http_error
from .semantic.store import SemanticStore

MAX_TERM = 120
MAX_DEFINITION = 5000


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MetricLink(_Model):
    kind: Literal["metric"]
    id: int = Field(ge=1)


class ColumnLink(_Model):
    kind: Literal["column"]
    connection: str = Field(min_length=1, max_length=64)
    table: str = Field(min_length=1, max_length=255)
    column: str = Field(min_length=1, max_length=255)


class QuestionLink(_Model):
    kind: Literal["question"]
    id: int = Field(ge=1)


RelatedLink = Annotated[MetricLink | ColumnLink | QuestionLink, Field(discriminator="kind")]


class TermText(_Model):
    term: str | None = Field(default=None, max_length=MAX_TERM)
    definition: str | None = Field(default=None, max_length=MAX_DEFINITION)


class TermIn(_Model):
    term: str = Field(min_length=1, max_length=MAX_TERM)
    definition: str = Field(min_length=1, max_length=MAX_DEFINITION)
    translations: dict[str, TermText] = Field(default_factory=dict, max_length=10)
    synonyms: list[str] = Field(default_factory=list, max_length=30)
    related: list[RelatedLink] = Field(default_factory=list, max_length=50)

    @field_validator("translations")
    @classmethod
    def _languages(cls, value: dict[str, TermText]) -> dict[str, TermText]:
        for code in value:
            if not (len(code) == 2 and code.isascii() and code.isalpha() and code.islower()):
                raise ValueError("translations are keyed by a two-letter language code such as 'ru'")
        return value

    @field_validator("synonyms")
    @classmethod
    def _synonyms(cls, value: list[str]) -> list[str]:
        for s in value:
            if len(s.strip()) > MAX_TERM:
                raise ValueError(f"a synonym has at most {MAX_TERM} characters")
        return value


class ArchiveIn(_Model):
    archived: bool


def fold(text: str | None) -> str:
    """For comparing and searching: case-insensitive in every script, ё = е."""
    return unicodedata.normalize("NFKC", text or "").casefold().replace("ё", "е")


def link_key(link: dict[str, Any]) -> tuple[Any, ...]:
    if link.get("kind") == "column":
        return ("column", link.get("connection"), link.get("table"), link.get("column"))
    return (link.get("kind"), link.get("id"))


def _loads(raw: str | None, default: Any) -> Any:
    if not raw:
        return default
    try:
        value = json.loads(raw)
    except ValueError:
        return default
    return value if isinstance(value, type(default)) else default


@dataclass
class Term:
    id: int
    term: str
    definition: str
    translations: dict[str, dict[str, str]]
    synonyms: list[str]
    related: list[dict[str, Any]]
    archived: bool
    created_at: float
    updated_at: float
    updated_by: str | None

    def names(self) -> list[str]:
        """Everything the term is called: base, translations, synonyms."""
        out = [self.term, *self.synonyms]
        out += [t.get("term") or "" for t in self.translations.values() if isinstance(t, dict)]
        return [n for n in out if n]

    def texts(self) -> list[str]:
        out = [self.definition]
        out += [t.get("definition") or "" for t in self.translations.values() if isinstance(t, dict)]
        return [x for x in out if x]

    def to_json(self, related: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        return {
            "id": self.id, "term": self.term, "definition": self.definition, "translations": self.translations,
            "synonyms": self.synonyms, "related": self.related if related is None else related,
            "archived": self.archived, "created_at": self.created_at, "updated_at": self.updated_at,
            "updated_by": self.updated_by,
        }


def search(terms: list[Term], q: str | None) -> list[Term]:
    """Terms matching every word of `q` (all of them for an empty query); name matches first,
    then alphabetical."""
    words = fold(q).split()
    phrase = " ".join(words)
    ranked: list[tuple[int, str, Term]] = []
    for term in terms:
        names = [fold(n) for n in term.names()]
        hay = "\n".join(names + [fold(x) for x in term.texts()])
        if not all(w in hay for w in words):
            continue
        if not words:
            rank = 0
        elif any(n == phrase for n in names):
            rank = 0
        elif any(phrase in n for n in names):
            rank = 1
        else:
            rank = 2 if all(any(w in n for n in names) for w in words) else 3
        ranked.append((rank, fold(term.term), term))
    ranked.sort(key=lambda r: (r[0], r[1], r[2].id))
    return [r[2] for r in ranked]


def _clean(body: TermIn) -> dict[str, Any]:
    """Stored values: trimmed texts, no empty translations, synonyms without duplicates."""
    term = body.term.strip()
    definition = body.definition.strip()
    if not term or not definition:
        raise ContentError("A term needs a name and a definition")
    translations: dict[str, dict[str, str]] = {}
    for code, text in body.translations.items():
        entry = {k: v.strip() for k, v in (("term", text.term), ("definition", text.definition)) if v and v.strip()}
        if entry:
            translations[code] = entry
    synonyms: list[str] = []
    seen = {fold(term)}
    for s in body.synonyms:
        s = s.strip()
        if s and fold(s) not in seen:
            seen.add(fold(s))
            synonyms.append(s)
    related: list[dict[str, Any]] = []
    keys: set[tuple[Any, ...]] = set()
    for link in body.related:
        item = link.model_dump()
        if link_key(item) not in keys:
            keys.add(link_key(item))
            related.append(item)
    return {"term": term, "definition": definition, "translations": translations, "synonyms": synonyms, "related": related}


class GlossaryStore:
    def __init__(self, engine: Engine):
        self.engine = engine

    @staticmethod
    def _to(row: Any) -> Term:
        return Term(
            id=row.id, term=row.term, definition=row.definition, translations=_loads(row.translations, {}),
            synonyms=_loads(row.synonyms, []), related=_loads(row.related, []), archived=bool(row.archived),
            created_at=row.created_at, updated_at=row.updated_at, updated_by=row.updated_by,
        )

    def terms(self, *, archived: bool | None = False) -> list[Term]:
        stmt = select(glossary_terms_table)
        if archived is not None:
            stmt = stmt.where(glossary_terms_table.c.archived.is_(archived))
        with self.engine.connect() as conn:
            out = [self._to(r) for r in conn.execute(stmt).all()]
        return sorted(out, key=lambda t: (fold(t.term), t.id))

    def get(self, tid: int) -> Term:
        with self.engine.connect() as conn:
            row = conn.execute(select(glossary_terms_table).where(glossary_terms_table.c.id == tid)).first()
        if row is None:
            raise NotFound("Glossary term")
        return self._to(row)

    def save(self, user: User, values: dict[str, Any], tid: int | None = None) -> Term:
        name = fold(values["term"])
        for other in self.terms(archived=None):
            if other.id != tid and fold(other.term) == name:
                if other.archived:
                    raise ContentError(f"The archive already has the term {other.term!r}: restore it instead", 409)
                raise ContentError(f"There is already a term {other.term!r}", 409)
        now = time.time()
        row = {
            "term": values["term"], "definition": values["definition"],
            "translations": json.dumps(values["translations"], ensure_ascii=False) if values["translations"] else None,
            "synonyms": json.dumps(values["synonyms"], ensure_ascii=False) if values["synonyms"] else None,
            "related": json.dumps(values["related"], ensure_ascii=False) if values["related"] else None,
            "updated_at": now, "updated_by": user.username,
        }
        with self.engine.begin() as conn:
            if tid is None:
                tid = int(conn.execute(
                    insert(glossary_terms_table).values(archived=False, created_at=now, **row)
                ).inserted_primary_key[0])
            else:
                self.get(tid)
                conn.execute(update(glossary_terms_table).where(glossary_terms_table.c.id == tid).values(**row))
        return self.get(tid)

    def set_archived(self, user: User, tid: int, archived: bool) -> Term:
        current = self.get(tid)
        if not archived and current.archived:  # restoring must not create a second term of the same name
            other = next((o for o in self.terms() if o.id != tid and fold(o.term) == fold(current.term)), None)
            if other is not None:
                raise ContentError(f"There is already a term {other.term!r}", 409)
        with self.engine.begin() as conn:
            conn.execute(update(glossary_terms_table).where(glossary_terms_table.c.id == tid).values(
                archived=archived, updated_at=time.time(), updated_by=user.username,
            ))
        return self.get(tid)

    def delete(self, tid: int) -> Term:
        term = self.get(tid)
        if not term.archived:
            raise ContentError("Archive the term first; only archived terms can be deleted", 409)
        with self.engine.begin() as conn:
            conn.execute(delete(glossary_terms_table).where(glossary_terms_table.c.id == tid))
        return term


# ---------------------------------------------------------------- links: checked on save, filtered on read

class _Resolver:
    """What one reader may see of the links of many terms (one snapshot, one query)."""

    def __init__(self, user: User, terms: list[Term], *, content: ContentStore, semantic: SemanticStore,
                 registry: ConnectionRegistry):
        self.user = user
        self.semantic = semantic
        self.connections = set(registry.configs)
        ids = {link.get("id") for t in terms for link in t.related if link.get("kind") == "question"}
        self.questions: dict[int, dict[str, Any]] = {}
        if ids:
            snap = content.snapshot()
            with content.engine.connect() as conn:
                rows = conn.execute(select(
                    questions_table.c.id, questions_table.c.name, questions_table.c.collection_id,
                    questions_table.c.archived, questions_table.c.verified_by, questions_table.c.verified_at,
                ).where(questions_table.c.id.in_([i for i in ids if isinstance(i, int)]))).all()
            for r in rows:
                if snap.access(user, r.collection_id) is None:
                    continue
                self.questions[r.id] = {
                    "name": r.name,
                    "archived": bool(r.archived) or snap.hidden(r.collection_id),
                    "verified": {"by": r.verified_by, "at": r.verified_at} if r.verified_by else None,
                }

    def _metric(self, link: dict[str, Any]) -> dict[str, Any] | None:
        try:
            m = self.semantic.metric(int(link.get("id") or 0))
        except ContentError:
            return None
        if not self.user.can_use(m.connection):
            return None
        return {"name": m.name, "connection": m.connection, "translations": getattr(m, "translations", None) or None,
                "archived": m.archived}

    def _column(self, link: dict[str, Any]) -> dict[str, Any] | None:
        key = str(link.get("connection"))
        if key not in self.connections or not self.user.can_use(key):
            return None
        meta = self.semantic.fields(key).get(str(link.get("table")), {}).get(str(link.get("column"))) or {}
        return {"display_name": meta.get("display_name"), "translations": meta.get("translations") or None, "archived": False}

    def links(self, term: Term) -> list[dict[str, Any]]:
        out = []
        for link in term.related:
            kind = link.get("kind")
            if kind == "metric":
                info = self._metric(link)
            elif kind == "column":
                info = self._column(link)
            elif kind == "question":
                found = self.questions.get(link.get("id"))  # type: ignore[arg-type]
                info = dict(found) if found else None
            else:
                info = None
            if info is None:
                if self.user.is_admin:  # kept, so that saving the term does not drop it
                    out.append({**link, "missing": True})
                continue
            archived = info.pop("archived")
            if archived and not self.user.is_admin:
                continue
            out.append({**link, **info, **({"archived": True} if archived else {})})
        return out


def register_glossary_routes(
    app: FastAPI,
    *,
    app_db: AppDB,
    content: ContentStore,
    semantic: SemanticStore,
    registry: ConnectionRegistry,
    current_user: Callable[..., User],
    require_admin: Callable[..., User],
) -> GlossaryStore:
    store = GlossaryStore(app_db.engine)
    router = APIRouter(tags=["glossary"])

    def fail(exc: ContentError) -> HTTPException:
        return HTTPException(status_code=exc.status, detail=str(exc))

    def check_links(admin: User, related: list[dict[str, Any]], keep: list[dict[str, Any]]) -> None:
        """New links must point at something that exists; links the term already had stay as they are."""
        known = {link_key(link) for link in keep}
        for link in related:
            if link_key(link) in known:
                continue
            if link["kind"] == "metric":
                try:
                    semantic.metric(link["id"])
                except ContentError:
                    raise HTTPException(status_code=400, detail=f"Metric {link['id']} does not exist") from None
            elif link["kind"] == "question":
                with content.engine.connect() as conn:
                    found = conn.execute(select(questions_table.c.id).where(questions_table.c.id == link["id"])).first()
                if found is None:
                    raise HTTPException(status_code=400, detail=f"Question {link['id']} does not exist")
            else:
                key, table, column = link["connection"], link["table"], link["column"]
                if key not in registry.configs or not admin.can_use(key):
                    raise HTTPException(status_code=400, detail=f"Unknown connection {key!r}")
                if column in semantic.fields(key).get(table, {}):
                    continue  # described in the data model
                try:
                    schema = registry.get_schema(key)
                except Exception as exc:
                    raise db_http_error(exc, registry.get_config(key).engine, "Could not read the database structure") from exc
                if table not in schema:
                    raise HTTPException(status_code=400, detail=f"Unknown table {table!r}")
                if column not in {c["name"] for c in schema[table]}:
                    raise HTTPException(status_code=400, detail=f"{table!r} has no column {column!r}")

    def shown(user: User, terms: list[Term]) -> list[dict[str, Any]]:
        resolver = _Resolver(user, terms, content=content, semantic=semantic, registry=registry)
        return [t.to_json(resolver.links(t)) for t in terms]

    @router.get("/api/glossary")
    def list_terms(q: str | None = Query(None, max_length=200), archived: bool = False, user: User = Depends(current_user)):
        if archived and not user.is_admin:
            raise HTTPException(status_code=403, detail="Only an administrator can do this")
        return {"terms": shown(user, search(store.terms(archived=archived), q))}

    @router.post("/api/glossary")
    def create_term(body: TermIn, admin: User = Depends(require_admin)):
        try:
            values = _clean(body)
            check_links(admin, values["related"], [])
            term = store.save(admin, values)
        except ContentError as exc:
            raise fail(exc) from exc
        app_db.audit(admin.username, "glossary_add", phrase=term.term, status="ok")
        return shown(admin, [term])[0]

    @router.put("/api/glossary/{tid}")
    def update_term(tid: int, body: TermIn, admin: User = Depends(require_admin)):
        try:
            current = store.get(tid)
            values = _clean(body)
            check_links(admin, values["related"], current.related)
            term = store.save(admin, values, tid)
        except ContentError as exc:
            raise fail(exc) from exc
        app_db.audit(admin.username, "glossary_edit", phrase=term.term, status="ok")
        return shown(admin, [term])[0]

    @router.patch("/api/glossary/{tid}")
    def archive_term(tid: int, body: ArchiveIn, admin: User = Depends(require_admin)):
        try:
            term = store.set_archived(admin, tid, body.archived)
        except ContentError as exc:
            raise fail(exc) from exc
        app_db.audit(admin.username, "glossary_archive" if body.archived else "glossary_restore", phrase=term.term, status="ok")
        return shown(admin, [term])[0]

    @router.delete("/api/glossary/{tid}")
    def delete_term(tid: int, admin: User = Depends(require_admin)):
        try:
            term = store.delete(tid)
        except ContentError as exc:
            raise fail(exc) from exc
        app_db.audit(admin.username, "glossary_delete", phrase=term.term, status="ok")
        return {"deleted": tid}

    app.include_router(router)
    return store

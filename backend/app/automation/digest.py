"""Digests (M15, "Follow"): the biggest changes of a dashboard, question or metric, in sentences.

A digest is a subscription with options.digest = "day" | "week" (app/automation/store.py), so
the scheduler, delivery settings, send history and the Subscriptions page treat it like any
other. Each run compares the latest complete period with the one before, in the schedule's
time zone: yesterday with the day before, or last week (Monday-Sunday) with the week before.

For each question card the question runs twice, once per period, with the owner's permissions:

* the period goes into the card's date-range dashboard filter when it has one (that works for
  SQL questions with a date parameter too); otherwise - questions built without SQL - into a
  condition on the question's own date column: the column it groups by date, or the one its
  date filter uses (a relative "last 30 days" on that column is left out, it would contradict
  the period);
* the numbers compared are the measure the card shows (its chart's value, else the first
  measure); a card without a number (a list of rows) is left out;
* where the question also groups by a category (line, part, reason), the category that
  contributed most to the change is named. Totals are only added up for counts and sums;
  for averages and ratios (scrap rate) the category that moved most is named instead.

Everything is computed, nothing guessed: the same data gives the same sentences. A change is
"big" from THRESHOLD_PCT on; without any, the digest says so. Sentences and numbers follow the
recipient's language (their stored UI language, else NCODE_EMAIL_LANGUAGE).
"""

from __future__ import annotations

import json
import logging
import math
from dataclasses import dataclass, field, replace
from datetime import date, datetime, timedelta
from types import SimpleNamespace
from typing import TYPE_CHECKING, Any, Callable
from zoneinfo import ZoneInfo

from sqlalchemy import select

from ..appdb import User, users_table
from ..content.dashboards import Card, DashboardFilter, apply_filters, filter_values, param_shapes
from ..content.store import ContentError
from ..results import ResultColumn, ResultEnvelope, ResultStats
from ..schema_graph import normalize_type
from .render import CardOut, Report, format_value, label, local_number
from .store import SubscriptionIn

if TYPE_CHECKING:
    from .engine import Engine, Outcome

logger = logging.getLogger("ncode.automation")

THRESHOLD_PCT = 5.0   # a change smaller than this is "about the same"
MAX_CHANGES = 4       # sentences about changes (plus the opening line and at most one more)
MAX_PICTURES = 3      # charts of the cards that changed most
ADDITIVE = {"count", "sum"}
RELATIVE_OPS = {"last", "current"}
LANGS = ("en", "ru")
GONE = {  # the run's error when the followed thing is gone (Russian in app/i18n_ru.py)
    "dashboard": "The dashboard is gone or not shared with the subscription's owner any more",
    "question": "The question is gone or not shared with the subscription's owner any more",
    "metric": "The metric is gone or not shared with the subscription's owner any more",
}

TEXTS: dict[str, dict[str, str]] = {
    "en": {
        "title_day": "{name}: daily digest",
        "title_week": "{name}: weekly digest",
        "intro_day": "Changes on {date} compared with the day before.",
        "intro_week": "Changes in the week {start} – {end} compared with the week before.",
        "ref_day": "vs. the day before",
        "ref_week": "vs. the week before",
        "rise": "{name} rose {pct} {ref} ({prev} → {cur}){mostly}.",
        "fall": "{name} fell {pct} {ref} ({prev} → {cur}){mostly}.",
        "from_zero": "{name} rose from 0 to {cur} {ref}{mostly}.",
        "mostly": ", mostly {category} ({delta})",
        "biggest": "{name}: the biggest change is {category}, {prev} → {cur} ({pct}).",
        "none": "No big changes: nothing moved more than {threshold} %.",
        "steady": "About the same: {items}.",
        "more": "And {n} smaller changes: see the dashboard.",
        "nothing": "Nothing to compare: Ncode found no date to compare the periods by.",
        "failed": "Cards that could not be read: {n} (see the send history).",
        "footer": "Sent by Ncode because {owner} follows “{name}”. ",
        "footer_site": "Stop it at {site}/subscriptions",
        "footer_local": "Stop it in Ncode under Subscriptions.",
    },
    "ru": {
        "title_day": "{name}: сводка за день",
        "title_week": "{name}: сводка за неделю",
        "intro_day": "Изменения за {date} по сравнению с предыдущим днём.",
        "intro_week": "Изменения за неделю {start} – {end} по сравнению с предыдущей неделей.",
        "ref_day": "к предыдущему дню",
        "ref_week": "к предыдущей неделе",
        "rise": "{name}: рост на {pct} {ref} ({prev} → {cur}){mostly}.",
        "fall": "{name}: снижение на {pct} {ref} ({prev} → {cur}){mostly}.",
        "from_zero": "{name}: рост с 0 до {cur} {ref}{mostly}.",
        "mostly": ", больше всего — {category} ({delta})",
        "biggest": "{name}: самое большое изменение — {category}, {prev} → {cur} ({pct}).",
        "none": "Больших изменений нет: ничего не изменилось больше чем на {threshold} %.",
        "steady": "Почти без изменений: {items}.",
        "more": "И ещё изменений поменьше: {n} — смотрите на дашборде.",
        "nothing": "Сравнивать нечего: Ncode не нашёл дату, по которой можно сравнить периоды.",
        "failed": "Не удалось прочитать карточек: {n} (подробности в истории отправок).",
        "footer": "Ncode отправил это письмо, потому что {owner} следит за «{name}». ",
        "footer_site": "Отключить: {site}/subscriptions",
        "footer_local": "Отключить можно в Ncode в разделе «Подписки».",
    },
}
MONTHS = {
    "en": ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    "ru": ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"],
}


# ---------------------------------------------------------------- periods and words

@dataclass(frozen=True)
class Period:
    start: date
    end: date  # inclusive


def periods(every: str, today: date) -> tuple[Period, Period]:
    """(latest complete period, the one before) for "day" or "week" (weeks start on Monday)."""
    if every == "day":
        y = today - timedelta(days=1)
        return Period(y, y), Period(y - timedelta(days=1), y - timedelta(days=1))
    monday = today - timedelta(days=today.weekday())
    return Period(monday - timedelta(days=7), monday - timedelta(days=1)), Period(monday - timedelta(days=14), monday - timedelta(days=8))


def today_in(timezone: str) -> date:
    return datetime.now(ZoneInfo(timezone)).date()


def day_text(d: date, lang: str, year: bool = True) -> str:
    return f"{d.day} {MONTHS[lang][d.month - 1]}" + (f" {d.year}" if year else "")


def pct_text(pct: float, lang: str, signed: bool = False) -> str:
    value = abs(pct)
    text = f"{value:.1f}" if value < 10 else f"{value:,.0f}"
    sign = ("+" if pct >= 0 else "−") if signed else ""
    return local_number(f"{sign}{text} %", lang)


def recipient_language(engine: "Engine", owner: User) -> str:
    """The owner's UI language (personal setting "language", saved by the Follow button), else the default."""
    if owner.id:
        try:
            with engine.app_db.engine.connect() as conn:
                raw = conn.execute(select(users_table.c.prefs).where(users_table.c.id == owner.id)).scalar()
            prefs = json.loads(raw) if raw else {}
            lang = prefs.get("language") if isinstance(prefs, dict) else None
            if lang in LANGS:
                return str(lang)
        except (ValueError, TypeError):
            pass
    return engine.email_language if engine.email_language in LANGS else "en"


# ---------------------------------------------------------------- one card, two periods

Runner = Callable[[Period], tuple[ResultEnvelope | None, str | None]]


@dataclass
class Item:
    title: str
    url: str | None
    run: Runner | None              # None: nothing to compare by (no date)
    measure: str | None = None      # the column the card shows
    additive: Callable[[str], bool] = lambda _name: False
    fmt: dict[str, Any] | None = None
    error: str | None = None


@dataclass
class Movement:
    item: Item
    column: ResultColumn
    fmt: dict[str, Any] | None
    additive: bool
    previous: float | None
    current: float | None
    categories: dict[str, list[float | None]] = field(default_factory=dict)  # category -> [previous, current]
    category_column: ResultColumn | None = None
    score: float = 0.0
    sentence: str | None = None


def _num(v: Any) -> float | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        return None
    return float(v)


def _measure_index(result: ResultEnvelope, name: str | None) -> int | None:
    if name:
        for i, c in enumerate(result.columns):
            if c.name == name and c.type == "number":
                return i
    for want_measure in (True, False):
        for i, c in enumerate(result.columns):
            if c.type == "number" and (c.role == "measure" or not want_measure):
                return i
    return None


def _category_index(result: ResultEnvelope, measure: int) -> int | None:
    for i, c in enumerate(result.columns):
        if i != measure and c.type not in ("number", "date", "datetime", "time") and c.role == "dimension":
            return i
    return None


def _groups(result: ResultEnvelope, m: int, cat: int | None) -> dict[str, list[float]]:
    out: dict[str, list[float]] = {}
    for row in result.rows:
        key = "" if cat is None else format_value(row[cat], result.columns[cat]) if row[cat] is not None else "(empty)"
        v = _num(row[m])
        if v is not None:
            out.setdefault(key, []).append(v)
    return out


def compare(item: Item, previous: ResultEnvelope, current: ResultEnvelope) -> Movement | None:
    """The numbers of one card in both periods (None: nothing comparable)."""
    if [c.name for c in previous.columns] != [c.name for c in current.columns]:
        return None
    m = _measure_index(current, item.measure)
    if m is None:
        return None
    col = current.columns[m]
    fmt = item.fmt if item.fmt is not None else col.format
    additive = item.additive(col.name) and (fmt or {}).get("style") != "percent"
    cat = _category_index(current, m)
    before, now = _groups(previous, m, cat), _groups(current, m, cat)
    mv = Movement(item=item, column=col, fmt=fmt, additive=additive, previous=None, current=None,
                  category_column=current.columns[cat] if cat is not None else None)
    if additive:
        mv.previous = sum(sum(v) for v in before.values()) if previous.rows else 0.0
        mv.current = sum(sum(v) for v in now.values()) if current.rows else 0.0
        if cat is not None:
            mv.categories = {k: [sum(before.get(k, [0.0])), sum(now.get(k, [0.0]))] for k in {*before, *now}}
        return mv
    # averages, ratios ...: one value per group, or there is nothing to compare
    if any(len(v) > 1 for v in (*before.values(), *now.values())):
        return None
    if cat is None:
        mv.previous = before[""][0] if "" in before else None
        mv.current = now[""][0] if "" in now else None
        return mv if mv.previous is not None and mv.current is not None else None
    mv.categories = {k: [before[k][0] if k in before else None, now[k][0] if k in now else None] for k in {*before, *now}}
    return mv


def describe(mv: Movement, every: str, lang: str) -> Movement:
    """Fills in the score (how big the change is, in %) and the sentence (None: about the same)."""
    words = TEXTS[lang]
    ref = words[f"ref_{every}"]
    name = mv.item.title

    def value(v: float) -> str:
        return local_number(format_value(v, mv.column, mv.fmt), lang)

    if mv.previous is not None and mv.current is not None:
        prev, cur = mv.previous, mv.current
        if prev == cur:
            return mv
        pct = math.inf if prev == 0 else (cur - prev) / abs(prev) * 100
        if abs(pct) < THRESHOLD_PCT:
            mv.score = abs(pct)
            return mv
        mostly = ""
        if mv.additive and len(mv.categories) > 1:
            direction = 1 if cur > prev else -1
            # the category that moved most in the direction of the total; ties: the first name
            gain, category = min((((c - p) * direction, k) for k, (p, c) in mv.categories.items() if p is not None and c is not None),
                                 key=lambda t: (-t[0], t[1]))
            if gain > 0:
                mostly = words["mostly"].format(category=category, delta=("+" if direction > 0 else "−") + value(gain))
        mv.score = abs(pct)
        if prev == 0:
            mv.sentence = words["from_zero"].format(name=name, cur=value(cur), ref=ref, mostly=mostly)
        else:
            mv.sentence = words["rise" if cur > prev else "fall"].format(
                name=name, pct=pct_text(pct, lang), ref=ref, prev=value(prev), cur=value(cur), mostly=mostly)
        return mv
    best: tuple[float, str, float, float] | None = None
    for k, (p, c) in mv.categories.items():
        if p is None or c is None or p == 0 or p == c:
            continue
        pct = (c - p) / abs(p) * 100
        if best is None or abs(pct) > abs(best[0]) or (abs(pct) == abs(best[0]) and k < best[1]):
            best = (pct, k, p, c)
    if best is None:
        return mv
    pct, category, p, c = best
    mv.score = abs(pct)
    if abs(pct) >= THRESHOLD_PCT:
        mv.sentence = words["biggest"].format(name=name, category=category, prev=value(p), cur=value(c), pct=pct_text(pct, lang, signed=True))
    return mv


def sentences(movements: list[Movement], every: str, current: Period, lang: str, *, comparable: int, failed: int) -> list[str]:
    """3-6 short sentences: the period, the biggest changes (or "no big changes"), what stayed the same."""
    words = TEXTS[lang]
    if every == "day":
        out = [words["intro_day"].format(date=day_text(current.start, lang))]
    else:
        out = [words["intro_week"].format(start=day_text(current.start, lang, year=current.start.year != current.end.year),
                                          end=day_text(current.end, lang))]
    changed = sorted((m for m in movements if m.sentence), key=lambda m: (-m.score, m.item.title))
    if not comparable:
        out.append(words["nothing"])
    elif not changed:
        out.append(words["none"].format(threshold=local_number(f"{THRESHOLD_PCT:g}", lang)))
    out += [m.sentence for m in changed[:MAX_CHANGES] if m.sentence]
    if len(changed) > MAX_CHANGES:
        out.append(words["more"].format(n=len(changed) - MAX_CHANGES))
    elif len(changed) < MAX_CHANGES - 1:
        steady = [m for m in movements if not m.sentence and m.current is not None][:3]
        if steady:
            items = ", ".join(f"{m.item.title} ({local_number(format_value(m.current, m.column, m.fmt), lang)})" for m in steady)
            out.append(words["steady"].format(items=items))
    if failed:
        out.append(words["failed"].format(n=failed))
    return out


def picture_card(mv: Movement) -> CardOut | None:
    """A chart for the email: the current period by category (a bar chart), or the number."""
    if mv.category_column is not None and len(mv.categories) > 1:
        rows = sorted(([k, c] for k, (_p, c) in mv.categories.items() if c is not None), key=lambda r: (-(r[1] or 0), r[0]))
        cat = mv.category_column.model_copy(update={"name": "category", "type": "string"})
        columns = [cat, mv.column.model_copy(update={"format": mv.fmt})]
        spec = {"type": "bar", "x": "category", "series": [{"y": mv.column.name}]}
    elif mv.current is not None:
        rows = [[mv.current]] if mv.previous is None else [[mv.previous], [mv.current]]
        columns = [mv.column.model_copy(update={"format": mv.fmt})]
        spec = {"type": "kpi", "value": mv.column.name}
    else:
        return None
    result = ResultEnvelope(columns=columns, rows=rows, stats=ResultStats(duration_ms=0, row_count=len(rows)))
    return CardOut(title=mv.item.title, result=result, viz={"mode": "chart", "spec": spec}, url=mv.item.url)


# ---------------------------------------------------------------- what to run

def _date_ref(spec: dict[str, Any]) -> str | None:
    """The date column of a builder question: the one it groups by date, else the one its date filter uses."""
    for b in spec.get("breakouts") or []:
        if isinstance(b, dict) and b.get("bucket") and b.get("ref"):
            return str(b["ref"])

    def walk(group: Any) -> str | None:
        for rule in (group or {}).get("rules") or []:
            if not isinstance(rule, dict):
                continue
            if "rules" in rule:
                found = walk(rule)
                if found:
                    return found
            elif rule.get("ref") and rule.get("op") in RELATIVE_OPS:
                return str(rule["ref"])
        return None

    return walk(spec.get("filters"))


def _without_relative(group: Any, ref: str) -> Any:
    if not isinstance(group, dict):
        return group
    rules = []
    for rule in group.get("rules") or []:
        if isinstance(rule, dict) and "rules" in rule:
            rules.append(_without_relative(rule, ref))
        elif not (isinstance(rule, dict) and rule.get("ref") == ref and rule.get("op") in RELATIVE_OPS):
            rules.append(rule)
    return {**group, "rules": rules}


def _for_digest(spec: dict[str, Any], ref: str | None) -> dict[str, Any]:
    """The builder spec for one period: no relative dates on the period's column, every group (no limit)."""
    out = dict(spec)
    if ref and out.get("filters"):
        out["filters"] = _without_relative(out["filters"], ref)
    if out.get("aggregations"):
        out.pop("limit", None)
    return out


def _range(ref: str, p: Period) -> list[dict[str, Any]]:
    return [{"ref": ref, "op": ">=", "value": p.start.isoformat()},
            {"ref": ref, "op": "<", "value": (p.end + timedelta(days=1)).isoformat()}]


def _additive_for(engine: "Engine", q: Any) -> Callable[[str], bool]:
    """Whether a measure of a builder question may be added up across groups (counts and sums)."""
    aggs = [a for a in (q.spec.get("aggregations") or []) if isinstance(a, dict)] if q.kind == "builder" else []

    def fn_of(a: dict[str, Any]) -> str | None:
        if a.get("fn") == "metric" and engine.semantic is not None:
            try:
                return str(engine.semantic.metric(int(a.get("metric") or 0)).definition.get("fn"))
            except (ContentError, ValueError, LookupError):
                return None
        return a.get("fn")

    def check(name: str) -> bool:
        match = [a for a in aggs if a.get("alias") == name] or (aggs if len(aggs) == 1 else [])
        return len(match) == 1 and fn_of(match[0]) in ADDITIVE

    return check


def _viz_measure(viz: dict[str, Any] | None) -> tuple[str | None, dict[str, Any] | None]:
    spec = (viz or {}).get("spec") if isinstance(viz, dict) else None
    if not isinstance(spec, dict):
        return None, None
    series = spec.get("series") or []
    name = spec.get("value") if spec.get("type") in ("kpi", "gauge") else None
    name = name or (series[0].get("y") if series and isinstance(series[0], dict) else None) or spec.get("value")
    fmt = (spec.get("format") or {}).get(name) if name else None
    return (str(name) if name else None), (fmt if isinstance(fmt, dict) else None)


def _question_runner(engine: "Engine", owner: User, q: Any, extra: dict[str, Any],
                     prepare: Callable[[Period], tuple[dict[str, Any], list[dict[str, Any]]]], own_ref: str | None) -> Runner:
    content = engine.content

    def run(p: Period) -> tuple[ResultEnvelope | None, str | None]:
        try:
            params, conditions = prepare(p)
        except ContentError as exc:
            return None, str(exc)
        target = q
        if q.kind == "builder":
            target = replace(q, spec=_for_digest(q.spec, own_ref)) if hasattr(q, "__dataclass_fields__") \
                else SimpleNamespace(**{**vars(q), "spec": _for_digest(q.spec, own_ref)})
        return engine._wait(lambda: content.run_saved(owner, target, params, conditions, 0, True, extra))

    return run


def items_for(engine: "Engine", owner: User, body: SubscriptionIn, extra: dict[str, Any], lang: str) -> tuple[str, str | None, list[Item]]:
    """(name, url, items) of the followed dashboard / question / metric. Raises ContentError when it is gone."""
    site = engine.settings.site_url()
    content = engine.content
    if body.target_type == "metric":
        return _metric_items(engine, owner, body, extra, lang, site)
    if body.target_type == "question":
        q = content.store.get_question(owner, body.target_id)
        url = f"{site}/questions/{q.id}" if site else None
        return q.name, url, [_question_item(engine, owner, q, q.name, url, q.viz, body.options.filters, {"question_id": q.id, **extra})]
    d = content.dashboards.get(owner, body.target_id)
    url = f"{site}/dashboards/{d.id}" if site else None
    questions = content.dashboards.card_questions(owner, d)
    tab_order = {t["id"]: i for i, t in enumerate(d.tabs)}
    filters = [DashboardFilter.model_validate(f) for f in d.filters]
    by_id = {f.id: f for f in filters}
    items: list[Item] = []
    for c in sorted(d.cards, key=lambda c: (tab_order.get(c.get("tab"), 0), c["layout"]["y"], c["layout"]["x"])):
        if c["kind"] != "question":
            continue
        q = questions.get(c["question_id"]) if c.get("question_id") else None
        title = c.get("title") or (q.name if q else "Question")
        q_url = f"{site}/questions/{q.id}" if site and q else None
        if q is None:
            items.append(Item(title=title, url=q_url, run=None, error="This question is not shared with the subscription's owner"))
            continue
        card = Card.model_validate(c)
        date_fid = next((fid for fid in card.mappings if fid in by_id and by_id[fid].type == "date_range"), None)
        mapped_ref = card.mappings[date_fid].field if date_fid else None
        own_ref = None if date_fid else (_date_ref(q.spec) if q.kind == "builder" else None)
        measure, fmt = _viz_measure(c.get("viz") or q.viz)
        if date_fid is None and own_ref is None:
            items.append(Item(title=title, url=q_url, run=None, measure=measure))
            continue

        def prepare(p: Period, card: Card = card, q: Any = q, date_fid: str | None = date_fid, own_ref: str | None = own_ref) -> tuple[dict[str, Any], list[dict[str, Any]]]:
            values = filter_values(filters, body.options.filters)
            if date_fid:
                values[date_fid] = [p.start, p.end]
            params, conditions = apply_filters(card, filters, values, q.kind, param_shapes(q.kind, q.spec))
            return params, conditions + (_range(own_ref, p) if own_ref else [])

        run = _question_runner(engine, owner, q, {"question_id": q.id, "dashboard_id": d.id, **extra}, prepare, mapped_ref or own_ref)
        items.append(Item(title=title, url=q_url, run=run, measure=measure, fmt=fmt, additive=_additive_for(engine, q)))
    return d.name, url, items


def _question_item(engine: "Engine", owner: User, q: Any, title: str, url: str | None, viz: Any,
                   params: dict[str, Any], extra: dict[str, Any]) -> Item:
    measure, fmt = _viz_measure(viz)
    ref = _date_ref(q.spec) if q.kind == "builder" else None
    if ref is None:
        return Item(title=title, url=url, run=None, measure=measure)
    run = _question_runner(engine, owner, q, extra, lambda p: (dict(params), _range(ref, p)), ref)
    return Item(title=title, url=url, run=run, measure=measure, fmt=fmt, additive=_additive_for(engine, q))


def metric_date_column(engine: "Engine", connection: str, table: str) -> str | None:
    """The metric table's date: the column the data model marks as "created" (or "updated"), else its first date column."""
    if engine.semantic is not None:
        meta = engine.semantic.fields(connection).get(table) or {}
        for kind in ("created", "updated"):
            for column, m in meta.items():
                if m.get("semantic_type") == kind:
                    return f"{table}.{column}"
    if engine.registry is not None:
        try:
            cols = engine.registry.get_schema(connection).get(table) or []
        except Exception:  # noqa: BLE001 - an unreachable database: the run reports it
            cols = []
        for kind in ("datetime", "date"):
            for c in cols:
                if normalize_type(c.get("type")) == kind:
                    return f"{table}.{c['name']}"
    return None


def metric_name(m: Any, lang: str) -> str:
    own = (m.translations or {}).get(lang) if isinstance(m.translations, dict) else None
    return str(own.get("name")) if isinstance(own, dict) and own.get("name") else m.name


def _metric_items(engine: "Engine", owner: User, body: SubscriptionIn, extra: dict[str, Any], lang: str, site: str) -> tuple[str, str | None, list[Item]]:
    try:
        m = engine.semantic.metric(body.target_id) if engine.semantic is not None else None
    except Exception:  # noqa: BLE001 - NotFound
        m = None
    if m is None or m.archived or not owner.can_use(m.connection):
        raise ContentError(GONE["metric"], 404)
    name = metric_name(m, lang)
    url = f"{site}/glossary" if site else None
    ref = metric_date_column(engine, m.connection, m.table)
    if ref is None:
        return name, url, [Item(title=name, url=url, run=None)]
    spec = {"version": 1, "connection": m.connection, "source": {"table": m.table},
            "aggregations": [{"fn": "metric", "metric": m.id, "alias": "value"}]}
    q = SimpleNamespace(id=0, name=name, kind="builder", spec=spec, parameters=[], connection=m.connection, viz=None)
    run = _question_runner(engine, owner, q, {"metric_id": m.id, **extra}, lambda p: ({}, _range(ref, p)), ref)
    return name, url, [Item(title=name, url=url, run=run, measure="value", fmt=m.format,
                            additive=lambda _n: str(m.definition.get("fn")) in ADDITIVE)]


# ---------------------------------------------------------------- the digest

def build_digest(engine: "Engine", owner: User, body: SubscriptionIn, sub_id: int | None) -> "Outcome":
    from .engine import Outcome

    every = body.options.digest or "week"
    lang = recipient_language(engine, owner)
    words = TEXTS[lang]
    extra = {"subscription_id": sub_id, "digest": every} if sub_id else {"subscription_preview": True, "digest": every}
    today = today_in(body.schedule.timezone)
    current, previous = periods(every, today)
    try:
        name, url, items = items_for(engine, owner, body, extra, lang)
    except ContentError:
        return Outcome(Report(title=body.target_type.capitalize(), lang=lang), error=GONE[body.target_type])
    name = body.name or name
    report = Report(title=words[f"title_{every}"].format(name=name), url=url, lang=lang, rows_per_card=body.options.rows,
                    subtitle=day_text(current.start, lang) if every == "day"
                    else f"{day_text(current.start, lang, year=False)} – {day_text(current.end, lang)}")
    outcome = Outcome(report)
    movements: list[Movement] = []
    comparable = failed = 0
    for item in items:
        detail: dict[str, Any] = {"title": item.title, "rows": None, "error": item.error}
        if item.run is not None and item.error is None:
            try:
                before, before_error = item.run(previous)
                now, now_error = item.run(current) if before_error is None else (None, None)
            except Exception as exc:  # one card never stops the digest
                logger.exception("digest card %r failed", item.title)
                before = now = None
                before_error, now_error = f"Unexpected error: {exc.__class__.__name__}", None
            detail["error"] = before_error or now_error
            if before is not None and now is not None:
                detail["rows"] = now.stats.row_count
                mv = compare(item, before, now)
                if mv is not None:
                    comparable += 1
                    movements.append(describe(mv, every, lang))
        if detail["error"]:
            failed += 1
        outcome.cards.append(detail)
    report.summary = sentences(movements, every, current, lang, comparable=comparable, failed=failed)
    for mv in sorted((m for m in movements if m.sentence), key=lambda m: (-m.score, m.item.title))[:MAX_PICTURES]:
        card = picture_card(mv)
        if card is not None:
            report.cards.append(card)
    if body.options.message.strip():
        report.summary.insert(0, body.options.message.strip())
    site = engine.settings.site_url()
    report.footer = words["footer"].format(owner=owner.username, name=name) + (
        words["footer_site"].format(site=site) if site else words["footer_local"])
    outcome.empty = comparable == 0
    return outcome

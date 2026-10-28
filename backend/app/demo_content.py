"""Ready-made content for the Factory demo (roadmap M11).

A newcomer's first steps (home page checklist) start at a dashboard, so the demo brings one:
a shared collection "Factory demo" with five questions and the dashboard "Production overview"
(period and line filters), set as the home page's "Start here" collection when none is set.

Created once (app setting "demo_content"); afterwards it is ordinary content that admins may
change, move or delete. The names follow NCODE_DEMO_LANGUAGE ("en" or "ru").
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

from sqlalchemy import delete, insert, select

from .appdb import AppDB, User
from .content.dashboards import Definition, DashboardStore
from .content.store import ContentError, ContentStore
from .content.tables import app_settings_table

logger = logging.getLogger(__name__)

CONTENT_SETTING = "demo_content"
CONTENT_VERSION = 1

TEXTS = {
    "en": {
        "collection": ("Factory demo", "Examples on the demo database: open them, change the filters, copy and adapt them."),
        "dashboard": ("Production overview", "Output, downtime and scrap of the plant. Change the period or pick a line above."),
        "output": ("Good pieces per week", "Pieces reported as good, per week."),
        "downtime": ("Downtime by reason", "Where the lines lose the most time: the ten biggest reasons."),
        "scrap": ("Scrapped pieces per line", "Which line scraps the most pieces."),
        "orders": ("Work orders", "How many work orders were produced."),
        "vehicles": ("Latest vehicles", "The last 50 cars built, with their VIN."),
        "period": "Period", "line": "Line",
        "intro": "**Production overview.** Change the *Period* or pick a *Line*: every card follows. "
                 "Click a card's title to open its question.",
    },
    "ru": {
        "collection": ("Демо: завод", "Примеры на демо-базе: открывайте, меняйте фильтры, копируйте и дорабатывайте."),
        "dashboard": ("Обзор производства", "Выпуск, простои и брак завода. Измените период или выберите линию выше."),
        "output": ("Годные детали по неделям", "Детали, отмеченные как годные, по неделям."),
        "downtime": ("Простои по причинам", "Где линии теряют больше всего времени: десять главных причин."),
        "scrap": ("Брак по линиям", "Какая линия бракует больше всего деталей."),
        "orders": ("Заказы-наряды", "Сколько заказов-нарядов выполнено."),
        "vehicles": ("Последние автомобили", "Последние 50 собранных машин с VIN."),
        "period": "Период", "line": "Линия",
        "intro": "**Обзор производства.** Измените *Период* или выберите *Линию* — все карточки обновятся. "
                 "Нажмите на заголовок карточки, чтобы открыть вопрос.",
    },
}


def _spec(**parts: Any) -> dict[str, Any]:
    return {"version": 1, "connection": "demo", **parts}


QUESTIONS: dict[str, dict[str, Any]] = {
    "output": _spec(
        source={"table": "production_output"},
        joins=[{"table": "work_orders"}, {"table": "production_lines"}],
        aggregations=[{"fn": "sum", "ref": "production_output.good_qty", "alias": "good_pieces"}],
        breakouts=[{"ref": "production_output.reported_at", "bucket": "week"}],
    ),
    "downtime": _spec(
        source={"table": "downtime_events"},
        joins=[{"table": "downtime_reasons"}, {"table": "production_lines"}],
        aggregations=[{"fn": "sum", "ref": "downtime_events.minutes", "alias": "minutes"}],
        breakouts=[{"ref": "downtime_reasons.name"}],
        order=[{"ref": "minutes", "dir": "desc"}],
        limit=10,
    ),
    "scrap": _spec(
        source={"table": "scrap_records"},
        joins=[{"table": "work_orders"}, {"table": "production_lines"}],
        aggregations=[{"fn": "sum", "ref": "scrap_records.qty", "alias": "scrapped"}],
        breakouts=[{"ref": "production_lines.name"}],
        order=[{"ref": "scrapped", "dir": "desc"}],
    ),
    "orders": _spec(
        source={"table": "work_orders"},
        joins=[{"table": "production_lines"}],
        aggregations=[{"fn": "count", "alias": "work_orders"}],
    ),
    "vehicles": _spec(
        source={"table": "vehicles"},
        fields=[{"ref": "vin"}, {"ref": "model"}, {"ref": "color"}, {"ref": "market"}, {"ref": "built_at"}],
        order=[{"ref": "built_at", "dir": "desc"}],
        limit=50,
    ),
}

# the dashboard: which date column the period filter narrows, and the line name for the line filter
DATES = {"output": "production_output.reported_at", "downtime": "downtime_events.started_at",
         "scrap": "scrap_records.recorded_at", "orders": "work_orders.production_date"}
LINES = {"output": "production_lines.name", "downtime": "production_lines.name",
         "scrap": "production_lines.name", "orders": "production_lines.name"}
LAYOUT = {  # 12 columns
    "intro": (0, 0, 12, 2), "orders": (0, 2, 3, 4), "output": (3, 2, 9, 4),
    "downtime": (0, 6, 6, 5), "scrap": (6, 6, 6, 5), "vehicles": (0, 11, 12, 6),
}


def _setting(app_db: AppDB, key: str) -> Any:
    with app_db.engine.connect() as conn:
        raw = conn.execute(select(app_settings_table.c.value).where(app_settings_table.c.key == key)).scalar()
    try:
        return json.loads(raw) if raw else None
    except ValueError:
        return None


def _put(app_db: AppDB, key: str, value: Any) -> None:
    with app_db.engine.begin() as conn:
        conn.execute(delete(app_settings_table).where(app_settings_table.c.key == key))
        conn.execute(insert(app_settings_table).values(key=key, value=json.dumps(value), secret=None,
                                                       updated_at=time.time(), updated_by="ncode"))


def seed_demo_content(
    app_db: AppDB, store: ContentStore, dashboards: DashboardStore, *, system: User, language: str = "en",
    set_start_here: Any = None,
) -> int | None:
    """Creates the demo collection once; returns its id (None when it was made before or failed)."""
    if _setting(app_db, CONTENT_SETTING) == CONTENT_VERSION:
        return None
    texts = TEXTS.get(language, TEXTS["en"])
    try:
        name, description = texts["collection"]
        col = store.create_collection(system, name, description)
        store.set_grants(system, col.id, [{"role": "all", "level": "view"}])
        ids: dict[str, int] = {}
        for key, spec in QUESTIONS.items():
            qname, qdesc = texts[key]
            ids[key] = store.create_question(
                system, name=qname, description=qdesc, collection_id=col.id, connection="demo", kind="builder", spec=spec,
            ).id
        cards: list[dict[str, Any]] = [{"key": "intro", "kind": "text", "text": texts["intro"], "layout": _layout("intro")}]
        for key, qid in ids.items():
            mappings = {}
            if key in DATES:
                mappings["period"] = {"field": DATES[key]}
            if key in LINES:
                mappings["line"] = {"field": LINES[key]}
            cards.append({"key": key, "kind": "question", "question_id": qid, "layout": _layout(key), "mappings": mappings})
        definition = Definition.model_validate({
            "filters": [
                {"id": "period", "label": texts["period"], "type": "date_range"},
                {"id": "line", "label": texts["line"], "type": "category"},
            ],
            "cards": cards,
        })
        dname, ddesc = texts["dashboard"]
        dashboards.create(system, name=dname, description=ddesc, collection_id=col.id, definition=definition)
        if set_start_here is not None:
            set_start_here(col.id)
    except (ContentError, ValueError) as exc:  # never stops the server; the admin can build their own
        logger.warning("The demo examples could not be created: %s", exc)
        return None
    _put(app_db, CONTENT_SETTING, CONTENT_VERSION)
    logger.info("Demo examples created: collection %r with %d questions and a dashboard", name, len(ids))
    return col.id


def _layout(key: str) -> dict[str, int]:
    x, y, w, h = LAYOUT[key]
    return {"x": x, "y": y, "w": w, "h": h}

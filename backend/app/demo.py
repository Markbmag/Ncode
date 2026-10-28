"""Factory demo (roadmap M11): a database to try Ncode on before a real one is connected.

A small car plant over the last twelve months: four production lines, three shifts, 40 parts,
2,000 work orders with their output, 1,500 downtime events, 800 scrap records, about 1,500
vehicles with VINs and a few hundred quality inspections. The numbers have the patterns people
look for: quiet Saturdays and closed Sundays, a weaker night shift, one line (Paint) worse than
the others, a downtime spike in one month (hydraulics on the welding line), more output in spring
and autumn than in the summer and Christmas holidays.

* generate(path, today) writes the SQLite file with the standard library only. The seed is fixed:
  the same day gives the same database. Dates end "today" at generation time.
* DemoDatabase (create_app) creates data/demo/factory.sqlite next to Ncode's own database on the
  first start, registers it as the connection "demo" ("Factory demo") that everyone may use, and
  fills the data model once: English names and descriptions with Russian translations for every
  table and column, and three metrics. Admins may change those like any others.
* NCODE_DEMO=0 turns it off (nothing is created). Admin -> Databases hides it for everyone
  (app setting "demo_hidden"); a connection of the same key from .env or the UI always wins.

    GET /api/admin/demo        (admin) {"enabled", "hidden", "available", "reason", "label"}
    PUT /api/admin/demo        (admin) {"hidden": true | false}
"""

from __future__ import annotations

import json
import logging
import math
import os
import random
import sqlite3
import threading
import time
from datetime import date, datetime, timedelta
from itertools import accumulate
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, Depends, FastAPI, HTTPException
from pydantic import BaseModel
from sqlalchemy import insert, select, update

from .appdb import AppDB, User
from .config import ConnectionConfig, Settings
from .content.tables import app_settings_table
from .db import ConnectionRegistry
from .semantic.store import FieldIn, MetricIn, SemanticStore, TableIn

logger = logging.getLogger("ncode.demo")

DEMO_KEY = "demo"
DEMO_LABEL = "Factory demo"
VERSION = 1          # PRAGMA user_version of the file; a new version regenerates it
SEED = 20261028
HIDDEN_SETTING = "demo_hidden"
SEEDED_SETTING = "demo_seeded"  # the data model was filled (once; admins may change it afterwards)

WORK_ORDERS = 2000
DOWNTIME_EVENTS = 1500
SCRAP_RECORDS = 800
INSPECTIONS = 240

# id, code, name, hall, parts per hour, share of the work orders, share of the downtime, scrap factor
LINES = [
    (1, "L1", "Press line", "Hall A", 120, 0.27, 0.21, 1.0),
    (2, "L2", "Welding line", "Hall A", 60, 0.26, 0.23, 0.9),
    (3, "L3", "Paint line", "Hall B", 45, 0.25, 0.36, 2.2),   # the problem line
    (4, "L4", "Final assembly", "Hall C", 4, 0.22, 0.20, 0.2),
]
# id, name, starts, ends, share of the work orders, yield, downtime factor
SHIFTS = [
    (1, "Morning", "06:00", "14:00", 0.40, 0.985, 1.0),
    (2, "Afternoon", "14:00", "22:00", 0.36, 0.980, 1.05),
    (3, "Night", "22:00", "06:00", 0.24, 0.960, 1.35),
]
# per line: (part number, name, category, unit cost, planned quantity range)
PARTS = {
    1: [("ST-1001", "Hood outer panel", "Panel", 38.5), ("ST-1002", "Roof panel", "Panel", 44.0),
        ("ST-1003", "Door outer panel, front left", "Panel", 27.9), ("ST-1004", "Door outer panel, front right", "Panel", 27.9),
        ("ST-1005", "Front fender, left", "Panel", 19.4), ("ST-1006", "Front fender, right", "Panel", 19.4),
        ("ST-1007", "Floor pan", "Panel", 52.3), ("ST-1008", "Trunk lid outer", "Panel", 31.2),
        ("ST-1009", "B-pillar reinforcement", "Panel", 12.6), ("ST-1010", "Rear wheel arch", "Panel", 9.8)],
    2: [("WE-2001", "Body side, left", "Subassembly", 210.0), ("WE-2002", "Body side, right", "Subassembly", 210.0),
        ("WE-2003", "Front end module", "Subassembly", 165.0), ("WE-2004", "Rear floor assembly", "Subassembly", 142.0),
        ("WE-2005", "Door assembly, front left", "Subassembly", 96.0), ("WE-2006", "Door assembly, front right", "Subassembly", 96.0),
        ("WE-2007", "Underbody", "Subassembly", 388.0), ("WE-2008", "Roof frame", "Subassembly", 88.0),
        ("WE-2009", "Tailgate assembly", "Subassembly", 121.0), ("WE-2010", "Dash panel", "Subassembly", 74.0)],
    3: [("PA-3001", "Atlas body, Polar white", "Painted body", 640.0), ("PA-3002", "Atlas body, Graphite", "Painted body", 655.0),
        ("PA-3003", "Atlas body, Ocean blue", "Painted body", 655.0), ("PA-3004", "Brio body, Polar white", "Painted body", 520.0),
        ("PA-3005", "Brio body, Ruby red", "Painted body", 538.0), ("PA-3006", "Brio body, Silver", "Painted body", 530.0),
        ("PA-3007", "Cargo body, Polar white", "Painted body", 710.0), ("PA-3008", "Bumper set, primed", "Painted part", 84.0),
        ("PA-3009", "Mirror caps, painted", "Painted part", 22.0), ("PA-3010", "Door set, touch-up", "Painted part", 140.0)],
    4: [("FA-4001", "Atlas Comfort", "Vehicle", 15900.0), ("FA-4002", "Atlas Sport", "Vehicle", 18400.0),
        ("FA-4003", "Atlas Premium", "Vehicle", 21300.0), ("FA-4004", "Brio City", "Vehicle", 11200.0),
        ("FA-4005", "Brio Plus", "Vehicle", 12600.0), ("FA-4006", "Brio Active", "Vehicle", 13400.0),
        ("FA-4007", "Cargo Van L1", "Vehicle", 17800.0), ("FA-4008", "Cargo Van L2", "Vehicle", 18900.0),
        ("FA-4009", "Cargo Van L2 high roof", "Vehicle", 19700.0), ("FA-4010", "Atlas Taxi", "Vehicle", 15100.0)],
}
PLANNED = {1: (240, 640), 2: (90, 260), 3: (60, 150), 4: (2, 6)}  # planned quantity per work order
# code, name, category, weight (Pareto: a few reasons cause most stops), typical minutes
DOWNTIME_REASONS = [
    ("D01", "Changeover", "Planned", 26, 35), ("D02", "Material shortage", "Logistics", 18, 40),
    ("D03", "Conveyor jam", "Mechanical", 14, 18), ("D04", "Robot fault", "Electrical", 11, 25),
    ("D05", "Quality hold", "Quality", 8, 45), ("D06", "Hydraulic failure", "Mechanical", 6, 80),
    ("D07", "Tool breakage", "Mechanical", 5, 50), ("D08", "No operator", "Organisational", 4, 30),
    ("D09", "Planned maintenance", "Planned", 4, 120), ("D10", "Power dip", "Electrical", 2, 60),
    ("D11", "MES / IT outage", "Electrical", 2, 40),
]
DOWNTIME_COMMENTS = {
    "D02": ["Waiting for coils", "Supplier truck late", "Wrong batch delivered", None],
    "D03": ["Cleared by operator", None, None],
    "D04": ["Robot R12 axis error", "Gripper sensor replaced", "Teach point lost", None],
    "D05": ["Holding batch for re-check", "Customer complaint", None],
    "D06": ["Hydraulic hose burst", "Pressure drop on press", "Pump replaced", None],
    "D07": ["Die insert broken", "Welding tip worn out", None],
}
# code, name, weight per line (1..4)
SCRAP_REASONS = [
    ("S01", "Surface scratch", (30, 10, 14, 2)), ("S02", "Dent", (26, 8, 2, 1)),
    ("S03", "Out of tolerance", (18, 22, 2, 1)), ("S04", "Weld spatter", (0, 30, 0, 0)),
    ("S05", "Paint run", (0, 0, 34, 0)), ("S06", "Dust inclusion", (0, 0, 30, 0)),
    ("S07", "Wrong part loaded", (4, 6, 2, 3)), ("S08", "Handling damage", (6, 4, 6, 2)),
]
# Seasonal output per month (the plant's own rhythm: summer and Christmas holidays)
MONTH_FACTOR = {1: 0.85, 2: 0.95, 3: 1.05, 4: 1.10, 5: 1.05, 6: 1.0, 7: 0.85, 8: 0.6, 9: 1.05, 10: 1.10, 11: 1.05, 12: 0.8}
WEEKDAY_FACTOR = (1.0, 1.0, 1.0, 1.0, 0.95, 0.35, 0.0)  # Monday .. Sunday (closed)
COLORS = (("Polar white", 34), ("Graphite", 22), ("Silver", 16), ("Ocean blue", 12), ("Ruby red", 9), ("Black", 7))
MARKETS = (("Domestic", 70), ("Export EU", 18), ("Export CIS", 12))
INSPECTORS = ("A. Petrov", "M. Ivanova", "J. Weber", "S. Novak", "L. Chen", "O. Smirnova")
WMI = "NCX"  # a made-up manufacturer code
MODEL_CODES = {"Atlas": "AT", "Brio": "BR", "Cargo": "CG"}


# ---------------------------------------------------------------- the generator

SCHEMA = """
CREATE TABLE production_lines (
    id INTEGER PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL, hall TEXT NOT NULL,
    parts_per_hour INTEGER NOT NULL, commissioned_on DATE
);
CREATE TABLE shifts (id INTEGER PRIMARY KEY, name TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL);
CREATE TABLE parts (
    id INTEGER PRIMARY KEY, part_number TEXT NOT NULL UNIQUE, name TEXT NOT NULL, category TEXT NOT NULL,
    line_id INTEGER NOT NULL REFERENCES production_lines(id), unit_cost REAL NOT NULL
);
CREATE TABLE work_orders (
    id INTEGER PRIMARY KEY, order_number TEXT NOT NULL UNIQUE,
    part_id INTEGER NOT NULL REFERENCES parts(id),
    line_id INTEGER NOT NULL REFERENCES production_lines(id),
    shift_id INTEGER NOT NULL REFERENCES shifts(id),
    production_date DATE NOT NULL, planned_qty INTEGER NOT NULL, status TEXT NOT NULL,
    started_at DATETIME, finished_at DATETIME
);
CREATE TABLE production_output (
    id INTEGER PRIMARY KEY, work_order_id INTEGER NOT NULL REFERENCES work_orders(id),
    reported_at DATETIME NOT NULL, good_qty INTEGER NOT NULL, scrap_qty INTEGER NOT NULL
);
CREATE TABLE downtime_reasons (id INTEGER PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL);
CREATE TABLE downtime_events (
    id INTEGER PRIMARY KEY,
    line_id INTEGER NOT NULL REFERENCES production_lines(id),
    shift_id INTEGER NOT NULL REFERENCES shifts(id),
    reason_id INTEGER NOT NULL REFERENCES downtime_reasons(id),
    work_order_id INTEGER REFERENCES work_orders(id),
    started_at DATETIME NOT NULL, minutes INTEGER NOT NULL, comment TEXT
);
CREATE TABLE scrap_reasons (id INTEGER PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL);
CREATE TABLE scrap_records (
    id INTEGER PRIMARY KEY, work_order_id INTEGER NOT NULL REFERENCES work_orders(id),
    reason_id INTEGER NOT NULL REFERENCES scrap_reasons(id), qty INTEGER NOT NULL, recorded_at DATETIME NOT NULL
);
CREATE TABLE vehicles (
    id INTEGER PRIMARY KEY, vin TEXT NOT NULL UNIQUE, model TEXT NOT NULL, color TEXT NOT NULL, market TEXT NOT NULL,
    work_order_id INTEGER NOT NULL REFERENCES work_orders(id), built_at DATETIME NOT NULL
);
CREATE TABLE quality_inspections (
    id INTEGER PRIMARY KEY, vehicle_id INTEGER NOT NULL REFERENCES vehicles(id), inspected_at DATETIME NOT NULL,
    inspector TEXT NOT NULL, result TEXT NOT NULL, defects INTEGER NOT NULL, notes TEXT
);
CREATE INDEX ix_work_orders_date ON work_orders (production_date);
CREATE INDEX ix_downtime_events_started ON downtime_events (started_at);
CREATE INDEX ix_output_order ON production_output (work_order_id);
CREATE INDEX ix_scrap_order ON scrap_records (work_order_id);
CREATE INDEX ix_vehicles_order ON vehicles (work_order_id);
"""

_VIN_VALUES = {**{str(d): d for d in range(10)}, **dict(zip("ABCDEFGH", range(1, 9))), **dict(zip("JKLMN", range(1, 6))),
               "P": 7, "R": 9, **dict(zip("STUVWXYZ", range(2, 10)))}
_VIN_WEIGHTS = (8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2)
_MODEL_YEARS = "ABCDEFGHJKLMNPRSTVWXY123456789"  # 2010, 2011 ...


def vin_check_digit(vin: str) -> str:
    """The 9th character of a North American / ISO 3779 VIN."""
    total = sum(_VIN_VALUES[c] * w for c, w in zip(vin, _VIN_WEIGHTS))
    rest = total % 11
    return "X" if rest == 10 else str(rest)


def make_vin(model: str, variant: int, year: int, serial: int) -> str:
    code = MODEL_CODES.get(model.split()[0], "XX")
    # 1-3 maker, 4-8 model / body / engine, 9 check digit, 10 model year, 11 plant, 12-17 serial number
    raw = f"{WMI}{code}{variant % 10}{'AB'[serial % 2]}C0{_MODEL_YEARS[(year - 2010) % 30]}K{serial % 1_000_000:06d}"
    return raw[:8] + vin_check_digit(raw) + raw[9:]


def _ts(value: datetime) -> str:
    return value.strftime("%Y-%m-%d %H:%M:%S")


def _at(day: date, hhmm: str) -> datetime:
    h, m = hhmm.split(":")
    return datetime(day.year, day.month, day.day, int(h), int(m))


def _minutes(rng: random.Random, typical: float, spread: float = 0.6) -> int:
    value = rng.lognormvariate(math.log(typical) - spread * spread / 2, spread)
    return int(min(480, max(2, round(value))))


def generate(path: Path, today: date | None = None, seed: int = SEED) -> dict[str, int]:
    """Write the demo database to `path` (replacing it) and return the row count per table.

    The data ends now (or at the end of `today` when it is given: the same day and seed give
    the same file).
    """
    now = datetime.now().replace(microsecond=0) if today is None else datetime.combine(today, datetime.max.time()).replace(microsecond=0)
    today = now.date()
    rng = random.Random(seed)
    days = [today - timedelta(days=n) for n in range(364, -1, -1)]

    def worked(d: date) -> float:
        holiday = (d.month == 12 and d.day >= 24) or (d.month == 1 and d.day <= 2)
        return 0.0 if holiday else WEEKDAY_FACTOR[d.weekday()] * MONTH_FACTOR[d.month]

    day_cum = list(accumulate(worked(d) for d in days))
    spike = (today - timedelta(days=120)).replace(day=1)  # the month the welding line's hydraulics failed

    lines = [(lid, code, name, hall, rate, (today - timedelta(days=365 * (9 - lid))).isoformat())
             for lid, code, name, hall, rate, *_ in LINES]
    shifts = [(sid, name, start, end) for sid, name, start, end, *_ in SHIFTS]
    parts: list[tuple[Any, ...]] = []
    parts_of: dict[int, list[int]] = {}
    for lid, items in PARTS.items():
        for number, name, category, cost in items:
            parts.append((len(parts) + 1, number, name, category, lid, cost))
            parts_of.setdefault(lid, []).append(len(parts))
    part_by_id = {p[0]: p for p in parts}
    line_info = {line[0]: line for line in LINES}
    shift_info = {s[0]: s for s in SHIFTS}

    # work orders: when, where, what
    drafts = []
    for _ in range(WORK_ORDERS):
        day = rng.choices(days, cum_weights=day_cum)[0]
        line = rng.choices([line[0] for line in LINES], weights=[line[5] for line in LINES])[0]
        shift = rng.choices([s[0] for s in SHIFTS], weights=[s[4] for s in SHIFTS])[0]
        part = rng.choice(parts_of[line])
        drafts.append((day, shift, line, part, rng.random(), rng.random(), rng.random(), rng.random()))
    drafts.sort(key=lambda d: (d[0], d[1], d[2], d[3]))

    orders: list[list[Any]] = []
    produced: dict[int, int] = {}
    slots: dict[tuple[date, int, int], list[int]] = {}
    for oid, (day, shift, line, part, r1, r2, r3, r4) in enumerate(drafts, start=1):
        low, high = PLANNED[line]
        planned = int(low + (high - low) * r1)
        if line != 4:
            planned = max(low, round(planned / 10) * 10)
        start = _at(day, shift_info[shift][2]) + timedelta(minutes=int(r2 * 90))
        hours = planned / line_info[line][4] * (0.9 + 0.4 * r2)
        finished = start + timedelta(minutes=int(hours * 60) + 5)
        if start > now:
            status = "planned"
        elif finished > now:
            status = "in_progress"
        else:
            status = "cancelled" if r4 < 0.02 else "completed"
        made = 0
        if status == "completed":  # the night shift makes a little less good work
            made = max(1, round(planned * (0.95 + 0.07 * r3) * shift_info[shift][5] / 0.985))
        elif status == "in_progress":
            made = round(planned * (now - start) / (finished - start))
        if status != "completed":
            finished = None
        if status == "planned":
            start = None
        orders.append([oid, f"WO-{day:%y%m}-{oid:05d}", part, line, shift, day.isoformat(), planned, status,
                       _ts(start) if start else None, _ts(finished) if finished else None])
        if made:
            produced[oid] = made
        slots.setdefault((day, line, shift), []).append(oid)

    # scrap: the paint line and the night shift scrap the most
    scrap_rows = []
    scrap_of: dict[int, int] = {}
    candidates = [o for o in orders if o[0] in produced]
    scrap_cum = list(accumulate(line_info[o[3]][7] * (1.0 if o[4] != 3 else 1.6) * math.sqrt(produced[o[0]]) for o in candidates))
    for _ in range(SCRAP_RECORDS):
        o = rng.choices(candidates, cum_weights=scrap_cum)[0]
        oid, line = o[0], o[3]
        reason = rng.choices(range(1, len(SCRAP_REASONS) + 1), weights=[r[2][line - 1] for r in SCRAP_REASONS])[0]
        room = produced[oid] - scrap_of.get(oid, 0) - 1
        qty = min(room, 1 if line == 4 else rng.randint(1, {1: 14, 2: 7, 3: 6}[line]))
        if qty < 1:
            qty = 1
            produced[oid] += 1  # the order made one more to scrap it
        scrap_of[oid] = scrap_of.get(oid, 0) + qty
        start = datetime.fromisoformat(o[8])
        scrap_rows.append([oid, reason, qty, min(now, start + timedelta(minutes=rng.randint(10, 400)))])
    scrap_rows.sort(key=lambda r: (r[3], r[0]))
    scrap_rows = [(i, oid, reason, qty, _ts(at)) for i, (oid, reason, qty, at) in enumerate(scrap_rows, start=1)]

    # output: one or two confirmations per order (night shifts confirm less good parts)
    output = []
    for o in orders:
        oid = o[0]
        if oid not in produced:
            continue
        scrap = scrap_of.get(oid, 0)
        good = produced[oid] - scrap
        start = datetime.fromisoformat(o[8])
        end = datetime.fromisoformat(o[9]) if o[9] else now
        if good > 40 and rng.random() < 0.6:
            first = int(good * rng.uniform(0.35, 0.65))
            output.append([oid, start + (end - start) / 2, first, scrap // 2])
            output.append([oid, end, good - first, scrap - scrap // 2])
        else:
            output.append([oid, end, good, scrap])
    output = [(i, oid, _ts(at), good, scrap) for i, (oid, at, good, scrap) in enumerate(output, start=1)]
    good_of: dict[int, int] = {}
    for _i, oid, _at_, good, _s in output:
        good_of[oid] = good_of.get(oid, 0) + good

    # downtime: Pareto reasons, the paint line and the night shift stop more, a spike in one month
    reasons = list(range(1, len(DOWNTIME_REASONS) + 1))
    reason_weights = [r[3] for r in DOWNTIME_REASONS]
    dt_cum = list(accumulate(worked(d) * (2.6 if (d.year, d.month) == (spike.year, spike.month) else 1.0) for d in days))
    downtime = []
    for _ in range(DOWNTIME_EVENTS):
        day = rng.choices(days, cum_weights=dt_cum)[0]
        in_spike = (day.year, day.month) == (spike.year, spike.month)
        line_weights = [line[6] * (3.0 if in_spike and line[0] == 2 else 1.0) for line in LINES]
        line = rng.choices([line[0] for line in LINES], weights=line_weights)[0]
        shift = rng.choices([s[0] for s in SHIFTS], weights=[s[4] * s[6] for s in SHIFTS])[0]
        if in_spike and line == 2 and rng.random() < 0.55:
            reason = 6  # hydraulic failure
        else:
            reason = rng.choices(reasons, weights=reason_weights)[0]
        code, _name, _cat, _w, typical = DOWNTIME_REASONS[reason - 1]
        minutes = _minutes(rng, typical * (1.6 if reason == 6 and in_spike else 1.0))
        started = _at(day, shift_info[shift][2]) + timedelta(minutes=rng.randint(5, 470))
        if started + timedelta(minutes=minutes) > now:  # not happened yet: the day before
            started -= timedelta(days=1)
        same_slot = slots.get((day, line, shift))
        order = rng.choice(same_slot) if same_slot and rng.random() < 0.85 else None
        comment = rng.choice(DOWNTIME_COMMENTS.get(code, [None]))
        downtime.append([line, shift, reason, order, started, minutes, comment])
    downtime.sort(key=lambda r: (r[4], r[0]))
    downtime = [(i, *r[:4], _ts(r[4]), r[5], r[6]) for i, r in enumerate(downtime, start=1)]

    # vehicles: one per good unit of the final assembly orders
    vehicles = []
    serial = 0
    for o in orders:
        if o[3] != 4 or o[0] not in good_of:
            continue
        model = part_by_id[o[2]][2]
        start = datetime.fromisoformat(o[8])
        end = datetime.fromisoformat(o[9]) if o[9] else now
        good = good_of[o[0]]
        for n in range(good):  # spread over the order's run
            built = start + (end - start) * (n + 1) / (good + 1) - timedelta(minutes=rng.randint(0, 4))
            serial += 1
            color = rng.choices([c for c, _ in COLORS], weights=[w for _, w in COLORS])[0]
            market = rng.choices([m for m, _ in MARKETS], weights=[w for _, w in MARKETS])[0]
            vin = make_vin(model, o[2], built.year, 100000 + serial)
            vehicles.append((serial, vin, model, color, market, o[0], _ts(built.replace(microsecond=0))))

    # quality inspections: a sample of the vehicles
    inspections = []
    sample = sorted(rng.sample(range(len(vehicles)), min(INSPECTIONS, len(vehicles))))
    for vi in sample:
        v = vehicles[vi]
        at = min(now, datetime.fromisoformat(v[6]) + timedelta(minutes=rng.randint(30, 2880)))
        result = rng.choices(["pass", "rework", "fail"], weights=[84, 13, 3])[0]
        defects = 0 if result == "pass" else rng.randint(1, 4)
        notes = None if result == "pass" else rng.choice(
            ["Paint defect on hood", "Panel gap out of spec", "Water leak test failed", "Squeak in dashboard", "Wiring connector loose"])
        inspections.append([v[0], at, rng.choice(INSPECTORS), result, defects, notes])
    inspections.sort(key=lambda r: (r[1], r[0]))
    inspections = [(i, r[0], _ts(r[1]), *r[2:]) for i, r in enumerate(inspections, start=1)]

    tables: dict[str, list[tuple[Any, ...]]] = {
        "production_lines": lines,
        "shifts": shifts,
        "parts": parts,
        "work_orders": [tuple(o) for o in orders],
        "production_output": output,
        "downtime_reasons": [(i, code, name, cat) for i, (code, name, cat, _w, _t) in enumerate(DOWNTIME_REASONS, start=1)],
        "downtime_events": downtime,
        "scrap_reasons": [(i, code, name) for i, (code, name, _w) in enumerate(SCRAP_REASONS, start=1)],
        "scrap_records": scrap_rows,
        "vehicles": vehicles,
        "quality_inspections": inspections,
    }

    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    tmp.unlink(missing_ok=True)
    con = sqlite3.connect(tmp)
    try:
        con.executescript(SCHEMA)
        for name, rows in tables.items():
            if rows:
                marks = ", ".join("?" * len(rows[0]))
                con.executemany(f"INSERT INTO {name} VALUES ({marks})", rows)
        con.execute(f"PRAGMA user_version = {VERSION}")
        con.commit()
    finally:
        con.close()
    os.replace(tmp, path)
    return {name: len(rows) for name, rows in tables.items()}


def file_version(path: Path) -> int | None:
    """The generator version of an existing demo file (None: missing or not readable)."""
    if not path.is_file():
        return None
    try:
        con = sqlite3.connect(path)
        try:
            return int(con.execute("PRAGMA user_version").fetchone()[0])
        finally:
            con.close()
    except sqlite3.Error:
        return None


# ---------------------------------------------------------------- the data model (English + Russian)

# table: (name, description, Russian name, Russian description, {column: (name, description, Russian name,
#         Russian description[, semantic type[, format]])})
MODEL: dict[str, tuple[str, str, str, str, dict[str, tuple[Any, ...]]]] = {
    "production_lines": ("Production lines", "The four lines of the plant, from the press shop to final assembly.",
                         "Производственные линии", "Четыре линии завода: от прессового цеха до главного конвейера.", {
        "id": ("Line ID", "Number of the line.", "ID линии", "Номер линии.", "id"),
        "code": ("Line code", "Short code used on the shop floor (L1 ... L4).", "Код линии", "Короткий код в цеху (L1 ... L4).", "category"),
        "name": ("Line", "Name of the line.", "Линия", "Название линии.", "name"),
        "hall": ("Hall", "Building the line stands in.", "Корпус", "Корпус, в котором стоит линия.", "category"),
        "parts_per_hour": ("Rated speed", "Parts (or vehicles) per hour the line is designed for.",
                           "Паспортная скорость", "Сколько деталей (или машин) в час рассчитана выпускать линия.", "quantity"),
        "commissioned_on": ("Commissioned on", "Date the line started production.", "Дата запуска", "Когда линия начала работать."),
    }),
    "shifts": ("Shifts", "The three shifts of a working day.", "Смены", "Три смены рабочего дня.", {
        "id": ("Shift ID", "Number of the shift.", "ID смены", "Номер смены.", "id"),
        "name": ("Shift", "Morning, afternoon or night.", "Смена", "Утренняя, дневная или ночная.", "category"),
        "starts_at": ("Starts at", "Local time the shift starts.", "Начало", "Время начала смены."),
        "ends_at": ("Ends at", "Local time the shift ends.", "Окончание", "Время окончания смены."),
    }),
    "parts": ("Parts", "What the lines make: panels, welded subassemblies, painted bodies and vehicles.",
              "Детали", "Что выпускают линии: панели, сварные узлы, окрашенные кузова и автомобили.", {
        "id": ("Part ID", "Number of the part.", "ID детали", "Номер детали.", "id"),
        "part_number": ("Part number", "Part number from the drawing.", "Номер детали по чертежу", "Обозначение детали по чертежу.", "id"),
        "name": ("Part", "Name of the part.", "Деталь", "Наименование детали.", "name"),
        "category": ("Category", "Kind of part.", "Категория", "Вид детали.", "category"),
        "line_id": ("Line", "Line that makes the part.", "Линия", "Линия, на которой делают деталь."),
        "unit_cost": ("Unit cost", "Cost of one piece in euros.", "Себестоимость", "Себестоимость одной штуки в евро.", "currency",
                      {"style": "currency", "currency": "EUR"}),
    }),
    "work_orders": ("Work orders", "Production orders: which part, on which line and shift, how many.",
                    "Производственные заказы", "Заказы на производство: какая деталь, на какой линии и в какую смену, сколько штук.", {
        "id": ("Work order ID", "Number of the work order.", "ID заказа", "Номер заказа.", "id"),
        "order_number": ("Order number", "Number printed on the order papers.", "Номер заказа", "Номер на бумагах заказа.", "id"),
        "part_id": ("Part", "Part the order makes.", "Деталь", "Деталь, которую делают по заказу."),
        "line_id": ("Line", "Line the order runs on.", "Линия", "Линия, на которой выполняется заказ."),
        "shift_id": ("Shift", "Shift the order runs in.", "Смена", "Смена, в которую выполняется заказ."),
        "production_date": ("Production date", "Day the order is produced.", "Дата производства", "День выполнения заказа.", "created"),
        "planned_qty": ("Planned quantity", "Pieces the order should make.", "План, шт.", "Сколько штук нужно сделать по заказу.", "quantity"),
        "status": ("Status", "Planned, in progress, completed or cancelled.", "Статус", "Запланирован, в работе, выполнен или отменён.", "category"),
        "started_at": ("Started at", "When the line started the order.", "Начат", "Когда линия начала заказ."),
        "finished_at": ("Finished at", "When the order was finished (empty while it runs).", "Завершён", "Когда заказ закончен (пусто, пока он в работе)."),
    }),
    "production_output": ("Production output", "Good and scrapped pieces reported for the work orders.",
                          "Выпуск продукции", "Сколько годных и бракованных штук сдано по заказам.", {
        "id": ("Report ID", "Number of the output report.", "ID отчёта", "Номер отчёта о выпуске.", "id"),
        "work_order_id": ("Work order", "Work order the pieces belong to.", "Заказ", "Заказ, к которому относятся штуки."),
        "reported_at": ("Reported at", "When the output was reported.", "Время отчёта", "Когда сдан выпуск.", "created"),
        "good_qty": ("Good pieces", "Pieces that passed.", "Годные, шт.", "Годные штуки.", "quantity"),
        "scrap_qty": ("Scrapped pieces", "Pieces that went to scrap.", "Брак, шт.", "Штуки, ушедшие в брак.", "quantity"),
    }),
    "downtime_reasons": ("Downtime reasons", "Why a line can stand still.", "Причины простоев", "Почему линия может стоять.", {
        "id": ("Reason ID", "Number of the reason.", "ID причины", "Номер причины.", "id"),
        "code": ("Reason code", "Code the operator picks on the terminal.", "Код причины", "Код, который оператор выбирает на терминале.", "category"),
        "name": ("Reason", "What stopped the line.", "Причина", "Что остановило линию.", "category"),
        "category": ("Reason group", "Planned, mechanical, electrical, logistics ...", "Группа причин", "Плановые, механика, электрика, логистика ...", "category"),
    }),
    "downtime_events": ("Downtime events", "Every stop of a line: when, how long and why.",
                        "Простои", "Каждая остановка линии: когда, как долго и почему.", {
        "id": ("Event ID", "Number of the stop.", "ID простоя", "Номер остановки.", "id"),
        "line_id": ("Line", "Line that stopped.", "Линия", "Линия, которая стояла."),
        "shift_id": ("Shift", "Shift the stop happened in.", "Смена", "Смена, в которую был простой."),
        "reason_id": ("Reason", "Why the line stopped.", "Причина", "Почему линия стояла."),
        "work_order_id": ("Work order", "Order that was running (empty if none).", "Заказ", "Заказ, который выполнялся (пусто, если не было)."),
        "started_at": ("Started at", "When the line stopped.", "Начало простоя", "Когда линия остановилась.", "created"),
        "minutes": ("Duration, min", "How long the line stood still, in minutes.", "Длительность, мин", "Сколько минут стояла линия.", "quantity"),
        "comment": ("Comment", "What the operator wrote.", "Комментарий", "Что написал оператор.", "description"),
    }),
    "scrap_reasons": ("Scrap reasons", "Why a piece was scrapped.", "Причины брака", "Почему деталь ушла в брак.", {
        "id": ("Reason ID", "Number of the reason.", "ID причины", "Номер причины.", "id"),
        "code": ("Reason code", "Code of the defect.", "Код дефекта", "Код дефекта.", "category"),
        "name": ("Reason", "Kind of defect.", "Причина брака", "Вид дефекта.", "category"),
    }),
    "scrap_records": ("Scrap records", "Scrapped pieces with the reason, per work order.",
                      "Записи о браке", "Бракованные штуки с причиной, по заказам.", {
        "id": ("Record ID", "Number of the record.", "ID записи", "Номер записи.", "id"),
        "work_order_id": ("Work order", "Order the pieces came from.", "Заказ", "Заказ, из которого брак."),
        "reason_id": ("Reason", "Why the pieces were scrapped.", "Причина", "Почему штуки ушли в брак."),
        "qty": ("Scrapped pieces", "Number of pieces.", "Брак, шт.", "Количество штук.", "quantity"),
        "recorded_at": ("Recorded at", "When the scrap was booked.", "Время записи", "Когда брак оформлен.", "created"),
    }),
    "vehicles": ("Vehicles", "Every car built, with its VIN.", "Автомобили", "Каждая собранная машина с её VIN.", {
        "id": ("Vehicle ID", "Number of the vehicle.", "ID автомобиля", "Номер автомобиля.", "id"),
        "vin": ("VIN", "Vehicle identification number (17 characters).", "VIN", "Идентификационный номер (17 знаков).", "id"),
        "model": ("Model", "Model and trim.", "Модель", "Модель и комплектация.", "category"),
        "color": ("Colour", "Body colour.", "Цвет", "Цвет кузова.", "category"),
        "market": ("Market", "Where the car is sold.", "Рынок", "Где продаётся машина.", "category"),
        "work_order_id": ("Work order", "Final assembly order that built the car.", "Заказ", "Заказ главного конвейера, по которому собрана машина."),
        "built_at": ("Built at", "When the car left the line.", "Время сборки", "Когда машина сошла с конвейера.", "created"),
    }),
    "quality_inspections": ("Quality inspections", "Final checks of a sample of the vehicles.",
                            "Контроль качества", "Финальная проверка части автомобилей.", {
        "id": ("Inspection ID", "Number of the inspection.", "ID проверки", "Номер проверки.", "id"),
        "vehicle_id": ("Vehicle", "Car that was checked.", "Автомобиль", "Проверенная машина."),
        "inspected_at": ("Inspected at", "When the car was checked.", "Время проверки", "Когда проверили машину.", "created"),
        "inspector": ("Inspector", "Who checked it.", "Контролёр", "Кто проверял.", "name"),
        "result": ("Result", "Pass, rework or fail.", "Результат", "Годен, доработка или брак.", "category"),
        "defects": ("Defects", "Number of defects found.", "Дефекты", "Сколько дефектов найдено.", "quantity"),
        "notes": ("Notes", "What was found.", "Заметки", "Что нашли.", "description"),
    }),
}

METRICS = [  # name, description, Russian name, Russian description, table, definition, format
    ("Output", "Good pieces reported (vehicles on final assembly).", "Выпуск",
     "Сданные годные штуки (на главном конвейере - машины).", "production_output",
     {"fn": "sum", "ref": "production_output.good_qty"}, {"style": "number", "decimals": 0}),
    # An average of per-report shares, named as such: a true scrap rate (all scrap ÷ all pieces)
    # needs ratio metrics (planned, ROADMAP M12).
    ("Average scrap rate per report", "The share of scrapped pieces in each output report, averaged over the reports.",
     "Средняя доля брака по отчётам", "Доля бракованных штук в каждом отчёте о выпуске, усреднённая по отчётам.",
     "production_output",
     {"fn": "avg", "expr": {"op": "/", "args": [
         {"ref": "production_output.scrap_qty"},
         {"op": "+", "args": [{"ref": "production_output.good_qty"}, {"ref": "production_output.scrap_qty"}]},
     ]}}, {"style": "percent", "decimals": 1}),
    ("Downtime hours", "Hours the lines stood still.", "Часы простоя", "Сколько часов стояли линии.", "downtime_events",
     {"fn": "sum", "expr": {"op": "/", "args": [{"ref": "downtime_events.minutes"}, {"value": 60}]}}, {"style": "number", "decimals": 1}),
]

SYSTEM = User(id=0, username="ncode", role="admin")


def seed_data_model(semantic: SemanticStore) -> None:
    """English names and descriptions with Russian translations; the metrics. What an admin set stays."""
    tables, fields = semantic.tables(DEMO_KEY), semantic.fields(DEMO_KEY)
    for table, (name, description, ru_name, ru_description, columns) in MODEL.items():
        if table not in tables:
            semantic.set_table(SYSTEM, DEMO_KEY, table, TableIn(
                display_name=name, description=description,
                translations={"ru": {"display_name": ru_name, "description": ru_description}}))
        for column, (cname, cdesc, ru_cname, ru_cdesc, *extra) in columns.items():
            if column in fields.get(table, {}):
                continue
            semantic.set_field(SYSTEM, DEMO_KEY, table, column, FieldIn(
                display_name=cname, description=cdesc,
                semantic_type=extra[0] if extra else None, format=extra[1] if len(extra) > 1 else None,
                translations={"ru": {"display_name": ru_cname, "description": ru_cdesc}}))
    existing = {m.name for m in semantic.metrics({DEMO_KEY})} | {m.name for m in semantic.metrics({DEMO_KEY}, archived=True)}
    for name, description, ru_name, ru_description, table, definition, fmt in METRICS:
        if name in existing:
            continue
        semantic.save_metric(SYSTEM, MetricIn.model_validate({
            "name": name, "description": description, "connection": DEMO_KEY, "table": table, "definition": definition,
            "format": fmt, "translations": {"ru": {"name": ru_name, "description": ru_description}},
        }))


# ---------------------------------------------------------------- the connection

class DemoDatabase:
    """Creates, registers, hides and shows the demo database of one app."""

    def __init__(self, settings: Settings, app_db: AppDB, registry: ConnectionRegistry, semantic: SemanticStore,
                 path: Path | None = None):
        self.enabled = settings.demo_enabled
        self.app_db = app_db
        self.registry = registry
        self.semantic = semantic
        self.path = path or app_db.path.parent / "demo" / "factory.sqlite"
        self.reason: str | None = None  # why it is not available: "conflict" | "error"
        self._lock = threading.Lock()

    @property
    def config(self) -> ConnectionConfig:
        return ConnectionConfig(key=DEMO_KEY, label=DEMO_LABEL, engine="sqlite", database=str(self.path),
                                id_hints=("vin", "order_number"), source="demo")

    def registered(self) -> bool:
        cfg = self.registry.configs.get(DEMO_KEY)
        return cfg is not None and cfg.source == "demo"

    def start(self) -> None:
        """At startup: create the file (first start or new version), fill the data model once, register."""
        if not self.enabled:
            return
        if DEMO_KEY in self.registry.configs:
            self.reason = "conflict"
            logger.warning("The demo database is not added: a connection with the key %r exists already", DEMO_KEY)
            return
        try:
            if file_version(self.path) != VERSION:
                started = time.perf_counter()
                counts = generate(self.path)
                logger.info("Demo database created in %s (%d work orders, %.1f s)", self.path,
                            counts["work_orders"], time.perf_counter() - started)
            if self._setting(SEEDED_SETTING) != VERSION:
                seed_data_model(self.semantic)
                self._put(SEEDED_SETTING, VERSION, None)
        except (OSError, sqlite3.Error, ValueError) as exc:
            self.reason = "error"
            logger.warning("The demo database could not be created in %s: %s", self.path, exc)
            return
        if not self.hidden():
            self._show()

    def hidden(self) -> bool:
        return bool(self._setting(HIDDEN_SETTING))

    def set_hidden(self, hidden: bool, user: User) -> None:
        with self._lock:
            self._put(HIDDEN_SETTING, hidden, user.username)
            if hidden:
                self._hide()
            elif self.enabled and self.reason in (None, "conflict") and not self.registered():
                if DEMO_KEY in self.registry.configs:  # a connection took the key meanwhile
                    self.reason = "conflict"
                elif self.path.is_file():
                    self.reason = None
                    self._show()

    def status(self) -> dict[str, Any]:
        available = self.enabled and self.reason is None
        return {"enabled": self.enabled, "hidden": self.hidden(), "available": available, "reason": self.reason,
                "label": DEMO_LABEL, "key": DEMO_KEY}

    def _show(self) -> None:
        self.registry.set_config(self.config)
        self.app_db.open_connections.add(DEMO_KEY)

    def _hide(self) -> None:
        if self.registered():
            self.registry.remove(DEMO_KEY)
        self.app_db.open_connections.discard(DEMO_KEY)

    # app_settings: {"key": "demo_hidden", "value": "true"}
    def _setting(self, key: str) -> Any:
        with self.app_db.engine.connect() as conn:
            row = conn.execute(select(app_settings_table.c.value).where(app_settings_table.c.key == key)).first()
        try:
            return json.loads(row.value) if row else None
        except ValueError:
            return None

    def _put(self, key: str, value: Any, user: str | None) -> None:
        values = {"value": json.dumps(value), "updated_at": time.time(), "updated_by": user}
        with self.app_db.engine.begin() as conn:
            done = conn.execute(update(app_settings_table).where(app_settings_table.c.key == key).values(**values)).rowcount
            if not done:
                conn.execute(insert(app_settings_table).values(key=key, secret=None, **values))


class DemoIn(BaseModel):
    hidden: bool


def register_demo_routes(
    app: FastAPI, *, demo: DemoDatabase, require_admin: Callable[..., User], on_change: Callable[[], None],
) -> None:
    router = APIRouter(tags=["admin"])

    @router.get("/api/admin/demo")
    def demo_status(_admin: User = Depends(require_admin)):
        return demo.status()

    @router.put("/api/admin/demo")
    def demo_hide(body: DemoIn, admin: User = Depends(require_admin)):
        if not demo.enabled:
            raise HTTPException(status_code=400, detail="The demo database is turned off on the server (NCODE_DEMO)")
        demo.set_hidden(body.hidden, admin)
        on_change()
        return demo.status()

    app.include_router(router)

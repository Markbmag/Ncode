"""Excel export of a result envelope (xlsxwriter, constant memory: rows are written
and flushed one by one, so even the largest allowed result stays small in memory).

Cells keep their type: numbers are numbers, dates and date-times are real Excel
dates, booleans are TRUE/FALSE. Text that a spreadsheet would run as a formula
(=, +, -, @) is written as plain text, never as a formula.

A result shown as a pivot table (M12) is written as that pivot: the frontend sends its
layout (PivotLayout: rows, columns, values with their names and number formats, totals) and
the grid is built here from the result's rows, by the rules of frontend/src/viz/pivot.ts:
header rows (the value's and column fields' names, one row per column field, the row fields'
names), an outer row label once per group, totals per row and column, number formats kept.
"""

from __future__ import annotations

import datetime as dt
import json
import math
import tempfile
from typing import IO, Any, Iterator, Literal

import xlsxwriter
from pydantic import BaseModel, ConfigDict, Field

from ..results import ResultEnvelope

CHUNK = 64 * 1024
MAX_COL_WIDTH = 60


def _date(value: Any, with_time: bool) -> dt.datetime | dt.date | None:
    if not isinstance(value, str):
        return None
    text = value.strip().replace("Z", "+00:00")
    try:
        parsed = dt.datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.replace(tzinfo=None)  # Excel has no time zones
    return parsed if with_time else parsed.date()


def write_xlsx(result: ResultEnvelope, out: IO[bytes], sheet_name: str = "Result", pivot: "PivotLayout | None" = None) -> None:
    if pivot is not None:
        write_pivot(result, out, pivot, sheet_name)
        return
    workbook = xlsxwriter.Workbook(out, {"constant_memory": True, "strings_to_formulas": False, "strings_to_urls": False})
    sheet = workbook.add_worksheet(sheet_name[:31] or "Result")
    header = workbook.add_format({"bold": True, "bg_color": "#EEF0FB", "border": 0})
    date_fmt = workbook.add_format({"num_format": "yyyy-mm-dd"})
    datetime_fmt = workbook.add_format({"num_format": "yyyy-mm-dd hh:mm:ss"})

    widths = [min(MAX_COL_WIDTH, max(8, len(c.name) + 2)) for c in result.columns]
    for col, column in enumerate(result.columns):
        sheet.write_string(0, col, column.name, header)
    for r, row in enumerate(result.rows, start=1):
        for col, value in enumerate(row):
            if value is None:
                continue
            kind = result.columns[col].type
            if isinstance(value, bool):
                sheet.write_boolean(r, col, value)
            elif isinstance(value, (int, float)):
                sheet.write_number(r, col, value)
            elif kind in ("date", "datetime") and (parsed := _date(value, kind == "datetime")) is not None:
                if isinstance(parsed, dt.datetime):
                    sheet.write_datetime(r, col, parsed, datetime_fmt)
                else:
                    sheet.write_datetime(r, col, dt.datetime.combine(parsed, dt.time()), date_fmt)
            else:
                text = value if isinstance(value, str) else str(value)
                sheet.write_string(r, col, text)  # never a formula, whatever it starts with
                widths[col] = min(MAX_COL_WIDTH, max(widths[col], len(text) + 2))
    for col, width in enumerate(widths):
        sheet.set_column(col, col, width)
    sheet.freeze_panes(1, 0)
    if result.columns:
        sheet.autofilter(0, 0, max(1, len(result.rows)), len(result.columns) - 1)
    workbook.close()


def xlsx_stream(result: ResultEnvelope, pivot: "PivotLayout | None" = None) -> Iterator[bytes]:
    """Build the workbook in a temporary file (memory below 1 MB, spills to disk) and stream it."""
    with tempfile.SpooledTemporaryFile(max_size=1024 * 1024) as tmp:
        write_xlsx(result, tmp, pivot=pivot)
        tmp.seek(0)
        while chunk := tmp.read(CHUNK):
            yield chunk


# ---------------------------------------------------------------- pivot tables (M12)

PivotAgg = Literal["sum", "avg", "count", "min", "max"]
DateStyle = Literal["auto", "day", "week", "month", "quarter", "year", "datetime"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="ignore")


class PivotValue(_Strict):
    column: str = Field(min_length=1, max_length=200)
    agg: PivotAgg = "sum"
    label: str = Field(default="", max_length=300)
    format: dict[str, Any] = Field(default_factory=dict)  # the column format the screen uses (frontend ColumnFormat)


class PivotTexts(_Strict):
    total: str = Field(default="Total", max_length=60)
    empty: str = Field(default="(empty)", max_length=60)
    week: str = Field(default="Week of {date}", max_length=60)
    quarter: str = Field(default="Q{q} {year}", max_length=60)


class PivotLayout(_Strict):
    """What the frontend sends with the export of a result shown as a pivot (src/viz/pivot.ts PivotExport)."""

    rows: list[str] = Field(default_factory=list, max_length=10)
    columns: list[str] = Field(default_factory=list, max_length=10)
    values: list[PivotValue] = Field(min_length=1, max_length=20)
    totals: bool = True
    titles: dict[str, str] = Field(default_factory=dict, max_length=40)
    dates: dict[str, DateStyle] = Field(default_factory=dict, max_length=40)
    texts: PivotTexts = Field(default_factory=PivotTexts)
    lang: str = Field(default="en", max_length=10)


def pivot_layout(raw: str | None) -> PivotLayout | None:
    """The ?pivot= of an export (JSON), None without one; ValueError when it is not a layout."""
    if not raw:
        return None
    try:
        return PivotLayout.model_validate_json(raw)
    except ValueError:
        raise ValueError("The pivot table layout of the export is not valid") from None


_EMPTY = object()  # the key of an empty value


def _key(value: Any) -> Any:
    if value is None:
        return _EMPTY
    if isinstance(value, (dict, list)):
        return json.dumps(value, sort_keys=True)
    return value


def _number(value: Any) -> float | None:
    """A cell value as a number (like the frontend's toNumber: big numbers arrive as text)."""
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(value) else None
    if isinstance(value, str) and value.strip():
        try:
            number = float(value)
        except ValueError:
            return None
        return number if math.isfinite(number) else None
    return None


def _total(values: list[float], agg: str) -> float | None:
    if agg == "count":
        return float(len(values))
    if not values:
        return None
    if agg == "sum":
        return math.fsum(values)
    if agg == "avg":
        return math.fsum(values) / len(values)
    return min(values) if agg == "min" else max(values)


def _grouped(keys: dict[tuple, tuple]) -> list[tuple]:
    """Keys in the order of first appearance, level by level (rows of one line stay together)."""
    order = list(keys)
    if not order or len(order[0]) < 2:
        return order
    ranks: list[dict[Any, int]] = [{} for _ in order[0]]
    for k in order:
        for i, part in enumerate(k):
            ranks[i].setdefault(part, len(ranks[i]))
    return sorted(order, key=lambda k: tuple(ranks[i][part] for i, part in enumerate(k)))


class Pivot:
    """The pivot of the result rows: row keys, column keys and the totals of every cell."""

    def __init__(self, result: ResultEnvelope, layout: PivotLayout):
        names = [c.name for c in result.columns]
        index = {n: names.index(n) for n in dict.fromkeys(names)}  # the first column of a name, as on screen
        self.row_fields = [f for f in layout.rows if f in index]
        self.col_fields = [f for f in layout.columns if f in index]
        self.values = layout.values
        ri = [index[f] for f in self.row_fields]
        ci = [index[f] for f in self.col_fields]
        vi = [index.get(v.column, -1) for v in layout.values]
        row_keys: dict[tuple, tuple] = {}
        col_keys: dict[tuple, tuple] = {}
        self.raw: dict[Any, Any] = {}  # key part -> the first value seen (written to the sheet)
        buckets: dict[tuple, list[list[float]]] = {}
        for row in result.rows:
            rk = tuple(_key(row[i]) for i in ri)
            ck = tuple(_key(row[i]) for i in ci)
            for i, part in zip(ri + ci, rk + ck):
                self.raw.setdefault(part, row[i])
            row_keys.setdefault(rk, rk)
            col_keys.setdefault(ck, ck)
            for bucket in ((rk, ck), (rk, None), (None, ck), (None, None)):
                lists = buckets.setdefault(bucket, [[] for _ in layout.values])
                for k, (i, v) in enumerate(zip(vi, layout.values)):
                    if i < 0:
                        continue
                    n = 1.0 if v.agg == "count" else _number(row[i])
                    if n is not None:
                        lists[k].append(n)
        self.row_keys = _grouped(row_keys)
        self.col_keys = _grouped(col_keys)
        self._buckets = buckets

    def get(self, rk: tuple | None, ck: tuple | None, v: int) -> float | None:
        lists = self._buckets.get((rk, ck))
        return _total(lists[v], self.values[v].agg) if lists is not None else None


# Excel number formats for the frontend's ColumnFormat (src/viz/format.ts formatNumber)
_SYMBOLS = {"USD": ("$", True), "GBP": ("£", True), "EUR": ("€", False), "RUB": ("₽", False), "JPY": ("¥", True), "CNY": ("¥", True)}


def _literal(text: Any) -> str:
    clean = str(text or "").replace('"', "").replace("\\", "")
    return f'"{clean}"' if clean else ""


def number_format(fmt: dict[str, Any], integral: bool) -> str:
    style = fmt.get("style") or "auto"
    decimals = fmt.get("decimals")
    decimals = int(decimals) if isinstance(decimals, (int, float)) and 0 <= decimals <= 10 else None

    def digits(default: int) -> str:
        d = default if decimals is None else decimals
        return "." + "0" * d if d else ""

    if style == "percent":
        code = "0" + digits(1) + "%"
    elif style == "plain":
        code = "0" + digits(0 if integral else 2)
    elif style == "currency":
        code = "#,##0" + digits(2)
        currency = str(fmt.get("currency") or "USD").upper()[:3]
        symbol, before = _SYMBOLS.get(currency, (currency, False))
        code = f'{_literal(symbol)}{code}' if before else f'{code} {_literal(symbol)}'
    else:
        code = "#,##0" + digits(0 if integral else 2)
    return f"{_literal(fmt.get('prefix'))}{code}{_literal(fmt.get('suffix'))}"


def _date_format(style: str, lang: str, with_time: bool, week: str) -> str:
    day = "dd.mm.yyyy" if lang == "ru" else "d mmm yyyy"
    if style == "year":
        return "yyyy"
    if style == "month":
        return "mmm yyyy"
    if style == "week":
        before, _, after = week.partition("{date}")
        return f"{_literal(before)}{day}{_literal(after)}"
    if style == "datetime" or (style == "auto" and with_time):
        return f"{day} hh:mm"
    return day


def write_pivot(result: ResultEnvelope, out: IO[bytes], layout: PivotLayout, sheet_name: str = "Result") -> None:
    p = Pivot(result, layout)
    texts = layout.texts
    nv, nr, nc = len(p.values), len(p.row_fields), len(p.col_fields)
    left = max(1, nr)
    totals_col = layout.totals and nc > 0
    totals_row = layout.totals and nr > 0
    types = {c.name: c.type for c in result.columns}

    workbook = xlsxwriter.Workbook(out, {"strings_to_formulas": False, "strings_to_urls": False})
    sheet = workbook.add_worksheet(sheet_name[:31] or "Result")
    head = {"bold": True, "bg_color": "#EEF0FB", "valign": "top"}
    formats: dict[tuple, Any] = {}

    def style(**props: Any) -> Any:
        key = tuple(sorted(props.items()))
        if key not in formats:
            formats[key] = workbook.add_format(props)
        return formats[key]

    widths: dict[int, int] = {}

    def wide(col: int, text: str) -> None:
        widths[col] = min(MAX_COL_WIDTH, max(widths.get(col, 8), len(text) + 2))

    def title(r: int, c: int, text: str, span: int = 1, **props: Any) -> None:
        fmt = style(**head, **props)
        if span > 1:
            sheet.merge_range(r, c, r, c + span - 1, text, fmt)
        elif text:
            sheet.write_string(r, c, text, fmt)
            wide(c, text)
        else:
            sheet.write_blank(r, c, None, fmt)

    def key_cell(r: int, c: int, field: str, part: Any, span: int = 1, header: bool = False) -> None:
        """A value of a row or column field, keeping its type (dates are dates)."""
        props: dict[str, Any] = dict(head) if header else {"bold": True}
        value = None if part is _EMPTY else p.raw.get(part, part)
        kind = types.get(field)
        date_style = layout.dates.get(field)
        shown: Any = texts.empty if value is None else value
        number_fmt = None
        if value is not None and kind in ("date", "datetime") and (parsed := _date(value, True)) is not None:
            with_time = (parsed.hour, parsed.minute, parsed.second) != (0, 0, 0)
            style_name = date_style or ("datetime" if kind == "datetime" and with_time else "day")
            if style_name == "quarter":
                shown = texts.quarter.replace("{q}", str((parsed.month - 1) // 3 + 1)).replace("{year}", str(parsed.year))
            else:
                shown = parsed
                number_fmt = _date_format(style_name, layout.lang, with_time, texts.week)
        if number_fmt:
            props["num_format"] = number_fmt
        if header:
            props["align"] = "center" if span > 1 else "right"
        fmt = style(**props)
        if span > 1:
            sheet.merge_range(r, c, r, c + span - 1, "", fmt)
        if isinstance(shown, dt.datetime):
            sheet.write_datetime(r, c, shown, fmt)
            wide(c, "00 Mmm 0000 00:00" if "hh" in (number_fmt or "") else "00 Mmm 0000")
        elif isinstance(shown, bool):
            sheet.write_boolean(r, c, shown, fmt)
        elif isinstance(shown, (int, float)):
            sheet.write_number(r, c, shown, fmt)
            wide(c, str(shown))
        else:
            text = shown if isinstance(shown, str) else json.dumps(shown)
            sheet.write_string(r, c, text, fmt)  # never a formula
            if span == 1:
                wide(c, text)

    labels = [v.label or f"{v.agg} {v.column}" for v in p.values]

    def row_title(field: str) -> str:
        return layout.titles.get(field) or field

    col_keys, row_keys = p.col_keys, p.row_keys

    # ------------------------------------------------ header rows
    r = 0
    if nc == 0:
        for i, f in enumerate(p.row_fields):
            title(r, i, row_title(f))
        if nr == 0:
            title(r, 0, "")
        for k, label in enumerate(labels):
            title(r, left + k, label, align="right")
        r = 1
    else:
        width = len(col_keys) * nv
        title(0, 0, labels[0] if nv == 1 else "")
        for i in range(1, left):
            title(0, i, "")
        title(0, left, " · ".join(row_title(f) for f in p.col_fields), max(1, width))
        if totals_col:
            title(0, left + width, "", nv)
        for level, field in enumerate(p.col_fields):
            r = level + 1
            last = level == nc - 1
            if last and nv == 1:
                for i, f in enumerate(p.row_fields):
                    title(r, i, row_title(f))
                if nr == 0:
                    title(r, 0, "")
            else:
                for i in range(left):
                    title(r, i, "")
            c = 0
            while c < len(col_keys):
                end = c + 1
                while not last and end < len(col_keys) and col_keys[end][: level + 1] == col_keys[c][: level + 1]:
                    end += 1
                key_cell(r, left + c * nv, field, col_keys[c][level], (end - c) * nv, header=True)
                c = end
            if totals_col:
                title(r, left + width, texts.total if level == 0 else "", nv, align="right")
        r = nc + 1
        if nv > 1:
            for i, f in enumerate(p.row_fields):
                title(r, i, row_title(f))
            if nr == 0:
                title(r, 0, "")
            for c in range(len(col_keys)):
                for k, label in enumerate(labels):
                    title(r, left + c * nv + k, label, align="right")
            if totals_col:
                for k, label in enumerate(labels):
                    title(r, left + width + k, label, align="right")
            r += 1
    header_rows = r

    # ------------------------------------------------ numbers
    numbers: dict[int, Any] = {}
    bold_numbers: dict[int, Any] = {}

    def number_style(k: int, bold: bool) -> Any:
        cache = bold_numbers if bold else numbers
        if k not in cache:
            v = p.values[k]
            integral = v.agg == "count" or all(
                x is None or float(x).is_integer() for x in (p.get(rk, ck, k) for rk in row_keys[:200] for ck in col_keys[:50]))
            fmt = number_format({} if v.agg == "count" else v.format, integral)
            cache[k] = style(num_format=fmt, bold=bold)
        return cache[k]

    def put(r: int, c: int, value: float | None, k: int, bold: bool = False) -> None:
        if value is None:
            return
        v = p.values[k]
        if v.format.get("style") == "percent" and v.format.get("percentIsFraction") is False:
            value = value / 100  # the screen shows 12 as 12 %
        sheet.write_number(r, c, value, number_style(k, bold))

    for n, rk in enumerate(row_keys):
        prev = row_keys[n - 1] if n else None
        if nr:
            for i, field in enumerate(p.row_fields):
                if prev is not None and i < nr - 1 and rk[: i + 1] == prev[: i + 1]:
                    continue  # the outer label shows once per group
                key_cell(r, i, field, rk[i])
        else:
            sheet.write_string(r, 0, texts.total, style(bold=True))
            wide(0, texts.total)
        for c, ck in enumerate(col_keys):
            for k in range(nv):
                put(r, left + c * nv + k, p.get(rk, ck, k), k)
        if totals_col:
            for k in range(nv):
                put(r, left + len(col_keys) * nv + k, p.get(rk, None, k), k, bold=True)
        r += 1
    if totals_row:
        sheet.write_string(r, 0, texts.total, style(bold=True, top=1))
        for i in range(1, left):
            sheet.write_blank(r, i, None, style(bold=True, top=1))
        for c, ck in enumerate(col_keys):
            for k in range(nv):
                put(r, left + c * nv + k, p.get(None, ck, k), k, bold=True)
        if totals_col:
            for k in range(nv):
                put(r, left + len(col_keys) * nv + k, p.get(None, None, k), k, bold=True)

    for c in range(left + (len(col_keys) + (1 if totals_col else 0)) * nv):
        sheet.set_column(c, c, max(widths.get(c, 8), 12 if c >= left else 8))
    sheet.freeze_panes(header_rows, left)
    workbook.close()

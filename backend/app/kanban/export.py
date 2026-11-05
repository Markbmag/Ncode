"""Kanban K4: a board or My tasks as an Excel file, for the morning meeting or to keep."""

from __future__ import annotations

import io
from datetime import date, datetime
from typing import Any

import xlsxwriter

HEADERS = {
    "en": {"board": "Board", "stage": "Stage", "task": "Task", "who": "Who", "start": "Start", "due": "Due",
           "late": "Late", "priority": "Importance", "labels": "Labels", "steps": "Steps done", "repeats": "Repeats",
           "details": "Details", "finished": "Finished", "yes": "yes", "sheet": "Tasks"},
    "ru": {"board": "Доска", "stage": "Этап", "task": "Задача", "who": "Кто", "start": "Начало", "due": "Срок",
           "late": "Просрочена", "priority": "Важность", "labels": "Метки", "steps": "Шаги выполнены", "repeats": "Повтор",
           "details": "Подробности", "finished": "Выполнена", "yes": "да", "sheet": "Задачи"},
}
PRIORITY = {"en": {"low": "Low", "normal": "Normal", "high": "High", "urgent": "Urgent"},
            "ru": {"low": "Низкий", "normal": "Обычный", "high": "Высокий", "urgent": "Срочный"}}
REPEAT = {"en": {"daily": "Every day", "weekdays": "Every working day", "weekly": "Every week", "monthly": "Every month"},
          "ru": {"daily": "Каждый день", "weekdays": "Каждый рабочий день", "weekly": "Каждую неделю", "monthly": "Каждый месяц"}}


def _people(card: dict[str, Any], names: dict[int, str]) -> str:
    return ", ".join([names.get(u, "?") for u in card.get("assignees", [])] + list(card.get("assignee_names") or []))


def _workbook(rows: list[list[Any]], headers: list[str], widths: list[int], lang: str, late_col: int | None) -> bytes:
    out = io.BytesIO()
    wb = xlsxwriter.Workbook(out, {"in_memory": True})
    ws = wb.add_worksheet(HEADERS[lang]["sheet"])
    head = wb.add_format({"bold": True, "bg_color": "#E8EAF6", "border": 1, "text_wrap": True, "valign": "top"})
    text = wb.add_format({"text_wrap": True, "valign": "top"})
    day = wb.add_format({"num_format": "dd.mm.yyyy" if lang == "ru" else "d mmm yyyy", "valign": "top"})
    late = wb.add_format({"font_color": "#B91C1C", "bold": True, "valign": "top"})
    ws.write_row(0, 0, headers, head)
    for r, row in enumerate(rows, start=1):
        for c, value in enumerate(row):
            if isinstance(value, (date, datetime)):
                ws.write_datetime(r, c, datetime(value.year, value.month, value.day), day)
            elif late_col is not None and c == late_col and value:
                ws.write(r, c, value, late)
            elif value is None or value == "":
                ws.write_blank(r, c, None, text)
            else:
                ws.write(r, c, value, text)
    for c, w in enumerate(widths):
        ws.set_column(c, c, w)
    ws.freeze_panes(1, 0)
    ws.autofilter(0, 0, max(len(rows), 1), len(headers) - 1)
    wb.close()
    return out.getvalue()


def _d(value: str | None) -> date | None:
    try:
        return date.fromisoformat(value) if value else None
    except ValueError:
        return None


def board_xlsx(detail: dict[str, Any], lang: str, today: date) -> bytes:
    """The tasks on the board, stage by stage, in board order."""
    lang = lang if lang in HEADERS else "en"
    h = HEADERS[lang]
    names = {p["id"]: p["username"] for p in detail["people"]}
    labels = {lb["id"]: lb["name"] for lb in detail["labels"]}
    columns = sorted(detail["columns"], key=lambda c: (c["position"], c["id"]))
    done = {c["id"] for c in columns if c["is_done"]}
    rows: list[list[Any]] = []
    for col in columns:
        for card in sorted((c for c in detail["cards"] if c["column_id"] == col["id"]), key=lambda c: (c["position"], c["id"])):
            due = _d(card.get("due_date"))
            is_late = bool(due and due < today and col["id"] not in done and not card.get("completed_at"))
            steps = card["checklist"]
            rows.append([
                col["name"], card["title"], _people(card, names), _d(card.get("start_date")), due,
                h["yes"] if is_late else "", PRIORITY[lang].get(card["priority"], card["priority"]),
                ", ".join(labels.get(x, "") for x in card["labels"]), f"{steps['done']}/{steps['total']}" if steps["total"] else "",
                REPEAT[lang].get(card.get("repeat") or "", ""),
                datetime.fromtimestamp(card["completed_at"]).date() if card.get("completed_at") else None,
            ])
    headers = [h["stage"], h["task"], h["who"], h["start"], h["due"], h["late"], h["priority"], h["labels"], h["steps"], h["repeats"], h["finished"]]
    return _workbook(rows, headers, [18, 44, 26, 12, 12, 11, 12, 20, 12, 16, 12], lang, late_col=5)


def my_xlsx(my: dict[str, Any], lang: str, today: date) -> bytes:
    """My tasks on every board, the soonest first."""
    lang = lang if lang in HEADERS else "en"
    h = HEADERS[lang]
    names = {p["id"]: p["username"] for p in my["people"]}
    boards = {b["id"]: b for b in my["boards"]}
    rows: list[list[Any]] = []
    for card in sorted(my["cards"], key=lambda c: (c.get("due_date") or "9999", c["id"])):
        board = boards.get(card["board_id"], {"name": "", "columns": []})
        col = next((c for c in board["columns"] if c["id"] == card["column_id"]), None)
        due = _d(card.get("due_date"))
        finished = bool(card.get("completed_at")) or bool(col and col["is_done"])
        steps = card["checklist"]
        rows.append([
            board["name"], col["name"] if col else "", card["title"], _people(card, names), due,
            h["yes"] if due and due < today and not finished else "", PRIORITY[lang].get(card["priority"], card["priority"]),
            f"{steps['done']}/{steps['total']}" if steps["total"] else "",
            datetime.fromtimestamp(card["completed_at"]).date() if card.get("completed_at") else None,
        ])
    headers = [h["board"], h["stage"], h["task"], h["who"], h["due"], h["late"], h["priority"], h["steps"], h["finished"]]
    return _workbook(rows, headers, [22, 16, 44, 26, 12, 11, 12, 12, 12], lang, late_col=5)

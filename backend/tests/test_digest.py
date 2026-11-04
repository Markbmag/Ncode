"""Digests (M15, "Follow"): the biggest changes in sentences, chart images in emails."""

from datetime import date

import pytest

from app.automation import charts, digest
from app.automation.digest import Item, Period, compare, describe, periods, sentences
from app.automation.render import CardOut, Report, email_html, local_number
from app.results import ResultColumn, ResultEnvelope, ResultStats

from .test_automation_api import DAILY, FakeSMTP, env, html_of, send_now, setup_email, subscription, text_of  # noqa: F401
from .test_dashboards_api import card, new_dashboard, put
from .test_library_api import call, save_builder

WEEKLY = {"every": "week", "hour": 7, "minute": 0, "days": [0], "timezone": "Europe/Berlin"}
REVENUE_BY_REGION = {"connection": "shop", "source": {"table": "q_orders"}, "joins": [{"table": "q_customers"}],
                     "breakouts": [{"ref": "q_customers.region", "alias": "region"}],
                     "aggregations": [{"fn": "sum", "ref": "q_orders.total", "alias": "revenue"}]}
REVENUE_BY_STATUS = {"connection": "shop", "source": {"table": "q_orders"},
                     "breakouts": [{"ref": "q_orders.status", "alias": "status"}],
                     "aggregations": [{"fn": "sum", "ref": "q_orders.total", "alias": "revenue"}]}


def result(columns, rows):
    cols = [ResultColumn(name=n, type=t, role="measure" if t == "number" else "dimension") for n, t in columns]
    return ResultEnvelope(columns=cols, rows=rows, stats=ResultStats(duration_ms=0, row_count=len(rows)))


def scrap(rows):
    return result([("reason", "string"), ("pieces", "number")], rows)


def item(title="Scrap on Paint line", additive=True):
    return Item(title=title, url=None, run=None, measure="pieces", additive=lambda _n: additive)


def said(before, now, every="week", lang="en", **kw):
    mv = compare(item(**kw), before, now)
    assert mv is not None
    return describe(mv, every, lang)


# ---------------------------------------------------------------- the numbers and the sentences

def test_periods_are_the_latest_complete_day_and_week():
    assert periods("day", date(2026, 11, 4)) == (Period(date(2026, 11, 3), date(2026, 11, 3)), Period(date(2026, 11, 2), date(2026, 11, 2)))
    cur, prev = periods("week", date(2026, 11, 4))  # a Wednesday: last week is Mon 26 Oct - Sun 1 Nov
    assert cur == Period(date(2026, 10, 26), date(2026, 11, 1)) and prev == Period(date(2026, 10, 19), date(2026, 10, 25))


def test_a_rise_names_the_category_that_contributed_most():
    mv = said(scrap([["Paint drip", 100], ["Dent", 133]]), scrap([["Paint drip", 142], ["Dent", 133], ["Scratch", 0]]))
    assert mv.sentence == "Scrap on Paint line rose 18 % vs. the week before (233 → 275), mostly Paint drip (+42)."
    assert mv.score == pytest.approx(18.03, abs=0.01)


def test_a_fall_in_russian_with_russian_numbers():
    before = scrap([["Подтёк краски", 2500.5], ["Вмятина", 1000]])
    now = scrap([["Подтёк краски", 1200.25], ["Вмятина", 1100]])
    mv = said(before, now, every="day", lang="ru", title="Брак на линии окраски")
    assert mv.sentence == ("Брак на линии окраски: снижение на 34 % к предыдущему дню (3 500,5 → 2 300,25), "
                           "больше всего — Подтёк краски (−1 300,25).")


def test_small_changes_are_no_big_changes():
    mv = said(scrap([["Dent", 100]]), scrap([["Dent", 103]]))
    assert mv.sentence is None and mv.score == pytest.approx(3.0)
    week = Period(date(2026, 10, 26), date(2026, 11, 1))
    assert sentences([mv], "week", week, "en", comparable=1, failed=0) == [
        "Changes in the week 26 Oct – 1 Nov 2026 compared with the week before.",
        "No big changes: nothing moved more than 5 %.",
        "About the same: Scrap on Paint line (103).",
    ]
    assert sentences([mv], "day", Period(date(2026, 11, 3), date(2026, 11, 3)), "ru", comparable=1, failed=1) == [
        "Изменения за 3 ноября 2026 по сравнению с предыдущим днём.",
        "Больших изменений нет: ничего не изменилось больше чем на 5 %.",
        "Почти без изменений: Scrap on Paint line (103).",
        "Не удалось прочитать карточек: 1 (подробности в истории отправок).",
    ]


def test_from_zero_and_nothing_to_compare():
    mv = said(scrap([]), scrap([["Dent", 7]]))
    assert mv.sentence == "Scrap on Paint line rose from 0 to 7 vs. the week before."
    assert sentences([], "day", Period(date(2026, 11, 3), date(2026, 11, 3)), "en", comparable=0, failed=0)[1] == \
        "Nothing to compare: Ncode found no date to compare the periods by."


def test_rates_are_not_added_up_the_line_that_moved_most_is_named():
    rate = lambda rows: result([("line", "string"), ("rate", "number")], rows)  # noqa: E731
    mv = compare(Item(title="Scrap rate", url=None, run=None, measure="rate", fmt={"style": "percent", "decimals": 1}),
                 rate([["Paint", 0.021], ["Body", 0.05]]), rate([["Paint", 0.034], ["Body", 0.051]]))
    mv = describe(mv, "week", "en")
    assert mv.current is None and mv.sentence == "Scrap rate: the biggest change is Paint, 2.1 % → 3.4 % (+62 %)."
    assert describe(compare(Item(title="Доля брака", url=None, run=None, measure="rate", fmt={"style": "percent", "decimals": 1}),
                            rate([["Покраска", 0.021]]), rate([["Покраска", 0.034]])), "day", "ru").sentence == \
        "Доля брака: самое большое изменение — Покраска, 2,1 % → 3,4 % (+62 %)."


def test_at_most_four_changes_biggest_first():
    movements = [said(scrap([["a", 100]]), scrap([["a", 100 + 10 * i]]), title=f"Card {i}") for i in range(1, 7)]
    out = sentences(movements, "week", Period(date(2026, 10, 26), date(2026, 11, 1)), "en", comparable=6, failed=0)
    assert len(out) == 6 and out[1].startswith("Card 6 rose 60 %") and out[4].startswith("Card 3 rose 30 %")
    assert out[5] == "And 2 smaller changes: see the dashboard."


def test_local_numbers():
    assert local_number("1,234,567.89 EUR", "ru") == "1 234 567,89 EUR"
    assert local_number("1,234.5", "en") == "1,234.5"


# ---------------------------------------------------------------- following a dashboard: the email

@pytest.fixture()
def week_of_jan_5(monkeypatch):
    """Today is Monday 12 Jan 2026: last week (5-11 Jan, orders 1 and 2) vs. the week before (order 7)."""
    monkeypatch.setattr(digest, "today_in", lambda _tz: date(2026, 1, 12))


def follow_dashboard(env, who="alice"):
    by_region = save_builder(env, who, spec=REVENUE_BY_REGION, name="Revenue by region")
    weekly = save_builder(env, who, name="Revenue per week", spec={
        "connection": "shop", "source": {"table": "q_orders"},
        "breakouts": [{"ref": "q_orders.created_at", "bucket": "week", "alias": "week"}],
        "aggregations": [{"fn": "sum", "ref": "q_orders.total", "alias": "revenue"}]})
    listing = save_builder(env, who, name="All orders", spec={"connection": "shop", "source": {"table": "q_orders"},
                                                              "fields": [{"ref": "q_orders.id"}]})
    d = new_dashboard(env, who, "Sales")
    put(env, who, d["id"], {
        "filters": [{"id": "period", "label": "Period", "type": "date_range"}],
        "cards": [
            card("s", by_region["id"], mappings={"period": {"field": "q_orders.created_at"}},
                 viz={"mode": "chart", "spec": {"version": 1, "type": "bar", "x": "region", "series": [{"y": "revenue"}]}}),
            card("w", weekly["id"], x=6, viz={"mode": "chart", "spec": {"version": 1, "type": "line", "x": "week", "series": [{"y": "revenue"}]}}),
            card("l", listing["id"], y=4),
        ],
    })
    sub = subscription(env, who, "dashboard", d["id"], schedule=WEEKLY, recipients={"users": [who]}, options={"digest": "week"})
    return d, sub


def test_a_weekly_digest_of_a_dashboard_by_email_with_chart_images(env, week_of_jan_5):
    setup_email(env)
    call(env, "admin", "PUT", "/api/admin/settings/general", json={"site_url": "https://ncode.example.com"})
    d, sub = follow_dashboard(env)
    assert sub["options"]["digest"] == "week" and sub["target_type"] == "dashboard"
    # the Subscriptions page lists it like any other subscription
    assert [s["options"]["digest"] for s in call(env, "alice", "GET", "/api/subscriptions")["subscriptions"]] == ["week"]
    run = send_now(env, "alice", sub["id"])
    assert run["status"] == "sent", run
    assert [c["title"] for c in run["detail"]["cards"]] == ["Revenue by region", "Revenue per week", "All orders"]
    msg = FakeSMTP.sent[0]
    assert msg["Subject"] == "Sales: weekly digest" and msg["To"] == "alice@example.com"
    text = text_of(msg)
    assert "Changes in the week 5 Jan – 11 Jan 2026 compared with the week before." in text
    assert "Revenue by region rose 1,400 % vs. the week before (10 → 150), mostly EU (+150)." in text
    assert "Revenue per week rose 1,400 % vs. the week before (10 → 150)." in text
    assert "All orders" not in text  # a list of rows has no number to compare
    html = html_of(msg)
    assert "https://ncode.example.com/dashboards/" in html and "https://ncode.example.com/subscriptions" in html
    # chart images: inline PNGs, linked from the HTML by their Content-ID
    images = [p for p in msg.walk() if p.get_content_type() == "image/png"]
    assert images and len(images) <= 3
    related = next(p for p in msg.walk() if p.get_content_type() == "multipart/related")
    assert related.get_body(("html",)) is not None
    for img in images:
        cid = img["Content-ID"].strip("<>")
        assert f'src="cid:{cid}"' in html
        assert img.get_content()[:8] == b"\x89PNG\r\n\x1a\n"
    assert not list(msg.iter_attachments())  # pictures are not attachments


def test_the_digest_follows_the_persons_language(env, week_of_jan_5):
    setup_email(env)
    call(env, "alice", "PUT", "/api/account/prefs", json={"language": "ru"})
    _d, sub = follow_dashboard(env)
    assert send_now(env, "alice", sub["id"])["status"] == "sent"
    msg = FakeSMTP.sent[0]
    assert msg["Subject"] == "Sales: сводка за неделю"
    text = text_of(msg)
    assert "Изменения за неделю 5 января – 11 января 2026 по сравнению с предыдущей неделей." in text
    assert "Revenue by region: рост на 1\u00a0400 % к предыдущей неделе (10 → 150), больше всего — EU (+150)." in text
    assert "Открыть в Ncode" not in html_of(msg)  # no site address set: no button
    assert "Отключить можно в Ncode в разделе «Подписки»." in text


def test_the_email_language_setting_is_the_default(env, week_of_jan_5, monkeypatch):
    setup_email(env)
    _d, sub = follow_dashboard(env)
    engine = env["app"].state.scheduler.engine
    assert engine.email_language == "en"
    monkeypatch.setattr(engine, "email_language", "ru")  # NCODE_EMAIL_LANGUAGE=ru; alice stored no language
    assert send_now(env, "alice", sub["id"])["status"] == "sent"
    assert FakeSMTP.sent[0]["Subject"] == "Sales: сводка за неделю"
    from app.config import load_settings  # noqa: PLC0415
    assert load_settings({"NCODE_EMAIL_LANGUAGE": "ru"}).email_language == "ru"


def test_without_pillow_the_email_keeps_its_html_bars(env, week_of_jan_5, monkeypatch):
    setup_email(env)
    monkeypatch.setattr(charts, "Image", None)
    _d, sub = follow_dashboard(env)
    assert send_now(env, "alice", sub["id"])["status"] == "sent"
    msg = FakeSMTP.sent[0]
    assert not [p for p in msg.walk() if p.get_content_type() == "image/png"]
    html = html_of(msg)
    assert "cid:" not in html, html
    assert "font-size:32px;font-weight:700" in html and "150" in html  # the number as HTML text


def test_no_big_changes(env, monkeypatch):
    setup_email(env)
    monkeypatch.setattr(digest, "today_in", lambda _tz: date(2026, 3, 9))  # weeks of 23 Feb and 2 Mar: no orders
    _d, sub = follow_dashboard(env)
    assert send_now(env, "alice", sub["id"])["status"] == "sent"
    text = text_of(FakeSMTP.sent[0])
    assert "No big changes: nothing moved more than 5 %." in text


def test_preview_shows_the_pictures_as_data_links_and_unfollow_removes_it(env, week_of_jan_5):
    d, sub = follow_dashboard(env)
    out = call(env, "alice", "POST", "/api/subscriptions/preview",
               json={"target_type": "dashboard", "target_id": d["id"], "schedule": WEEKLY, "options": {"digest": "week"}})
    assert out["summary"][1].startswith("Revenue by region rose 1,400 %")
    assert 'src="data:image/png;base64,' in out["html"] and "cid:" not in out["html"]
    assert FakeSMTP.sent == []
    call(env, "alice", "DELETE", f"/api/subscriptions/{sub['id']}")  # Unfollow
    assert call(env, "alice", "GET", "/api/subscriptions")["subscriptions"] == []


def test_a_subscription_gets_chart_images_too(env):
    setup_email(env)
    by_status = save_builder(env, "alice", spec=REVENUE_BY_STATUS, name="Revenue by status")
    sub = subscription(env, "alice", "question", by_status["id"])
    assert send_now(env, "alice", sub["id"])["status"] == "sent"
    msg = FakeSMTP.sent[0]
    images = [p for p in msg.walk() if p.get_content_type() == "image/png"]
    assert len(images) == 1 and f'cid:{images[0]["Content-ID"].strip("<>")}' in html_of(msg)
    assert "paid" in text_of(msg)  # the text part keeps the numbers


def test_follow_rules(env):
    q = save_builder(env, "alice", spec=REVENUE_BY_STATUS)
    subscription(env, "alice", "question", q["id"], 400, options={"digest": "day"},
                 alert={"type": "rows"})
    subscription(env, "alice", "metric", 1, 400)  # a metric can only be followed


# ---------------------------------------------------------------- chart images

def test_charts_draw_bar_line_and_number_with_cyrillic():
    assert charts.available() and charts.font_path() is not None
    for chart in (
        charts.ChartData(kind="bar", labels=["Покраска", "Сварка"], values=[42.0, 7.0], texts=["42", "7"]),
        charts.ChartData(kind="line", labels=["Пн", "Вт", "Ср"], values=[1.0, None, 3.5], texts=["1", "—", "3,5"]),
        charts.ChartData(kind="number", number="1 234,5", note="▲ 18 % к предыдущему"),
    ):
        png = charts.draw(chart, "ru")
        assert png is not None and png[:4] == b"\x89PNG"
    table = CardOut(title="T", result=result([("a", "string"), ("b", "string")], [["x", "y"]]), viz={"mode": "table"})
    assert charts.chart_of(table, 10) is None  # a table stays a table
    report = Report(title="R", cards=[table])
    assert charts.pictures(report) == {} and "<img" not in email_html(report)


def test_following_a_metric(env, week_of_jan_5):
    setup_email(env)
    metric = call(env, "admin", "POST", "/api/metrics", json={
        "name": "Revenue", "connection": "shop", "table": "q_orders", "definition": {"fn": "sum", "ref": "total"},
        "format": {"style": "currency", "currency": "USD"}, "translations": {"ru": {"name": "Выручка"}}})
    subscription(env, "bob", "metric", metric["id"], 404, recipients={"users": ["bob"]}, options={"digest": "week"})  # no access
    sub = subscription(env, "alice", "metric", metric["id"], schedule=WEEKLY, options={"digest": "week"})
    assert sub["target_name"] == "Revenue"
    listed = call(env, "alice", "GET", "/api/subscriptions", params={"target_type": "metric", "target_id": metric["id"]})
    assert [s["id"] for s in listed["subscriptions"]] == [sub["id"]]
    assert send_now(env, "alice", sub["id"])["status"] == "sent"
    msg = FakeSMTP.sent[0]
    assert msg["Subject"] == "Revenue: weekly digest"
    # no date column marked in the data model: the table's first date-time column (created_at)
    assert "Revenue rose 1,400 % vs. the week before (10.00 USD → 150.00 USD)." in text_of(msg)
    call(env, "alice", "PUT", "/api/account/prefs", json={"language": "ru"})
    assert send_now(env, "alice", sub["id"])["status"] == "sent"
    assert "Выручка: рост на 1 400 % к предыдущей неделе (10,00 USD → 150,00 USD)." in text_of(FakeSMTP.sent[-1])

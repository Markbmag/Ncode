"""Load test (M10): N people open the same 6-card dashboard at once, cached and uncached.

Against the throw-away test backend only (it creates users, questions and a dashboard):

    python -m tests.e2e_server --port 8766 &
    python -m tests.load_dashboard 50

Prints the time each person waits for the whole dashboard (median / 95th percentile / max),
retries after "too many queries" answers, errors, and the backend's memory (Linux only).
"""
import statistics, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor
import httpx

API = "http://127.0.0.1:8766"
N = int(sys.argv[1]) if len(sys.argv) > 1 else 50

def login(c, u, p):
    r = c.post(f"{API}/api/auth/login", json={"username": u, "password": p}); r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}

def rss():
    """Resident memory of the test backend in MB ("?" where /proc and pgrep don't exist)."""
    try:
        for pid in subprocess.check_output(["pgrep", "-f", "tests.e2e_server --port 8766"]).split():
            pid = pid.decode()
            if open(f"/proc/{pid}/comm").read().startswith("python"):
                return int(open(f"/proc/{pid}/status").read().split("VmRSS:")[1].split()[0]) // 1024
    except (OSError, subprocess.CalledProcessError):
        pass
    return "?"

c = httpx.Client(timeout=60)
adm = login(c, "admin", "admin-pass-1")
def call(h, m, p, **kw):
    r = c.request(m, f"{API}{p}", headers=h, **kw); assert r.status_code < 300, (p, r.status_code, r.text); return r.json()

col = call(adm, "POST", "/api/collections", json={"name": "Load"})
call(adm, "PUT", f"/api/collections/{col['id']}/permissions", json={"grants": [{"role": "all", "level": "view"}]})
specs = [
    {"connection": "shop", "source": {"table": "q_orders"}, "aggregations": [{"fn": "count", "alias": "n"}]},
    {"connection": "shop", "source": {"table": "q_orders"}, "aggregations": [{"fn": "sum", "ref": "total", "alias": "s"}], "breakouts": [{"ref": "status"}]},
    {"connection": "shop", "source": {"table": "q_orders"}, "joins": [{"table": "q_customers"}], "aggregations": [{"fn": "sum", "ref": "q_orders.total", "alias": "r"}], "breakouts": [{"ref": "q_customers.region"}]},
    {"connection": "shop", "source": {"table": "q_orders"}, "aggregations": [{"fn": "avg", "ref": "qty", "alias": "a"}], "breakouts": [{"ref": "created_at", "bucket": "month"}]},
    {"connection": "shop", "source": {"table": "q_customers"}},
    {"connection": "shop", "source": {"table": "q_products"}},
]
qids = [call(adm, "POST", "/api/questions", json={"name": f"Q{i}", "kind": "builder", "spec": {"version": 1, **s}, "collection_id": col["id"]})["id"] for i, s in enumerate(specs)]
d = call(adm, "POST", "/api/dashboards", json={"name": "Load", "collection_id": col["id"]})
cards = [{"key": f"c{i}", "kind": "question", "question_id": q, "layout": {"x": (i % 2) * 6, "y": (i // 2) * 4, "w": 6, "h": 4}} for i, q in enumerate(qids)]
call(adm, "PUT", f"/api/dashboards/{d['id']}", json={"cards": cards, "filters": []})
print("RSS after setup", rss())
for i in range(N):
    r = c.post(f"{API}/api/admin/users", headers=adm, json={"username": f"user{i}", "password": "load-pass-123", "role": "user", "connections": ["shop"]})
    assert r.status_code < 300, r.text

print("RSS after creating users", rss())
with ThreadPoolExecutor(N) as p:
    list(p.map(lambda i: login(httpx.Client(timeout=60), f"user{i}", "load-pass-123"), range(N)))
print("RSS after 50 parallel sign-ins", rss())

def open_dashboard(i, refresh):
    cl = httpx.Client(timeout=60)
    h = login(cl, f"user{i}", "load-pass-123")
    t0 = time.perf_counter(); retries = 0; errors = 0
    cl.get(f"{API}/api/dashboards/{d['id']}", headers=h).raise_for_status()
    def card(key):
        nonlocal retries, errors
        while True:
            r = cl.post(f"{API}/api/dashboards/{d['id']}/cards/{key}/run", headers=h, json={"filters": {}, "wait_ms": 2000, "refresh": refresh})
            if r.status_code == 429:
                retries += 1; time.sleep(0.3); continue
            if r.status_code != 200: errors += 1; return
            data = r.json()
            while data["status"] == "running":
                time.sleep(0.1); data = cl.get(f"{API}/api/query/tasks/{data['task_id']}", headers=h).json()
            if data["status"] != "completed": errors += 1
            return
    with ThreadPoolExecutor(3) as p:  # the browser queues cards below the per-user limit
        list(p.map(card, [x["key"] for x in cards]))
    return time.perf_counter() - t0, retries, errors

for refresh in (False, True, False):
    start = time.perf_counter()
    with ThreadPoolExecutor(N) as p:
        res = list(p.map(lambda i: open_dashboard(i, refresh), range(N)))
    times = sorted(r[0] for r in res)
    print(f"{'uncached' if refresh else 'cached  '}: {N} users, wall {time.perf_counter()-start:.1f}s, p50 {statistics.median(times):.2f}s, "
          f"p95 {times[int(len(times)*0.95)-1]:.2f}s, max {times[-1]:.2f}s, 429-retries {sum(r[1] for r in res)}, errors {sum(r[2] for r in res)}, RSS {rss()} MB")

import time


def login(client, username, password):
    return client.post("/api/auth/login", json={"username": username, "password": password})


def auth(client, username, password):
    token = login(client, username, password).json()["token"]
    return {"Authorization": f"Bearer {token}"}


def wait_finished(client, headers, task_id, timeout=10):
    deadline = time.time() + timeout
    while time.time() < deadline:
        data = client.get(f"/api/search/{task_id}", headers=headers).json()
        if data["status"] in ("completed", "cancelled", "error"):
            return data
        time.sleep(0.05)
    raise AssertionError("search did not finish")

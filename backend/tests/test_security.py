import time

from app.security import LoginThrottle, hash_password, hash_token, new_token, verify_password


def test_password_hash_roundtrip():
    stored = hash_password("correct horse")
    assert stored != "correct horse" and "correct horse" not in stored
    assert verify_password("correct horse", stored)
    assert not verify_password("wrong", stored)
    assert hash_password("correct horse") != stored  # random salt


def test_malformed_hashes_never_raise():
    assert not verify_password("x", "garbage")
    assert not verify_password("x", "scrypt$1$2")
    assert not verify_password("x", "")


def test_tokens_are_random_and_stored_hashed():
    a, b = new_token(), new_token()
    assert a != b and len(a) >= 40
    assert hash_token(a) != a and len(hash_token(a)) == 64


def test_throttle_locks_and_recovers():
    th = LoginThrottle(max_failures=3, lock_sec=1)
    for _ in range(3):
        assert th.locked_for("k") == 0
        th.fail("k")
    assert th.locked_for("k") > 0
    assert th.locked_for("other") == 0
    time.sleep(1.1)
    assert th.locked_for("k") == 0
    th.fail("k"); th.success("k")
    assert th.locked_for("k") == 0

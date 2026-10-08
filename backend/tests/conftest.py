import sqlite3

import pytest


@pytest.fixture()
def sample_db(tmp_path):
    """Path of a small throw-away SQLite database to search in."""
    db_file = tmp_path / "test.db"
    con = sqlite3.connect(db_file)
    con.executescript(
        """
        CREATE TABLE vehicles (id INTEGER PRIMARY KEY, vin TEXT, model TEXT, mileage INTEGER, built DATE, photo BLOB);
        INSERT INTO vehicles VALUES (1, 'LSVAA12345X000001', 'Passat', 120345, '2024-05-17', x'00ff');
        INSERT INTO vehicles VALUES (2, 'LSVAA12345X000002', 'Golf', 9000, '2023-01-02', NULL);
        CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT);
        INSERT INTO notes VALUES (1, '100% done');
        INSERT INTO notes VALUES (2, '100 items');
        INSERT INTO notes VALUES (3, 'Passat service');
        CREATE TABLE empty_numbers (a INTEGER, b REAL);
        CREATE TABLE log_2024 (id INTEGER, msg TEXT);
        INSERT INTO log_2024 VALUES (1, 'passat passat');
        """
    )
    con.commit()
    con.close()
    return db_file

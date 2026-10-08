"""Local settings and bounded response cache. No provider credentials."""
import json
import os
from pathlib import Path
import sqlite3
import threading

if __package__:
    from .redaction import redact
else:
    from redaction import redact


class LocalStore:
    def __init__(self, filename: Path | None = None):
        if filename:
            filename.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.connection = sqlite3.connect(str(filename) if filename else ":memory:", check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        self.history_revision = 0
        with self.connection:
            self.connection.execute("CREATE TABLE IF NOT EXISTS state (name TEXT PRIMARY KEY, value TEXT NOT NULL)")
            self.connection.execute("CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY, mode TEXT NOT NULL, input TEXT NOT NULL, answer TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)")
        if filename:
            os.chmod(filename, 0o600)

    def get(self, name, fallback):
        with self.lock:
            row = self.connection.execute("SELECT value FROM state WHERE name = ?", (name,)).fetchone()
            return json.loads(row["value"]) if row else fallback

    def put(self, name, value):
        with self.lock, self.connection:
            self.connection.execute("INSERT INTO state(name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value=excluded.value", (name, json.dumps(value)))
        return value

    def add_history(self, mode, source, answer, status, revision=None):
        with self.lock, self.connection:
            if revision is not None and revision != self.history_revision:
                return
            self.connection.execute("INSERT INTO history(mode, input, answer, status) VALUES (?, ?, ?, ?)",
                (mode, redact(source)[:16384], redact(answer)[:262144], status))
            self.connection.execute("DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT 50)")

    def history(self):
        with self.lock:
            return [dict(row) for row in self.connection.execute("SELECT * FROM history ORDER BY id DESC LIMIT 50")]

    def clear_history(self):
        with self.lock, self.connection:
            self.connection.execute("DELETE FROM history")
            self.history_revision += 1

    def close(self):
        with self.lock:
            self.connection.close()

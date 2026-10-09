import os
import stat

from backend import storage


def test_new_database_is_private_before_sqlite_opens_it(tmp_path, monkeypatch):
    directory = tmp_path / "existing-data"
    directory.mkdir(mode=0o755)
    filename = directory / "icarus.sqlite"
    observed = []
    real_connect = storage.sqlite3.connect

    def connect(*args, **kwargs):
        observed.append(stat.S_IMODE(filename.stat().st_mode) if filename.exists() else None)
        return real_connect(*args, **kwargs)

    monkeypatch.setattr(storage.sqlite3, "connect", connect)
    previous_umask = os.umask(0o022)
    try:
        saved = storage.LocalStore(filename)
        saved.close()
    finally:
        os.umask(previous_umask)

    assert observed == [0o600]
    assert stat.S_IMODE(filename.stat().st_mode) == 0o600


def test_existing_database_is_private_before_open_and_keeps_saved_data(tmp_path, monkeypatch):
    filename = tmp_path / "icarus.sqlite"
    memory = {"project": "Fixture", "notes": "Keep these notes."}
    saved = storage.LocalStore(filename)
    saved.put("memory", memory)
    saved.close()
    filename.chmod(0o644)
    observed = []
    real_connect = storage.sqlite3.connect

    def connect(*args, **kwargs):
        observed.append(stat.S_IMODE(filename.stat().st_mode))
        return real_connect(*args, **kwargs)

    monkeypatch.setattr(storage.sqlite3, "connect", connect)
    saved = storage.LocalStore(filename)
    try:
        assert saved.get("memory", {}) == memory
    finally:
        saved.close()

    assert observed == [0o600]
    assert stat.S_IMODE(filename.stat().st_mode) == 0o600

import importlib.util
import json
import os
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "auto-login" / "auto_login.py"
FORBIDDEN_KEYS = {"lastRefresh", "lastSeenAt", "usageCount", "rateLimitHistory"}
EMAIL = "user@example.com"
ACCOUNT_ID = "acct_test_123"


def load_helper_module():
    spec = importlib.util.spec_from_file_location("auto_login_helper", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def configure_temp_home(monkeypatch, home_dir):
    monkeypatch.setenv("HOME", str(home_dir))
    monkeypatch.setenv("USERPROFILE", str(home_dir))
    monkeypatch.setenv("HOMEDRIVE", "")
    monkeypatch.setenv("HOMEPATH", str(home_dir))


def fake_decode_jwt_payload(token):
    if token in {"access-token", "id-token"}:
        return {
            "exp": 1893456000,
            "email": EMAIL,
            "https://api.openai.com/auth": {"chatgpt_account_id": ACCOUNT_ID},
        }
    return None


def configure_helper(module, tmp_path):
    module.STORE_DIR = tmp_path / ".config" / "opencode"
    module.STORE_FILE = module.STORE_DIR / "opencode-multi-auth-codex-accounts.json"
    module.decode_jwt_payload = fake_decode_jwt_payload
    module.fetch_userinfo_email = lambda _access_token: None
    return module


def read_accounts(module):
    with open(module.STORE_FILE, "r", encoding="utf-8") as handle:
        return json.load(handle)["accounts"]


def assert_no_metrics(accounts):
    for account in accounts:
        for key in FORBIDDEN_KEYS:
            assert key not in account, f"unexpected metrics key {key!r} in {account!r}"


def exercise_new_account(tmp_path, monkeypatch):
    configure_temp_home(monkeypatch, tmp_path / "home")
    module = configure_helper(load_helper_module(), tmp_path)

    module.add_account_to_store(
        {
            "access_token": "access-token",
            "refresh_token": "refresh-token",
            "id_token": "id-token",
            "expires_in": 3600,
        }
    )

    assert module.STORE_FILE.exists()
    assert_no_metrics(read_accounts(module))


def exercise_overwrite_account(tmp_path, monkeypatch):
    configure_temp_home(monkeypatch, tmp_path / "home")
    module = configure_helper(load_helper_module(), tmp_path)

    module.add_account_to_store(
        {
            "access_token": "access-token",
            "refresh_token": "refresh-token",
            "id_token": "id-token",
            "expires_in": 3600,
        }
    )
    module.add_account_to_store(
        {
            "access_token": "access-token",
            "refresh_token": "refresh-token-2",
            "id_token": "id-token",
            "expires_in": 3600,
        }
    )

    assert_no_metrics(read_accounts(module))


def test_new_account_does_not_persist_metrics(tmp_path, monkeypatch):
    exercise_new_account(tmp_path, monkeypatch)


def test_overwrite_account_does_not_persist_metrics(tmp_path, monkeypatch):
    exercise_overwrite_account(tmp_path, monkeypatch)


class _MiniMonkeyPatch:
    def __init__(self):
        self._env = []
        self._attrs = []

    def setenv(self, key, value):
        self._env.append((key, os.environ.get(key)))
        os.environ[key] = value

    def setattr(self, obj, name, value):
        self._attrs.append((obj, name, getattr(obj, name)))
        setattr(obj, name, value)

    def undo(self):
        for obj, name, value in reversed(self._attrs):
            setattr(obj, name, value)
        for key, value in reversed(self._env):
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def _run_without_pytest():
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        monkeypatch = _MiniMonkeyPatch()
        try:
            exercise_new_account(tmp_path, monkeypatch)
            exercise_overwrite_account(tmp_path / "overwrite", monkeypatch)
        finally:
            monkeypatch.undo()


if __name__ == "__main__":
    _run_without_pytest()
    print("ok")

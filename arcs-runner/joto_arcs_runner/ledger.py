import json
import os
import threading
from pathlib import Path
from typing import Any


class PublishLedger:
    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.Lock()

    def _read(self) -> dict[str, Any]:
        if not self.path.exists():
            return {}
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
            return value if isinstance(value, dict) else {}
        except (OSError, json.JSONDecodeError):
            return {}

    def _write(self, value: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(f"{self.path.suffix}.tmp")
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary, self.path)

    def get(self, key: str) -> dict[str, Any] | None:
        with self._lock:
            return self._read().get(key)

    def begin(self, key: str, metadata: dict[str, Any]) -> tuple[bool, dict[str, Any]]:
        with self._lock:
            ledger = self._read()
            if key in ledger:
                return False, ledger[key]
            record = {**metadata, "status": "publishing"}
            ledger[key] = record
            self._write(ledger)
            return True, record

    def complete(self, key: str, result: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            ledger = self._read()
            record = {**ledger.get(key, {}), "status": result.get("status", "failed"), "result": result}
            ledger[key] = record
            self._write(ledger)
            return record

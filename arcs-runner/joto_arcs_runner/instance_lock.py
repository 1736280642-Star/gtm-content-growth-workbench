from __future__ import annotations

import os
from pathlib import Path
from typing import BinaryIO


class RunnerInstanceLock:
    """Keep exactly one runner process for a ledger/port pair."""

    def __init__(self, path: Path):
        self.path = path
        self._file: BinaryIO | None = None

    def acquire(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        file = self.path.open("a+b")
        try:
            file.seek(0, os.SEEK_END)
            if file.tell() == 0:
                file.write(b"0")
                file.flush()
            file.seek(0)
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (OSError, IOError) as error:
            file.close()
            raise RuntimeError("another JOTO Arcs runner already owns this ledger and port") from error
        self._file = file

    def release(self) -> None:
        file = self._file
        if file is None:
            return
        try:
            file.seek(0)
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(file.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(file.fileno(), fcntl.LOCK_UN)
        finally:
            file.close()
            self._file = None

    def __enter__(self) -> "RunnerInstanceLock":
        self.acquire()
        return self

    def __exit__(self, _exc_type, _exc, _traceback) -> None:
        self.release()

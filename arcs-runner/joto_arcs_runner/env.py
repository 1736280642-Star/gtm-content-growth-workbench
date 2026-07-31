import os
from pathlib import Path


def load_project_env(project_root: Path | None = None) -> Path | None:
    """Load the repository .env.local without overriding explicit process env."""
    root = project_root or Path(__file__).resolve().parents[2]
    env_path = root / ".env.local"
    if not env_path.is_file():
        return None

    for raw_line in env_path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key or key in os.environ:
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        os.environ[key] = value

    return env_path

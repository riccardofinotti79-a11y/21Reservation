"""Load REACT_APP_BACKEND_URL from frontend/.env before tests run."""
import os
from pathlib import Path


def _load_frontend_env():
    if os.environ.get("REACT_APP_BACKEND_URL"):
        return
    env_file = Path(__file__).resolve().parents[2] / "frontend" / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


_load_frontend_env()

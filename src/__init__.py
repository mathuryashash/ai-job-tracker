"""AI Resume & Job Tracker backend package."""
import os as _os
import sys as _sys


def _load_dotenv() -> None:
    """Load the project-root .env into os.environ (never overriding values
    already set in the real environment), so native runs pick up the same
    settings docker-compose injects. Runs once, before src.config is imported.
    Skipped under pytest so tests stay hermetic."""
    if "pytest" in _sys.modules:
        return
    try:
        from dotenv import load_dotenv
    except ImportError:  # optional dependency
        return
    root = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))
    load_dotenv(_os.path.join(root, ".env"), override=False)


_load_dotenv()

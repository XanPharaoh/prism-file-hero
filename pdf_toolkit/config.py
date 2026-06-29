"""JSON-backed user configuration for Prism Document Suite."""

import json
import os
from pathlib import Path

from constants import CONFIG_DIR_NAME, DEFAULT_WINDOW

_CONFIG_PATH = Path.home() / CONFIG_DIR_NAME / "config.json"

_DEFAULTS = {
    "version": 1,
    "theme": "dark",
    "sidebar_collapsed": False,
    "ocr_default_engine": "auto",
    "ocr_default_lang": "eng",
    "last_dirs": {},
    "recent_tools": [],
    "recent_files": [],
    "window": DEFAULT_WINDOW.copy(),
}

_MAX_RECENT_TOOLS = 10
_MAX_RECENT_FILES = 20


class Config:
    """Singleton config — loads from disk, auto-saves on mutation."""

    _instance: "Config | None" = None
    _data: dict

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._data = {}
            cls._instance._load()
        return cls._instance

    # ── Public API ────────────────────────────────────────────

    def get(self, key: str, default=None):
        return self._data.get(key, default)

    def set(self, key: str, value) -> None:
        self._data[key] = value
        self._save()

    @property
    def theme(self) -> str:
        return self._data.get("theme", "dark")

    @theme.setter
    def theme(self, value: str):
        self._data["theme"] = value
        self._save()

    @property
    def ocr_engine(self) -> str:
        return self._data.get("ocr_default_engine", "auto")

    @ocr_engine.setter
    def ocr_engine(self, value: str):
        self._data["ocr_default_engine"] = value
        self._save()

    @property
    def ocr_lang(self) -> str:
        return self._data.get("ocr_default_lang", "eng")

    @ocr_lang.setter
    def ocr_lang(self, value: str):
        self._data["ocr_default_lang"] = value
        self._save()

    @property
    def window(self) -> dict:
        return self._data.get("window", DEFAULT_WINDOW.copy())

    @window.setter
    def window(self, value: dict):
        self._data["window"] = value
        self._save()

    def get_last_dir(self, tool_id: str) -> str:
        return self._data.get("last_dirs", {}).get(tool_id, str(Path.home()))

    def set_last_dir(self, tool_id: str, directory: str) -> None:
        self._data.setdefault("last_dirs", {})[tool_id] = directory
        self._save()

    def add_recent_tool(self, tool_id: str) -> None:
        recents = self._data.setdefault("recent_tools", [])
        if tool_id in recents:
            recents.remove(tool_id)
        recents.insert(0, tool_id)
        self._data["recent_tools"] = recents[:_MAX_RECENT_TOOLS]
        self._save()

    def add_recent_file(self, path: str, tool_id: str) -> None:
        from datetime import datetime
        entry = {"path": path, "tool": tool_id, "timestamp": datetime.now().isoformat()}
        recents = self._data.setdefault("recent_files", [])
        recents = [r for r in recents if r.get("path") != path]
        recents.insert(0, entry)
        self._data["recent_files"] = recents[:_MAX_RECENT_FILES]
        self._save()

    @property
    def recent_tools(self) -> list[str]:
        return self._data.get("recent_tools", [])

    # ── Persistence ───────────────────────────────────────────

    def _load(self) -> None:
        try:
            if _CONFIG_PATH.exists():
                with open(_CONFIG_PATH, "r", encoding="utf-8") as f:
                    loaded = json.load(f)
                self._data = {**_DEFAULTS, **loaded}
            else:
                self._data = _DEFAULTS.copy()
        except (json.JSONDecodeError, OSError):
            self._data = _DEFAULTS.copy()

    def _save(self) -> None:
        try:
            _CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
            with open(_CONFIG_PATH, "w", encoding="utf-8") as f:
                json.dump(self._data, f, indent=2, ensure_ascii=False)
        except OSError:
            pass  # never crash on config save failure

"""Shared catalog. The file in packages/catalog is the only copy."""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path
from typing import Any


def catalog_path() -> Path:
    packaged = Path(__file__).resolve().parent / "homehub.json"
    if packaged.is_file():
        return packaged
    repo = Path(__file__).resolve().parents[4] / "packages" / "catalog" / "homehub.json"
    if repo.is_file():
        return repo
    raise FileNotFoundError("packages/catalog/homehub.json")


@cache
def catalog() -> dict[str, Any]:
    return json.loads(catalog_path().read_text())

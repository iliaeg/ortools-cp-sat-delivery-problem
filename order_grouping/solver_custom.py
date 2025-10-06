"""Compatibility wrapper exposing the CP-SAT Solver class under the legacy name."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any


def _load_solver() -> Any:
    module_path = Path(__file__).with_name("solver.py")
    spec = importlib.util.spec_from_file_location("order_grouping.solver", module_path)
    if spec is None or spec.loader is None:  # pragma: no cover - defensive branch
        msg = "Failed to load solver module"
        raise ImportError(msg)

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


Solver = _load_solver().Solver

__all__ = ["Solver"]

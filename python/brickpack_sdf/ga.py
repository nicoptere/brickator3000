"""Genetic Algorithm hyperparameter tuner for BrickPack policy genes."""

from __future__ import annotations

import json
import math
import random
from pathlib import Path
from typing import Any, Callable


GENES: dict[str, tuple[float, float, str]] = {
    "lambda": (0.5, 12.0, "float"),
    "core": (0.8, 1.0, "float"),
    "coreCells": (6, 24, "int"),
    "coreOctave": (0, 3, "int"),
    "lnsRadius": (1, 2, "int"),
    "noise": (0.0, 0.6, "float"),
    "connect": (0.0, 600.0, "float"),
}


def _clamp(name: str, val: float) -> float | int:
    lo, hi, kind = GENES[name]
    v = min(hi, max(lo, float(val)))
    return int(round(v)) if kind == "int" else round(v, 4)


def random_genome(rng: random.Random) -> dict[str, Any]:
    return {k: _clamp(k, lo + rng.random() * (hi - lo)) for k, (lo, hi, _) in GENES.items()}


def crossover(a: dict[str, Any], b: dict[str, Any], rng: random.Random) -> dict[str, Any]:
    return {k: (a[k] if rng.random() < 0.5 else b[k]) for k in GENES}


def mutate(g: dict[str, Any], rng: random.Random, rate: float = 0.3, sigma: float = 0.15) -> dict[str, Any]:
    out = dict(g)
    for k, (lo, hi, _) in GENES.items():
        if rng.random() < rate:
            out[k] = _clamp(k, float(out[k]) + rng.gauss(0.0, sigma) * (hi - lo))
    return out


def train_ga(
    out_file: str | Path | None,
    batch: list[dict[str, Any]],
    evaluate: Callable[[dict[str, Any], dict[str, Any]], dict[str, Any]],
    pop: int = 8,
    gens: int = 4,
    seed: int = 7,
    seed_genomes: list[dict[str, Any]] | None = None,
    w_comp: float = 0.004,
    w_pieces: float = 0.00002,
) -> dict[str, Any]:
    rng = random.Random(seed)
    p = Path(out_file) if out_file else None
    state = json.loads(p.read_text(encoding="utf-8")) if (p and p.is_file()) else None
    if state is None or state.get("batch") != batch:
        genomes = []
        for sg in seed_genomes or []:
            genomes.append({k: _clamp(k, sg.get(k, 0.5 * (lo + hi))) for k, (lo, hi, _) in GENES.items()})
        while len(genomes) < pop:
            genomes.append(random_genome(rng))
        state = {
            "batch": batch,
            "weights": {"comp": w_comp, "pieces": w_pieces},
            "gen": 0,
            "pop": [{"genes": g, "fitness": None, "runs": []} for g in genomes],
            "history": [],
            "best": None,
        }

    def save() -> None:
        if p is not None:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps(state, indent=1), encoding="utf-8")

    def fitness(runs: list[dict]) -> float:
        return sum(r["softIoU"] - w_comp * (r["components"] - 1) - w_pieces * r["pieces"] for r in runs) / max(1, len(runs))

    while state["gen"] < gens:
        for ind in state["pop"]:
            if ind["fitness"] is not None:
                continue
            ind["runs"] = []
            for item in batch:
                res = evaluate(ind["genes"], item)
                ind["runs"].append({
                    **item,
                    "softIoU": round(float(res["softIoU"]), 4),
                    "components": int(res["components"]),
                    "pieces": int(res["pieces"]),
                })
            ind["fitness"] = round(fitness(ind["runs"]), 5)
            if state["best"] is None or ind["fitness"] > state["best"]["fitness"]:
                state["best"] = {"genes": ind["genes"], "fitness": ind["fitness"], "gen": state["gen"], "runs": ind["runs"]}
            save()

        sorted_pop = sorted(state["pop"], key=lambda x: -x["fitness"])
        mean_fit = sum(x["fitness"] for x in sorted_pop) / len(sorted_pop)
        state["history"].append({"gen": state["gen"], "best": sorted_pop[0]["fitness"], "mean": round(mean_fit, 5)})

        def pick() -> dict[str, Any]:
            cands = [state["pop"][rng.randrange(len(state["pop"]))] for _ in range(3)]
            return max(cands, key=lambda c: c["fitness"])

        next_pop = [sorted_pop[0]]
        while len(next_pop) < pop:
            child = mutate(crossover(pick()["genes"], pick()["genes"], rng), rng)
            next_pop.append({"genes": child, "fitness": None, "runs": []})
        state["pop"] = next_pop
        state["gen"] += 1
        save()

    return state

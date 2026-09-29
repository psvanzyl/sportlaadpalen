#!/usr/bin/env python3
"""sportlaadpalen — data pipeline.

Builds the static datasets served by the webapp:

  1. laadpunten.geojson     all publicly accessible charge point locations in the
                            Netherlands (NDW DOT-NL OCPI `charging_point_locations`).
                            One feature per location; `chargePoints` holds how many
                            laadpunten (EVSEs) that location has.
  2. sportlocaties.geojson  all sport locations in the Netherlands (OSM
                            leisure=sports_centre|pitch|stadium|swimming_pool|
                            fitness_centre|sports_hall|track)
  3. summary.json           dashboard totals + "no charge point nearby" counts

The proximity join answers: "Hoeveel sportlocaties hebben nog geen laadpunt?"
A sport location counts as *having* a charge point when the nearest public
charge point is within a radius (default 300 m; 250/500/1000 m are also
reported). The per-location nearest distance is stored so the webapp can
re-threshold client-side without a rebuild.

Usage:
    python3 build.py                # use cached raw downloads when present
    python3 build.py --refresh      # force fresh NDW + Overpass downloads
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "raw"
OUT = ROOT.parent / "webapp" / "public" / "data"

NDW_URL = "https://opendata.ndw.nu/charging_point_locations_ocpi.json.gz"
OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
USER_AGENT = "sportlaadpalen/1.0 (https://github.com/psvanzyl/sportlaadpalen)"

RADII_M = [250, 300, 500, 1000]
DEFAULT_RADIUS_M = 300

LEISURE_RE = "^(sports_centre|pitch|stadium|swimming_pool|fitness_centre|sports_hall|track)$"
OVERPASS_QUERY = f"""
[out:json][timeout:600];
area["ISO3166-1"="NL"][admin_level=2]->.nl;
(
  nwr["leisure"~"{LEISURE_RE}"](area.nl);
);
out center tags;
"""

# Equirectangular projection constants around the Netherlands.
LAT0 = 52.1
M_PER_DEG_LAT = 111_320.0
M_PER_DEG_LON = 111_320.0 * math.cos(math.radians(LAT0))

# Cell size for the nearest-neighbour grid: must be >= the largest radius.
GRID_M = max(RADII_M)


def log(msg: str) -> None:
    print(f"[build] {msg}", flush=True)


def download(url: str, dest: Path, timeout: int = 600) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = resp.read()
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return data


def fetch_ndw(refresh: bool) -> Path:
    gz = RAW / "ndw.json.gz"
    if gz.exists() and not refresh:
        log(f"NDW: using cached {gz} ({gz.stat().st_size / 1e6:.1f} MB)")
        return gz
    log("NDW: downloading charge point locations ...")
    download(NDW_URL, gz)
    log(f"NDW: downloaded {gz.stat().st_size / 1e6:.1f} MB")
    return gz


def fetch_overpass(refresh: bool) -> Path:
    out = RAW / "overpass.json"
    if out.exists() and not refresh:
        log(f"Overpass: using cached {out} ({out.stat().st_size / 1e6:.1f} MB)")
        return out
    body = urllib.parse.urlencode({"data": OVERPASS_QUERY}).encode()
    last_err: Exception | None = None
    for url in OVERPASS_ENDPOINTS:
        try:
            log(f"Overpass: querying {url} ...")
            req = urllib.request.Request(
                url, data=body, headers={"User-Agent": USER_AGENT}
            )
            t0 = time.time()
            with urllib.request.urlopen(req, timeout=900) as resp:
                data = resp.read()
            parsed = json.loads(data)
            if "remark" in parsed and "runtime error" in str(parsed.get("remark", "")):
                raise RuntimeError(f"Overpass remark: {parsed['remark']}")
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(data)
            log(
                f"Overpass: {len(parsed.get('elements', []))} elements "
                f"({out.stat().st_size / 1e6:.1f} MB, {time.time() - t0:.0f}s)"
            )
            return out
        except Exception as exc:  # noqa: BLE001 - try the next mirror
            last_err = exc
            log(f"Overpass: {url} failed -> {exc}")
    raise SystemExit(f"Overpass: all endpoints failed: {last_err}")


def parse_charge_points(gz_path: Path) -> list[dict]:
    with gzip.open(gz_path, "rt", encoding="utf-8") as fh:
        locations = json.load(fh)

    points: list[dict] = []
    for loc in locations:
        coords = loc.get("coordinates") or {}
        try:
            lon = float(coords.get("longitude"))
            lat = float(coords.get("latitude"))
        except (TypeError, ValueError):
            continue
        # Select on position, never on `country_code`: several operators publish
        # their Dutch sites under their own home country code (Tesla uses `US`),
        # so a country_code == "NL" filter silently drops them.
        if not (3.0 < lon < 7.4 and 50.6 < lat < 53.6):
            continue

        max_power_w = 0
        n_evses = 0
        n_active = 0
        n_connectors = 0
        for evse in loc.get("evses") or []:
            n_evses += 1
            if evse.get("status") not in ("REMOVED", "PLANNED"):
                n_active += 1
            for conn in evse.get("connectors") or []:
                n_connectors += 1
                p = conn.get("max_electric_power")
                if isinstance(p, (int, float)) and p > max_power_w:
                    max_power_w = p

        points.append(
            {
                "lon": round(lon, 5),
                "lat": round(lat, 5),
                "op": (loc.get("operator") or {}).get("name") or "",
                "name": loc.get("name") or "",
                "city": loc.get("city") or "",
                "p": int(round(max_power_w / 1000.0)),
                # One OCPI location can hold several EVSEs; an EVSE is one
                # "laadpunt" (one car at a time) — the unit RVO counts in.
                "n": n_evses,
                "n_active": n_active,
                "nc": n_connectors,
            }
        )
    total = sum(p["n"] for p in points)
    log(f"NDW: {len(points)} charge point locations / {total} charge points (EVSEs) in NL")
    return points


def parse_sport_locations(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    out: list[dict] = []
    for el in data.get("elements", []):
        tags = el.get("tags") or {}
        if el.get("type") == "node":
            lat, lon = el.get("lat"), el.get("lon")
        else:
            center = el.get("center") or {}
            lat, lon = center.get("lat"), center.get("lon")
        if lat is None or lon is None:
            continue
        leisure = tags.get("leisure") or ""
        out.append(
            {
                "id": f"{el.get('type')}/{el.get('id')}",
                "lon": round(float(lon), 5),
                "lat": round(float(lat), 5),
                "name": tags.get("name") or "",
                "leisure": leisure,
                "sport": tags.get("sport") or "",
            }
        )
    log(f"OSM: {len(out)} sport locations in NL")
    return out


def nearest_distances(
    sport_xy: np.ndarray, charge_xy: np.ndarray, grid_m: float
) -> np.ndarray:
    """Exact nearest-neighbour distance (metres) via a uniform grid.

    Returns the distance from every sport location to the closest charge point.
    A 3x3 cell neighbourhood is sufficient because the cell size equals the
    largest radius of interest.
    """
    n = len(sport_xy)
    if n == 0:
        return np.zeros(0)
    if len(charge_xy) == 0:
        return np.full(n, np.inf)

    cmin = charge_xy.min(axis=0)
    cell = np.floor((charge_xy - cmin) / grid_m).astype(np.int64)

    buckets: dict[tuple[int, int], list[int]] = {}
    for idx, (cx, cy) in enumerate(cell):
        buckets.setdefault((int(cx), int(cy)), []).append(idx)

    scell = np.floor((sport_xy - cmin) / grid_m).astype(np.int64)
    result = np.empty(n, dtype=np.float64)
    offsets = [(dx, dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)]
    for i in range(n):
        sx, sy = int(scell[i, 0]), int(scell[i, 1])
        cand: list[int] = []
        for dx, dy in offsets:
            b = buckets.get((sx + dx, sy + dy))
            if b:
                cand.extend(b)
        if not cand:
            result[i] = np.inf
            continue
        pts = charge_xy[cand]
        d = np.hypot(pts[:, 0] - sport_xy[i, 0], pts[:, 1] - sport_xy[i, 1])
        result[i] = d.min()
    return result


def to_xy(lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
    return np.column_stack([lon * M_PER_DEG_LON, lat * M_PER_DEG_LAT])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="force fresh downloads")
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)

    ndw_gz = fetch_ndw(args.refresh)
    overpass_json = fetch_overpass(args.refresh)

    charge = parse_charge_points(ndw_gz)
    sport = parse_sport_locations(overpass_json)

    charge_xy = to_xy(
        np.array([p["lon"] for p in charge]), np.array([p["lat"] for p in charge])
    )
    sport_xy = to_xy(
        np.array([s["lon"] for s in sport]), np.array([s["lat"] for s in sport])
    )

    log("Computing nearest charge point per sport location ...")
    t0 = time.time()
    dist = nearest_distances(sport_xy, charge_xy, GRID_M)
    log(f"Nearest-neighbour done in {time.time() - t0:.1f}s")

    # Attach distances (cap at 99999 so the JSON stays small / sortable).
    for s, d in zip(sport, dist):
        s["nearestM"] = int(min(round(float(d)), 99999)) if np.isfinite(d) else 99999

    # ---- GeoJSON: charge points -------------------------------------------------
    charge_fc = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [p["lon"], p["lat"]]},
                "properties": {
                    "operator": p["op"],
                    "name": p["name"],
                    "city": p["city"],
                    "powerKw": p["p"],
                    "chargePoints": p["n"],
                    "connectors": p["nc"],
                },
            }
            for p in charge
        ],
    }
    (OUT / "laadpunten.geojson").write_text(
        json.dumps(charge_fc, separators=(",", ":")), encoding="utf-8"
    )

    # ---- GeoJSON: sport locations ----------------------------------------------
    sport_fc = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [s["lon"], s["lat"]]},
                "properties": {
                    "id": s["id"],
                    "name": s["name"],
                    "leisure": s["leisure"],
                    "sport": s["sport"],
                    "nearestM": s["nearestM"],
                    "hasCharger": bool(s["nearestM"] <= DEFAULT_RADIUS_M),
                },
            }
            for s in sport
        ],
    }
    (OUT / "sportlocaties.geojson").write_text(
        json.dumps(sport_fc, separators=(",", ":")), encoding="utf-8"
    )

    # ---- summary.json -----------------------------------------------------------
    by_radius = {}
    for r in RADII_M:
        within = int(sum(1 for s in sport if s["nearestM"] <= r))
        by_radius[str(r)] = {
            "withCharger": within,
            "withoutCharger": len(sport) - within,
        }

    by_type: dict[str, dict[str, int]] = {}
    for s in sport:
        key = s["leisure"] or "overig"
        bucket = by_type.setdefault(key, {"total": 0, "withCharger": 0, "withoutCharger": 0})
        bucket["total"] += 1
        if s["nearestM"] <= DEFAULT_RADIUS_M:
            bucket["withCharger"] += 1
        else:
            bucket["withoutCharger"] += 1

    without = by_radius[str(DEFAULT_RADIUS_M)]["withoutCharger"]
    cp_total = int(sum(p["n"] for p in charge))
    cp_active = int(sum(p["n_active"] for p in charge))
    cp_connectors = int(sum(p["nc"] for p in charge))
    summary = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "chargePoints": {
            # `total` is the number of laadpunten (OCPI EVSEs) — the unit the
            # RVO/Dutch government monitor counts. `locations` is the number of
            # physical locations, which is what the map plots.
            "total": cp_total,
            "active": cp_active,
            "locations": len(charge),
            "connectors": cp_connectors,
        },
        "sportLocations": {
            "total": len(sport),
            "withCharger": len(sport) - without,
            "withoutCharger": without,
        },
        "defaultRadiusM": DEFAULT_RADIUS_M,
        "radii": RADII_M,
        "byRadius": by_radius,
        "byType": dict(
            sorted(by_type.items(), key=lambda kv: -kv[1]["total"])
        ),
        "sources": {
            "chargePoints": "NDW DOT-NL OCPI (charging_point_locations)",
            "sportLocations": "OpenStreetMap (leisure=sports_centre|pitch|stadium|swimming_pool|fitness_centre|sports_hall|track)",
        },
    }
    (OUT / "summary.json").write_text(
        json.dumps(summary, indent=2), encoding="utf-8"
    )

    log(
        f"Wrote {OUT}: {len(charge)} charge points, {len(sport)} sport locations "
        f"({without} without a charge point within {DEFAULT_RADIUS_M} m)"
    )
    for name in ("laadpunten.geojson", "sportlocaties.geojson", "summary.json"):
        p = OUT / name
        log(f"  {name}: {p.stat().st_size / 1e6:.2f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
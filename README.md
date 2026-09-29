# ⚡ Sportlaadpalen

Dashboard dat alle **laadpunten in Nederland** toont en telt, en antwoord geeft
op de vraag:

> **Hoeveel sportlocaties hebben nog geen laadpunt?** — en dat op een kaart.

**Live:** https://sportlaadpalen.laserraptorai.duckdns.org

## Antwoord (huidige databuild)

| | |
|---|---|
| Publieke laadpunten in NL | **74.765** |
| Sportlocaties in NL | **64.350** |
| Sportlocaties **zonder** laadpunt binnen 300 m | **25.443** |

Afstandsgevoeligheid (`byRadius` in `summary.json`):

| radius | mét laadpunt | zónder laadpunt |
|---|---|---|
| 250 m | 34.929 | 29.421 |
| 300 m | 38.907 | 25.443 |
| 500 m | 47.312 | 17.038 |
| 1000 m | 53.805 | 10.545 |

## Hoe het werkt

```
pipeline/build.py          haalt de brondata op, doet de nabijheidsjoin,
                           schrijft webapp/public/data/*
webapp/                    Next.js 16 + MapLibre dashboard (statisch)
Dockerfile                 multi-stage build voor Coolify
```

De webapp is een dunne laag over drie statische bestanden:

| bestand | inhoud |
|---|---|
| `webapp/public/data/laadpunten.geojson` | alle publieke laadpunten (NDW DOT-NL OCPI) |
| `webapp/public/data/sportlocaties.geojson` | alle sportlocaties (OpenStreetMap) |
| `webapp/public/data/summary.json` | totalen, per-radius- en per-type-uitsplitsing |

Elke sportlocatie krijgt een `nearestM` (hemelsbrede afstand tot het
dichtstbijzijnde publieke laadpunt). De webapp herfiltert daarmee client-side,
dus de afstandsknopjes (250/300/500/1000 m) werken zonder rebuild.

### Vraagselector

Het dashboard heeft één selector met twee vragen:

1. **Hoeveel sportlocaties hebben nog geen laadpunt?** (standaard) — toont
   sportlocaties, rood = geen laadpunt binnen de gekozen radius, groen = wel.
2. **Hoeveel laadpunten heeft Nederland?** — toont alle laadpunten.

## Databronnen

* **Laadpunten** — [NDW](https://opendata.ndw.nu/) `charging_point_locations_ocpi.json.gz`
  (OCPI), gefilterd op `country_code = NL`.
* **Sportlocaties** — OpenStreetMap via Overpass:
  `leisure = sports_centre | pitch | stadium | swimming_pool | fitness_centre |
  sports_hall | track`, met `out center` voor ways/relations.

Beide zijn open data; de nabijheidsjoin is een exacte nearest-neighbour op een
uniforme grid-index.

## Data verversen

```bash
cd pipeline
python3 -m pip install -r requirements.txt
python3 build.py --refresh      # verse NDW + Overpass download
cd ../webapp && npm install && npm run build
```

Commit de vernieuwde `webapp/public/data/*` en deploy opnieuw.

## Lokaal draaien

```bash
cd webapp
npm install
npm run dev        # http://localhost:3000
```

## Deploy

Coolify, build pack **dockerfile**, poort **3000**,
FQDN `sportlaadpalen.laserraptorai.duckdns.org`.

## Licentie / attributie

Code: MIT. Data: NDW (CC0) en © OpenStreetMap-bijdragers (ODbL).
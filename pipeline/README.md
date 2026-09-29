# Data pipeline

Genereert de statische datasets die de webapp serveert uit
`webapp/public/data/`:

| bestand | inhoud |
|---|---|
| `laadpunten.geojson` | alle publieke laadpunten in Nederland (NDW DOT-NL OCPI) |
| `sportlocaties.geojson` | alle sportlocaties in Nederland (OpenStreetMap) |
| `summary.json` | dashboardtotalen + "geen laadpunt in de buurt"-tellingen |

## Draaien

```bash
python3 -m pip install -r requirements.txt
python3 build.py             # gebruikt cache in raw/ indien aanwezig
python3 build.py --refresh   # forceert verse NDW + Overpass downloads
```

## Methode

* **Laadpunten** — NDW `charging_point_locations_ocpi.json.gz`, gefilterd op
  `country_code == NL` en op coördinaten binnen de Nederlandse bounding box.
  Per locatie wordt het maximale connectorvermogen (kW) bepaald.
* **Sportlocaties** — Overpass-query op `leisure=sports_centre|pitch|stadium|
  swimming_pool|fitness_centre|sports_hall|track`, met `out center` zodat
  ways/relations een punt krijgen.
* **Proximity** — de afstand van elke sportlocatie tot het dichtstbijzijnde
  laadpunt wordt exact berekend met een uniforme grid-index (celgrootte =
  grootste radius). Elke sportlocatie krijgt `nearestM`; de webapp kan daarmee
  client-side herfilteren zonder rebuild.

Een sportlocatie "heeft een laadpunt" wanneer het dichtstbijzijnde publieke
laadpunt binnen de gekozen radius ligt (standaard **300 m**).
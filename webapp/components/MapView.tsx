"use client";

import { useEffect, useRef } from "react";
import maplibregl, { type Map as MlMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { ChargePoints, SportLocations, View } from "@/lib/types";

const NL_BOUNDS: [[number, number], [number, number]] = [
  [3.2, 50.7],
  [7.3, 53.6],
];

const BASEMAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    basemap: {
      type: "raster",
      tiles: ["https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap-bijdragers © CARTO",
    },
  },
  layers: [{ id: "basemap", type: "raster", source: "basemap" }],
};

interface Props {
  chargePoints: ChargePoints | null;
  sportLocations: SportLocations | null;
  view: View;
  radiusM: number;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
  );
}

function lngLatOf(f: maplibregl.MapGeoJSONFeature): [number, number] {
  return (f.geometry as unknown as { coordinates: [number, number] }).coordinates;
}

export default function MapView({
  chargePoints,
  sportLocations,
  view,
  radiusM,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  // Read by the (once-registered) popup handlers so they always reflect the
  // radius currently selected in the UI.
  const radiusRef = useRef(radiusM);
  radiusRef.current = radiusM;

  // Init map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      bounds: NL_BOUNDS,
      fitBoundsOptions: { padding: 24 },
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Add / refresh the charge point source + layer.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !chargePoints) return;
    const ensure = () => {
      if (!map.getSource("laadpunten")) {
        map.addSource("laadpunten", { type: "geojson", data: chargePoints as never });
        map.addLayer({
          id: "laadpunten",
          type: "circle",
          source: "laadpunten",
          paint: {
            "circle-radius": [
              "interpolate", ["linear"], ["zoom"], 6, 1.6, 10, 3, 14, 5,
            ],
            "circle-color": "#2563eb",
            "circle-opacity": 0.75,
            "circle-stroke-width": 0,
          },
        });
        map.on("click", "laadpunten", (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties as Record<string, string | number>;
          new maplibregl.Popup({ closeButton: false })
            .setLngLat(lngLatOf(f))
            .setHTML(
              `<div style="padding:8px 10px;font:12px/1.4 system-ui">
                <div style="font-weight:600">${escapeHtml(String(p.name || "Laadpunt"))}</div>
                <div style="color:#475569">${escapeHtml(String(p.operator || "Onbekend"))}${
                  p.city ? " · " + escapeHtml(String(p.city)) : ""
                }</div>
                <div>${p.powerKw ? Number(p.powerKw) + " kW" : "vermogen onbekend"} · ${
                  p.connectors || 0
                } connector(en)</div>
              </div>`,
            )
            .addTo(map);
        });
        map.on("mouseenter", "laadpunten", () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", "laadpunten", () => (map.getCanvas().style.cursor = ""));
      }
      map.setLayoutProperty(
        "laadpunten",
        "visibility",
        view === "laadpunten" ? "visible" : "none",
      );
    };
    if (map.isStyleLoaded()) ensure();
    else map.once("load", ensure);
  }, [chargePoints, view]);

  // Add the sport location source + two threshold layers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !sportLocations) return;
    const ensure = () => {
      if (!map.getSource("sportlocaties")) {
        map.addSource("sportlocaties", {
          type: "geojson",
          data: sportLocations as never,
        });
        // Green: a charge point is within the chosen radius.
        map.addLayer({
          id: "sport-yes",
          type: "circle",
          source: "sportlocaties",
          paint: {
            "circle-radius": [
              "interpolate", ["linear"], ["zoom"], 6, 2, 10, 4, 14, 7,
            ],
            "circle-color": "#16a34a",
            "circle-opacity": 0.7,
          },
        });
        // Red: no charge point within the chosen radius. Slightly larger.
        // NOTE: a zoom expression may only sit at the top level of an
        // interpolate/step — `["*", <interpolate>, 1.25]` is rejected by
        // MapLibre and makes the whole addLayer throw. Scale the stops instead.
        map.addLayer({
          id: "sport-no",
          type: "circle",
          source: "sportlocaties",
          paint: {
            "circle-radius": [
              "interpolate", ["linear"], ["zoom"], 6, 2.6, 10, 5.2, 14, 9.1,
            ],
            "circle-color": "#dc2626",
            "circle-opacity": 0.85,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 0.4,
          },
        });
        const popup =
          (color: string) =>
          (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
            const f = e.features?.[0];
            if (!f) return;
            const p = f.properties as Record<string, string | number>;
            const d = Number(p.nearestM);
            const r = radiusRef.current;
            new maplibregl.Popup({ closeButton: false })
              .setLngLat(lngLatOf(f))
              .setHTML(
                `<div style="padding:8px 10px;font:12px/1.4 system-ui">
                  <div style="font-weight:600;color:${color}">${
                    d <= r ? "Heeft laadpunt in de buurt" : "Geen laadpunt in de buurt"
                  }</div>
                  <div>${escapeHtml(String(p.name || "Naamloos"))}</div>
                  <div style="color:#475569">${escapeHtml(String(p.leisure || ""))}${
                    p.sport ? " · " + escapeHtml(String(p.sport)) : ""
                  }</div>
                  <div>Dichtstbijzijnde laadpunt: ${
                    d >= 99999 ? "> 10 km" : d + " m"
                  } (grens ${r} m)</div>
                </div>`,
              )
              .addTo(map);
          };
        map.on("click", "sport-no", popup("#dc2626"));
        map.on("click", "sport-yes", popup("#16a34a"));
        for (const l of ["sport-no", "sport-yes"]) {
          map.on("mouseenter", l, () => (map.getCanvas().style.cursor = "pointer"));
          map.on("mouseleave", l, () => (map.getCanvas().style.cursor = ""));
        }
      }
      applySportState(map, view, radiusM);
    };
    if (map.isStyleLoaded()) ensure();
    else map.once("load", ensure);
  }, [sportLocations]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update sport thresholds / visibility when view or radius changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource("sportlocaties")) return;
    applySportState(map, view, radiusM);
  }, [view, radiusM]);

  // NOTE: do NOT put Tailwind's `absolute inset-0` on the MapLibre container.
  // MapLibre's own `.maplibregl-map { position: relative }` rule is *unlayered*,
  // so it beats Tailwind v4's `@layer utilities` no matter the order — the
  // container silently became `position: relative` with height 0 and the map
  // was invisible. The wrapper therefore uses inline styles (which outrank any
  // stylesheet) and the container only carries `h-full w-full`, safe because
  // MapLibre declares neither width nor height on it.
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}

function applySportState(map: MlMap, view: View, radiusM: number) {
  if (!map.getLayer("sport-no") || !map.getLayer("sport-yes")) return;
  const visible = view === "sportlocaties";
  map.setLayoutProperty("sport-no", "visibility", visible ? "visible" : "none");
  map.setLayoutProperty("sport-yes", "visibility", visible ? "visible" : "none");
  // Filters derive from nearestM so the radius selector works without a rebuild.
  map.setFilter("sport-no", [">", ["get", "nearestM"], radiusM]);
  map.setFilter("sport-yes", ["<=", ["get", "nearestM"], radiusM]);
}
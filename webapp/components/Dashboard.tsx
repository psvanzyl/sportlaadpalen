"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type {
  ChargePoints,
  SportLocations,
  Summary,
  View,
} from "@/lib/types";
import { leisureLabel } from "@/lib/types";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center bg-slate-100 text-slate-500">
      Kaart laden…
    </div>
  ),
});

const nf = new Intl.NumberFormat("nl-NL");

export default function Dashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [chargePoints, setChargePoints] = useState<ChargePoints | null>(null);
  const [sportLocations, setSportLocations] = useState<SportLocations | null>(null);
  const [view, setView] = useState<View>("sportlocaties");
  const [radiusM, setRadiusM] = useState<number>(300);
  const [error, setError] = useState<string | null>(null);

  const sportRequested = useRef(false);

  // Summary + charge points load once.
  useEffect(() => {
    fetch("/data/summary.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`summary ${r.status}`))))
      .then((d: Summary) => {
        setSummary(d);
        setRadiusM(d.defaultRadiusM);
      })
      .catch((e) => setError(String(e)));

    fetch("/data/laadpunten.geojson")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`laadpunten ${r.status}`))))
      .then((d: ChargePoints) => setChargePoints(d))
      .catch((e) => setError(String(e)));
  }, []);

  // Sport locations load lazily, the first time the sport question is shown.
  useEffect(() => {
    if (view !== "sportlocaties" || sportRequested.current) return;
    sportRequested.current = true;
    fetch("/data/sportlocaties.geojson")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`sportlocaties ${r.status}`))))
      .then((d: SportLocations) => setSportLocations(d))
      .catch((e) => setError(String(e)));
  }, [view]);

  // Client-side recount for the selected radius (falls back to summary).
  const sportCounts = useMemo(() => {
    if (!sportLocations) {
      const b = summary?.byRadius?.[String(radiusM)];
      if (b) return { total: summary!.sportLocations.total, ...b };
      return null;
    }
    let without = 0;
    for (const f of sportLocations.features) {
      if ((f.properties.nearestM ?? 99999) > radiusM) without++;
    }
    return {
      total: sportLocations.features.length,
      withoutCharger: without,
      withCharger: sportLocations.features.length - without,
    };
  }, [sportLocations, radiusM, summary]);

  const byType = useMemo(() => {
    if (!summary) return [];
    return Object.entries(summary.byType).map(([key, v]) => ({
      key,
      label: leisureLabel(key),
      ...v,
    }));
  }, [summary]);

  const totalCharge = summary?.chargePoints.total ?? 0;
  const sportTotal = summary?.sportLocations.total ?? 0;

  return (
    <div className="h-screen flex flex-col">
      <header className="bg-white border-b border-slate-200 shadow-sm z-20">
        <div className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-lg font-bold text-slate-900 whitespace-nowrap">
            ⚡ Sportlaadpalen
          </h1>
          <p className="text-xs text-slate-500 hidden md:block">
            Laadpunten &amp; sportlocaties in Nederland
          </p>
          {summary && (
            <span className="text-[11px] text-slate-400 ml-auto">
              data: {new Date(summary.generatedAt).toLocaleString("nl-NL")}
            </span>
          )}
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Sidebar */}
        <aside className="lg:w-[380px] lg:shrink-0 bg-slate-50 border-b lg:border-b-0 lg:border-r border-slate-200 overflow-y-auto p-4 space-y-4">
          {/* Question selector */}
          <section className="bg-white rounded-xl border border-slate-200 p-4">
            <label
              htmlFor="vraag"
              className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2"
            >
              Kies een vraag
            </label>
            <select
              id="vraag"
              value={view}
              onChange={(e) => setView(e.target.value as View)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 focus:border-blue-500 focus:outline-none"
            >
              <option value="sportlocaties">
                Hoeveel sportlocaties hebben nog geen laadpunt?
              </option>
              <option value="laadpunten">
                Hoeveel laadpunten heeft Nederland?
              </option>
            </select>
          </section>

          {/* Answer card */}
          {view === "sportlocaties" ? (
            <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
              <div>
                <div className="text-4xl font-bold text-red-600 tabular-nums">
                  {sportCounts ? nf.format(sportCounts.withoutCharger) : "…"}
                </div>
                <p className="text-sm text-slate-600 mt-1">
                  van {nf.format(sportTotal)} sportlocaties hebben{" "}
                  <strong>geen laadpunt</strong> binnen {radiusM} m.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>Afstand:</span>
                {[250, 300, 500, 1000].map((r) => (
                  <button
                    key={r}
                    onClick={() => setRadiusM(r)}
                    className={`px-2 py-1 rounded-md border text-xs font-medium transition ${
                      radiusM === r
                        ? "bg-blue-600 border-blue-600 text-white"
                        : "bg-white border-slate-300 text-slate-600 hover:border-blue-400"
                    }`}
                  >
                    {r} m
                  </button>
                ))}
              </div>
              <div className="flex gap-4 text-xs">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-red-600" /> zonder laadpunt
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-green-600" /> met laadpunt
                </span>
              </div>
            </section>
          ) : (
            <section className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-4xl font-bold text-blue-600 tabular-nums">
                {nf.format(totalCharge)}
              </div>
              <p className="text-sm text-slate-600 mt-1">
                publieke laadpunten in Nederland.
              </p>
              <div className="flex items-center gap-1.5 text-xs mt-3 text-slate-500">
                <span className="w-3 h-3 rounded-full bg-blue-600" /> laadpunt
              </div>
            </section>
          )}

          {/* Breakdown by sport type */}
          {view === "sportlocaties" && byType.length > 0 && (
            <section className="bg-white rounded-xl border border-slate-200 p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                Per type (bij {summary?.defaultRadiusM ?? 300} m)
              </h2>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-400 text-left">
                    <th className="font-medium py-1">Type</th>
                    <th className="font-medium py-1 text-right">Totaal</th>
                    <th className="font-medium py-1 text-right">Zonder</th>
                  </tr>
                </thead>
                <tbody>
                  {byType.map((t) => (
                    <tr key={t.key} className="border-t border-slate-100">
                      <td className="py-1.5 text-slate-700">{t.label}</td>
                      <td className="py-1.5 text-right tabular-nums text-slate-600">
                        {nf.format(t.total)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums font-medium text-red-600">
                        {nf.format(t.withoutCharger)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
              Fout bij laden: {error}
            </p>
          )}

          <p className="text-[11px] leading-relaxed text-slate-400 px-1">
            Bronnen: NDW DOT-NL OCPI (laadpunten) · OpenStreetMap (sportlocaties).
            Afstand = hemelsbrede afstand tot het dichtstbijzijnde publieke
            laadpunt.
          </p>
        </aside>

        {/* Map */}
        <main className="relative flex-1 min-h-[420px]">
          <MapView
            chargePoints={chargePoints}
            sportLocations={sportLocations}
            view={view}
            radiusM={radiusM}
          />
        </main>
      </div>
    </div>
  );
}
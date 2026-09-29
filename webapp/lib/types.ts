import type { FeatureCollection, Point } from "geojson";

export type View = "laadpunten" | "sportlocaties";

export interface ChargePointProps {
  operator: string;
  name: string;
  city: string;
  powerKw: number;
  connectors: number;
}

export interface SportLocationProps {
  id: string;
  name: string;
  leisure: string;
  sport: string;
  nearestM: number;
  hasCharger: boolean;
}

export type ChargePoints = FeatureCollection<Point, ChargePointProps>;
export type SportLocations = FeatureCollection<Point, SportLocationProps>;

export interface TypeBucket {
  total: number;
  withCharger: number;
  withoutCharger: number;
}

export interface Summary {
  generatedAt: string;
  chargePoints: { total: number };
  sportLocations: { total: number; withCharger: number; withoutCharger: number };
  defaultRadiusM: number;
  radii: number[];
  byRadius: Record<string, { withCharger: number; withoutCharger: number }>;
  byType: Record<string, TypeBucket>;
  sources: { chargePoints: string; sportLocations: string };
}

export const LEISURE_LABELS: Record<string, string> = {
  pitch: "Sportveld",
  swimming_pool: "Zwembad",
  sports_centre: "Sportcentrum",
  fitness_centre: "Fitnesscentrum",
  track: "Atletiekbaan",
  sports_hall: "Sporthal",
  stadium: "Stadion",
  overig: "Overig",
};

export function leisureLabel(key: string): string {
  return LEISURE_LABELS[key] ?? key;
}
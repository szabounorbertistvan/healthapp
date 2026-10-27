import type { GymsV1 } from "@healthapp/api/v1";

// What both gym maps draw (gym-map.tsx on the phone, gym-map.web.tsx in the
// browser preview): the web's GymMap styles, home and pins as GeoJSON.

export const MAP_STYLE = { light: "https://tiles.openfreemap.org/styles/positron", dark: "https://tiles.openfreemap.org/styles/dark" } as const;
/** Romania's middle, where the map opens before it fits the pins. */
export const MAP_HOME: [number, number] = [25.0, 45.9];

export type Pin = NonNullable<GymsV1["pins"]>[number];

export function pinsGeoJson(pins: Pin[], homeId: string | null): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: pins.map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: [p.lng, p.lat] }, properties: { id: p.id, home: p.id === homeId ? 1 : 0 } })),
  };
}

export function pinsBounds(pins: Pin[]): [number, number, number, number] | null {
  if (pins.length < 2) return null;
  const lngs = pins.map((p) => p.lng);
  const lats = pins.map((p) => p.lat);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

import { router } from "expo-router";
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import { MAP_HOME, MAP_STYLE, pinsGeoJson, type Pin } from "@/components/gym-map-data";
import { useTheme } from "@/lib/theme";

// The gym map in the browser preview — the web's own GymMap code path
// (maplibre-gl), drawn into a div; the phone build uses gym-map.tsx
// (MapLibre native) with the same styles, layers and colours.

export function GymMap({ pins, homeId, height = 360 }: { pins: Pin[]; homeId: string | null; height?: number }) {
  const { color, dark } = useTheme();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const latest = useRef({ pins, homeId });
  latest.current = { pins, homeId };

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const m = new maplibregl.Map({ container: el, style: dark ? MAP_STYLE.dark : MAP_STYLE.light, center: MAP_HOME, zoom: 5.6, attributionControl: { compact: true } });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("load", () => {
      const { pins: list, homeId: home } = latest.current;
      m.addSource("gyms", { type: "geojson", data: pinsGeoJson(list, home), cluster: true, clusterRadius: 50, clusterMaxZoom: 14 });
      m.addLayer({ id: "clusters", type: "circle", source: "gyms", filter: ["has", "point_count"],
        paint: { "circle-color": color.surface, "circle-stroke-color": color.accent, "circle-stroke-width": 2, "circle-radius": ["step", ["get", "point_count"], 16, 10, 20, 50, 26] } });
      m.addLayer({ id: "cluster-count", type: "symbol", source: "gyms", filter: ["has", "point_count"],
        layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12, "text-font": ["Noto Sans Bold"] }, paint: { "text-color": color.ink } });
      m.addLayer({ id: "gym", type: "circle", source: "gyms", filter: ["!", ["has", "point_count"]],
        paint: { "circle-color": color.accent, "circle-radius": ["case", ["==", ["get", "home"], 1], 10, 7], "circle-stroke-color": ["case", ["==", ["get", "home"], 1], color.ink, color.accentFg], "circle-stroke-width": 2 } });
      if (list.length > 1) {
        const b = new maplibregl.LngLatBounds();
        for (const p of list) b.extend([p.lng, p.lat]);
        m.fitBounds(b, { padding: 60, maxZoom: 13, duration: 0 });
      } else if (list.length === 1) {
        m.jumpTo({ center: [list[0]!.lng, list[0]!.lat], zoom: 13 });
      }
    });
    // a cluster zooms in; a gym opens its page
    m.on("click", "clusters", async (e) => {
      const f = e.features?.[0];
      const id = f?.properties?.cluster_id;
      if (typeof id !== "number" || f?.geometry.type !== "Point") return;
      const zoom = await (m.getSource("gyms") as GeoJSONSource).getClusterExpansionZoom(id);
      m.easeTo({ center: f.geometry.coordinates as [number, number], zoom });
    });
    m.on("click", "gym", (e) => {
      const id = e.features?.[0]?.properties?.id;
      if (typeof id === "string") router.push({ pathname: "/gym/[id]", params: { id } });
    });
    for (const layer of ["clusters", "gym"]) {
      m.on("mouseenter", layer, () => { m.getCanvas().style.cursor = "pointer"; });
      m.on("mouseleave", layer, () => { m.getCanvas().style.cursor = ""; });
    }
    return () => { m.remove(); map.current = null; };
    // the map is made once; new pins go to its source below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark]);

  useEffect(() => {
    const src = map.current?.getSource("gyms") as GeoJSONSource | undefined;
    src?.setData(pinsGeoJson(pins, homeId));
  }, [pins, homeId]);

  return <div ref={box} style={{ height, borderRadius: 16, overflow: "hidden" }} />;
}

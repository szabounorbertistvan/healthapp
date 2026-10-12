"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap, type MapGeoJSONFeature } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { GymPin } from "@/lib/gym-data";
import { fill } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";

/**
 * The gym map: MapLibre over OpenFreeMap tiles — no key, no quota, no Google
 * on the map itself (the approach DishFinder uses). Pins are one clustered
 * GeoJSON source drawn as layers, not DOM markers; a click on a cluster zooms
 * in, a click on a gym opens a popup built from DOM nodes (never HTML
 * strings) with a link to /gyms/[id]. The style follows the app's theme —
 * the data-theme override first, else the device — and the pin colours come
 * from the theme's own CSS variables, so no hex lives here.
 */
const STYLE_LIGHT = "https://tiles.openfreemap.org/styles/positron";
const STYLE_DARK = "https://tiles.openfreemap.org/styles/dark";
/** Romania, when there is nothing to fit. */
const HOME: [number, number] = [25.0, 45.9];

function isDark(): boolean {
  const forced = document.documentElement.dataset.theme;
  if (forced) return forced === "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function cssColor(name: string, fallbackVar: string): string {
  const css = getComputedStyle(document.documentElement);
  return css.getPropertyValue(name).trim() || css.getPropertyValue(fallbackVar).trim() || "gray";
}

function toGeoJson(pins: GymPin[], homeId: string | null): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: pins.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      properties: { id: p.id, home: p.id === homeId ? 1 : 0 },
    })),
  };
}

export function GymMap({ pins, homeGymId }: { pins: GymPin[]; homeGymId: string | null }) {
  const { t } = useI18n();
  const h = t.gyms.hub;
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const meRef = useRef<maplibregl.Marker | null>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState(false);
  // Kept in refs so the style-reload handler always sees the latest props.
  const pinsRef = useRef(pins);
  pinsRef.current = pins;
  const byId = useRef(new Map<string, GymPin>());
  byId.current = new Map(pins.map((p) => [p.id, p]));

  useEffect(() => {
    if (!box.current) return;
    const map = new maplibregl.Map({
      container: box.current,
      style: isDark() ? STYLE_DARK : STYLE_LIGHT,
      center: HOME,
      zoom: 5.6,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    function addOverlay() {
      if (map.getSource("gyms")) return;
      const accent = cssColor("--color-accent", "--accent");
      const accentFg = cssColor("--color-accent-fg", "--accent-fg");
      const surface = cssColor("--color-surface", "--surface");
      const ink = cssColor("--color-ink", "--ink");
      map.addSource("gyms", {
        type: "geojson",
        data: toGeoJson(pinsRef.current, homeGymId),
        cluster: true,
        clusterRadius: 50,
        clusterMaxZoom: 14,
      });
      map.addLayer({
        id: "clusters",
        type: "circle",
        source: "gyms",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": surface,
          "circle-stroke-color": accent,
          "circle-stroke-width": 2,
          "circle-radius": ["step", ["get", "point_count"], 16, 10, 20, 50, 26],
        },
      });
      map.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "gyms",
        filter: ["has", "point_count"],
        layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12, "text-font": ["Noto Sans Bold"] },
        paint: { "text-color": ink },
      });
      map.addLayer({
        id: "gym",
        type: "circle",
        source: "gyms",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": accent,
          "circle-radius": ["case", ["==", ["get", "home"], 1], 10, 7],
          "circle-stroke-color": ["case", ["==", ["get", "home"], 1], ink, accentFg],
          "circle-stroke-width": 2,
        },
      });
    }

    map.on("load", () => {
      addOverlay();
      const list = pinsRef.current;
      if (list.length > 1) {
        const b = new maplibregl.LngLatBounds();
        for (const p of list) b.extend([p.lng, p.lat]);
        map.fitBounds(b, { padding: 60, maxZoom: 13, duration: 0 });
      } else if (list.length === 1) {
        map.jumpTo({ center: [list[0].lng, list[0].lat], zoom: 13 });
      }
    });
    // A new style drops every source and layer: put the pins back.
    map.on("style.load", addOverlay);

    map.on("click", "clusters", async (e) => {
      const f = e.features?.[0] as MapGeoJSONFeature | undefined;
      if (!f) return;
      const src = map.getSource("gyms") as GeoJSONSource;
      const zoom = await src.getClusterExpansionZoom(f.properties.cluster_id as number);
      map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom });
    });

    map.on("click", "gym", (e) => {
      const f = e.features?.[0];
      const pin = f ? byId.current.get(String(f.properties.id)) : undefined;
      if (!pin) return;
      new maplibregl.Popup({ offset: 12, maxWidth: "260px" })
        .setLngLat([pin.lng, pin.lat])
        .setDOMContent(popupFor(pin))
        .addTo(map);
    });
    for (const layer of ["clusters", "gym"]) {
      map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
    }

    // Theme changes: the toggle edits data-theme, the device flips its scheme.
    const restyle = () => map.setStyle(isDark() ? STYLE_DARK : STYLE_LIGHT);
    const observer = new MutationObserver(restyle);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", restyle);

    return () => {
      observer.disconnect();
      media.removeEventListener("change", restyle);
      map.remove();
      mapRef.current = null;
    };
    // The map is built once; new pins go through setData below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const src = mapRef.current?.getSource("gyms") as GeoJSONSource | undefined;
    src?.setData(toGeoJson(pins, homeGymId));
  }, [pins, homeGymId]);

  /** The popup, as DOM nodes: a gym's name is data, never markup. */
  function popupFor(pin: GymPin): HTMLElement {
    const root = document.createElement("div");
    root.className = "text-ink";
    const name = document.createElement("p");
    name.className = "font-display text-[15px] font-bold leading-tight";
    name.textContent = pin.name;
    const where = document.createElement("p");
    where.className = "mt-0.5 text-[12px] opacity-70";
    where.textContent = [pin.address, pin.city].filter(Boolean).join(", ");
    root.append(name, where);
    const facts = [
      fill(h.members, { n: pin.members }),
      pin.coaches > 0 ? fill(h.coaches, { n: pin.coaches }) : null,
      pin.athletes_30d != null ? fill(h.active, { n: pin.athletes_30d }) : null,
      pin.google_rating != null ? fill(h.rating, { r: pin.google_rating.toFixed(1) }) : null,
    ].filter(Boolean) as string[];
    for (const line of facts) {
      const p = document.createElement("p");
      p.className = "mt-1 text-[12px]";
      p.textContent = line;
      root.append(p);
    }
    const open = document.createElement("a");
    open.href = `/gyms/${pin.id}`;
    open.className = "mt-2 inline-block text-[13px] font-semibold underline";
    open.textContent = `${h.open} →`;
    open.addEventListener("click", (e) => { e.preventDefault(); router.push(`/gyms/${pin.id}`); });
    root.append(open);
    return root;
  }

  function nearMe() {
    const map = mapRef.current;
    if (!map || !("geolocation" in navigator)) { setLocError(true); return; }
    setLocating(true);
    setLocError(false);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const at: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        // The position stays in this browser: it centres the map, nothing more.
        if (!meRef.current) {
          const dot = document.createElement("div");
          dot.className = "h-4 w-4 rounded-full border-2 border-bg bg-ink shadow";
          meRef.current = new maplibregl.Marker({ element: dot });
        }
        meRef.current.setLngLat(at).addTo(map);
        map.flyTo({ center: at, zoom: 13 });
      },
      () => { setLocating(false); setLocError(true); },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={nearMe}
          disabled={locating}
          className="inline-flex h-9 items-center rounded-full bg-surface px-4 text-[12.5px] font-semibold text-ink-soft hover:text-ink disabled:opacity-60"
        >
          {locating ? h.locating : h.nearMe}
        </button>
        {locError ? <span className="text-[12.5px] text-ink-faint">{h.noLocation}</span> : null}
      </div>
      <div
        ref={box}
        className="h-[clamp(320px,62vh,720px)] w-full overflow-hidden rounded-3xl bg-surface"
        role="region"
        aria-label={h.tabMap}
      />
      {pins.length === 0 ? <p className="mt-2 text-[13px] text-ink-faint">{h.empty}</p> : null}
    </div>
  );
}

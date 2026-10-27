import { router } from "expo-router";
import { useMemo } from "react";
import { TurboModuleRegistry, View } from "react-native";
import { MAP_HOME, MAP_STYLE, pinsBounds, pinsGeoJson, type Pin } from "@/components/gym-map-data";
import { useTheme } from "@/lib/theme";

// The gym map — the web's GymMap (components/gym-map.tsx) on the phone:
// MapLibre over OpenFreeMap's styles (no key, no quota), every gym a gold dot,
// the reader's own gym larger, close gyms grouped into a counted circle; a dot
// opens the gym. The browser preview draws the same map with maplibre-gl
// (gym-map.web.tsx).
//
// MapLibre is a native module that Expo Go does not carry, and the package
// throws the moment it is imported without it — so it is required only when
// the build has it. In Expo Go GYM_MAP_AVAILABLE is false and the gyms screen
// hides its Map button; a development or store build has the map.

export const GYM_MAP_AVAILABLE = TurboModuleRegistry.get("MLRNCameraModule") != null;

type MapLibre = typeof import("@maplibre/maplibre-react-native");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ML: MapLibre | null = GYM_MAP_AVAILABLE ? require("@maplibre/maplibre-react-native") : null;

export function GymMap({ pins, homeId, height = 360 }: { pins: Pin[]; homeId: string | null; height?: number }) {
  const { color, dark } = useTheme();
  const data = useMemo(() => pinsGeoJson(pins, homeId), [pins, homeId]);
  if (!ML) return null;
  const { Camera, GeoJSONSource, Layer, Map } = ML;
  const bounds = pinsBounds(pins);
  const one = pins.length === 1 ? pins[0]! : null;
  return (
    <View style={{ height, borderRadius: 16, overflow: "hidden" }}>
      <Map style={{ flex: 1 }} mapStyle={dark ? MAP_STYLE.dark : MAP_STYLE.light}>
        <Camera
          initialViewState={bounds
            ? { bounds, padding: { top: 60, right: 60, bottom: 60, left: 60 } }
            : one ? { center: [one.lng, one.lat], zoom: 13 } : { center: MAP_HOME, zoom: 5.6 }}
          maxZoom={17}
        />
        <GeoJSONSource
          id="gyms"
          data={data}
          cluster
          clusterRadius={50}
          clusterMaxZoom={14}
          onPress={(e) => {
            const id = e.nativeEvent.features[0]?.properties?.id;
            if (typeof id === "string") router.push({ pathname: "/gym/[id]", params: { id } });
          }}
        >
          <Layer id="clusters" type="circle" filter={["has", "point_count"]}
            paint={{ "circle-color": color.surface, "circle-stroke-color": color.accent, "circle-stroke-width": 2, "circle-radius": ["step", ["get", "point_count"], 16, 10, 20, 50, 26] }} />
          <Layer id="cluster-count" type="symbol" filter={["has", "point_count"]}
            layout={{ "text-field": ["get", "point_count_abbreviated"], "text-size": 12, "text-font": ["Noto Sans Bold"] }} paint={{ "text-color": color.ink }} />
          <Layer id="gym" type="circle" filter={["!", ["has", "point_count"]]}
            paint={{ "circle-color": color.accent, "circle-radius": ["case", ["==", ["get", "home"], 1], 10, 7], "circle-stroke-color": ["case", ["==", ["get", "home"], 1], color.ink, color.accentFg], "circle-stroke-width": 2 }} />
        </GeoJSONSource>
      </Map>
    </View>
  );
}

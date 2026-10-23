import { dark, fontSize, light, minTouchTarget, radius, space, type ColorTokens } from "@healthapp/ui-tokens";
import { useColorScheme } from "react-native";

// The web's palette (packages/ui-tokens mirrors apps/web/app/globals.css, and a
// test keeps them equal). Like the web, the app follows the device; dark is the
// brand look and the fallback when the device says nothing.
export type Theme = { dark: boolean; color: ColorTokens };

export function useTheme(): Theme {
  const scheme = useColorScheme();
  return scheme === "light" ? { dark: false, color: light } : { dark: true, color: dark };
}

export { fontSize, minTouchTarget, radius, space };

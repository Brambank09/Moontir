import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  surface: "#0C0E14",
  onSurface: "#F4F5F7",
  surfaceSecondary: "#151821",
  onSurfaceSecondary: "#C5C8D0",
  surfaceTertiary: "#1F2330",
  onSurfaceTertiary: "#8F94A3",
  surfaceInverse: "#F4F5F7",
  onSurfaceInverse: "#0C0E14",
  muted: "#8F94A3",
  brand: "#3B82F6",
  onBrand: "#FFFFFF",
  brandPrimary: "#2563EB",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#1D4ED8",
  onBrandSecondary: "#FFFFFF",
  brandTertiary: "rgba(37, 99, 235, 0.15)",
  onBrandTertiary: "#60A5FA",
  success: "#10B981",
  onSuccess: "#FFFFFF",
  warning: "#F59E0B",
  onWarning: "#FFFFFF",
  error: "#EF4444",
  onError: "#FFFFFF",
  info: "#3B82F6",
  onInfo: "#FFFFFF",
  border: "rgba(255, 255, 255, 0.08)",
  borderStrong: "rgba(37, 99, 235, 0.5)",
  divider: "rgba(255, 255, 255, 0.05)",
  moonGlow: "#93C5FD",
  overlay: "rgba(0, 0, 0, 0.65)",
};

export type ThemeColors = typeof light;
export const defaultScheme = "light" satisfies ColorScheme;
export const themes: { light: ThemeColors; dark?: ThemeColors } = { light };

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme);
}

setColorScheme(themes.dark ? null : defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = system && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}
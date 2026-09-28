import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";
import { storage } from "@/src/utils/storage";

export type ColorScheme = "light" | "dark";
export type ThemeMode = "system" | "light" | "dark";

// Palette derived from the provided brand board:
//   #D8E2AE (matcha) · #EBF0D5 (mist) · #F5F0E6 (cream) · #403A35 (charcoal)

const light = {
  surface: "#F5F0E6",
  onSurface: "#403A35",
  surfaceSecondary: "#EBF0D5",
  onSurfaceSecondary: "#605852",
  surfaceTertiary: "#FFFFFF",
  onSurfaceTertiary: "#403A35",
  surfaceInverse: "#403A35",
  onSurfaceInverse: "#F5F0E6",
  muted: "#8B837C",
  brand: "#403A35",
  onBrand: "#F5F0E6",
  brandPrimary: "#403A35",
  onBrandPrimary: "#F5F0E6",
  brandSecondary: "#605852",
  onBrandSecondary: "#F5F0E6",
  brandTertiary: "#D8E2AE",
  onBrandTertiary: "#403A35",
  success: "#7A8F4A",
  onSuccess: "#F5F0E6",
  warning: "#C48A2E",
  onWarning: "#F5F0E6",
  error: "#B85450",
  onError: "#F5F0E6",
  info: "#605852",
  onInfo: "#F5F0E6",
  border: "rgba(64, 58, 53, 0.10)",
  borderStrong: "rgba(64, 58, 53, 0.25)",
  divider: "rgba(64, 58, 53, 0.08)",
  moonGlow: "#7A8F4A",
  overlay: "rgba(64, 58, 53, 0.55)",
};

const dark: typeof light = {
  surface: "#1F1D1B",
  onSurface: "#F5F0E6",
  surfaceSecondary: "#2B2825",
  onSurfaceSecondary: "#D8D1C8",
  surfaceTertiary: "#3A3632",
  onSurfaceTertiary: "#F5F0E6",
  surfaceInverse: "#F5F0E6",
  onSurfaceInverse: "#1F1D1B",
  muted: "#8B837C",
  brand: "#D8E2AE",
  onBrand: "#1F1D1B",
  brandPrimary: "#D8E2AE",
  onBrandPrimary: "#1F1D1B",
  brandSecondary: "#EBF0D5",
  onBrandSecondary: "#1F1D1B",
  brandTertiary: "#3A3632",
  onBrandTertiary: "#D8E2AE",
  success: "#B8CA7A",
  onSuccess: "#1F1D1B",
  warning: "#E1B36A",
  onWarning: "#1F1D1B",
  error: "#E38A85",
  onError: "#1F1D1B",
  info: "#D8D1C8",
  onInfo: "#1F1D1B",
  border: "rgba(245, 240, 230, 0.08)",
  borderStrong: "rgba(216, 226, 174, 0.35)",
  divider: "rgba(245, 240, 230, 0.06)",
  moonGlow: "#D8E2AE",
  overlay: "rgba(0, 0, 0, 0.65)",
};

export type ThemeColors = typeof light;
export const themes: { light: ThemeColors; dark: ThemeColors } = { light, dark };
export const defaultScheme: ColorScheme = "light";
const MODE_KEY = "moontir_theme_mode";

type ThemeContextValue = {
  scheme: ColorScheme;
  colors: ThemeColors;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  cycleMode: () => ThemeMode;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const saved = await storage.getItem<ThemeMode | null>(MODE_KEY, null);
      if (saved === "light" || saved === "dark" || saved === "system") setModeState(saved);
      setReady(true);
    })();
  }, []);

  const scheme: ColorScheme = mode === "system" ? (system === "dark" ? "dark" : "light") : mode;
  useEffect(() => {
    if (!ready) return;
    // Android's native AppearanceModule.setColorScheme rejects null (Kotlin non-null param),
    // so only force a scheme when the user picks Light or Dark. "System" simply leaves the
    // OS default alone.
    if (mode === "light" || mode === "dark") {
      try { Appearance.setColorScheme?.(mode); } catch { /* ignore */ }
    }
  }, [mode, ready]);

  const value = useMemo<ThemeContextValue>(() => ({
    scheme,
    colors: themes[scheme],
    mode,
    setMode: (next) => { setModeState(next); void storage.setItem(MODE_KEY, next); },
    cycleMode: () => {
      const next: ThemeMode = mode === "system" ? "light" : mode === "light" ? "dark" : "system";
      setModeState(next);
      void storage.setItem(MODE_KEY, next);
      return next;
    },
  }), [scheme, mode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const ctx = useContext(ThemeContext);
  if (ctx) return { scheme: ctx.scheme, colors: ctx.colors };
  return { scheme: defaultScheme, colors: themes[defaultScheme] };
}

export function useThemeMode(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useThemeMode must be used within ThemeModeProvider");
  return ctx;
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}

import { useTheme } from "next-themes";
import { useMemo } from "react";

/**
 * Colours for things that cannot read CSS variables: Recharts SVG props and
 * Leaflet tile/marker options. Keeping them in one place means light mode does
 * not need a hardcoded conditional at every call site.
 */
export interface ThemeTokens {
  isDark: boolean;
  /** Carto basemap matching the current theme. */
  basemapUrl: string;
  chart: {
    axis: string;
    grid: string;
    series: string;
    tooltip: { background: string; border: string; borderRadius: number; color: string };
  };
  /** EPA LMOP operational-status marker colours. */
  status: { open: string; closed: string; unknown: string };
}

const DARK: Omit<ThemeTokens, "isDark"> = {
  basemapUrl: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  chart: {
    axis: "hsl(150 8% 58%)",
    grid: "hsl(150 11% 24%)",
    series: "hsl(152 34% 44%)",
    tooltip: {
      background: "hsl(150 14% 15%)",
      border: "1px solid hsl(150 11% 24%)",
      borderRadius: 8,
      color: "hsl(150 6% 92%)",
    },
  },
  status: { open: "hsl(152 40% 52%)", closed: "hsl(150 8% 45%)", unknown: "hsl(38 92% 50%)" },
};

const LIGHT: Omit<ThemeTokens, "isDark"> = {
  basemapUrl: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  chart: {
    axis: "hsl(150 10% 40%)",
    grid: "hsl(150 9% 88%)",
    series: "hsl(152 42% 32%)",
    tooltip: {
      background: "hsl(0 0% 100%)",
      border: "1px solid hsl(150 9% 88%)",
      borderRadius: 8,
      color: "hsl(150 22% 14%)",
    },
  },
  status: { open: "hsl(152 42% 32%)", closed: "hsl(150 8% 55%)", unknown: "hsl(38 92% 38%)" },
};

export function useThemeTokens(): ThemeTokens {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== "light";
  return useMemo(() => ({ isDark, ...(isDark ? DARK : LIGHT) }), [isDark]);
}

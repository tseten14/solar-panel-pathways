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
    axis: "hsl(215 18% 68%)",
    grid: "hsl(222 28% 22%)",
    series: "hsl(210 80% 62%)",
    tooltip: {
      background: "hsl(222 42% 12%)",
      border: "1px solid hsl(222 28% 22%)",
      borderRadius: 8,
      color: "hsl(210 25% 96%)",
    },
  },
  status: { open: "hsl(152 40% 52%)", closed: "hsl(215 16% 48%)", unknown: "hsl(38 92% 50%)" },
};

const LIGHT: Omit<ThemeTokens, "isDark"> = {
  basemapUrl: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  chart: {
    axis: "hsl(215 14% 40%)",
    grid: "hsl(214 18% 86%)",
    series: "hsl(222 58% 32%)",
    tooltip: {
      background: "hsl(0 0% 100%)",
      border: "1px solid hsl(214 18% 86%)",
      borderRadius: 8,
      color: "hsl(222 35% 14%)",
    },
  },
  status: { open: "hsl(152 42% 32%)", closed: "hsl(150 8% 55%)", unknown: "hsl(38 92% 38%)" },
};

export function useThemeTokens(): ThemeTokens {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== "light";
  return useMemo(() => ({ isDark, ...(isDark ? DARK : LIGHT) }), [isDark]);
}

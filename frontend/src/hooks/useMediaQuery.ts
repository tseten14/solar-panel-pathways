import { useEffect, useState } from "react";

/**
 * Subscribe to a CSS media query from React.
 *
 * Used where a layout decision cannot be expressed in Tailwind alone — the
 * Solar Detections page has to *decide* whether its side panels start open,
 * which is state, not styling.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** True on viewports wide enough to show map + queue + agent panel side by side. */
export const WIDE_LAYOUT_QUERY = "(min-width: 1280px)";

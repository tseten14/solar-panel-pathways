import { useMemo, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import { AlertTriangle, MapPin, Recycle, CalendarClock, Info } from "lucide-react";
import { DataFreshnessBadge } from "@/components/DataFreshnessBadge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLandfills } from "@/hooks/useLandfills";
import { useSolarCohorts, useSolarStatsByState, useSolarTechMix } from "@/hooks/useSolarData";
import { DataErrorState, DataLoadingState } from "@/components/DataLoadingState";
import { useThemeTokens } from "@/hooks/useThemeTokens";
import { WASTE_HORIZON_YEARS, computeStateCoverage } from "@/lib/state-coverage";
import {
  PANEL_LIFETIME_YEARS,
  TONNES_PER_MW,
  averageFleetAge,
  projectWaste,
  summariseHazard,
} from "@/lib/pv-waste";

/** Panel-waste tonnages span kilotonnes to megatonnes; keep the tile readable. */
function formatTonnes(t: number) {
  if (t >= 1e6) return <>{(t / 1e6).toFixed(1)}<span className="text-lg text-muted-foreground"> Mt</span></>;
  if (t >= 1e3) return <>{Math.round(t / 1e3).toLocaleString()}<span className="text-lg text-muted-foreground"> kt</span></>;
  return <>{Math.round(t).toLocaleString()}<span className="text-lg text-muted-foreground"> t</span></>;
}

export default function MLPredictions() {
  const { data: landfills = [], isLoading: landfillsLoading, isError: landfillsError, refetch } = useLandfills();
  const { data: solarStats = [], isLoading: solarLoading, isError: solarError } = useSolarStatsByState();
  const { data: cohorts = [], isLoading: cohortsLoading } = useSolarCohorts();
  const { data: techMix = [] } = useSolarTechMix();
  const { chart } = useThemeTokens();
  const { axis: AXIS, grid: GRID, series: SERIES, tooltip: TOOLTIP_STYLE } = chart;

  const coverage = useMemo(
    () => computeStateCoverage(landfills, solarStats, cohorts),
    [landfills, solarStats, cohorts],
  );

  const [selectedState, setSelectedState] = useState("CA");
  const effectiveState = coverage.some((c) => c.state === selectedState)
    ? selectedState
    : coverage[0]?.state ?? "CA";
  const stateRow = coverage.find((p) => p.state === effectiveState);

  const wasteCurve = useMemo(
    () => projectWaste(cohorts, { state: effectiveState, horizonYears: WASTE_HORIZON_YEARS }),
    [cohorts, effectiveState],
  );
  const fleetAge = useMemo(() => averageFleetAge(cohorts, effectiveState), [cohorts, effectiveState]);
  const hazard = useMemo(() => summariseHazard(techMix), [techMix]);

  // Top states by modelled retirement tonnage over the horizon — all from real cohorts.
  const wasteByState = useMemo(
    () =>
      [...coverage]
        .filter((c) => c.projectedWasteTonnes > 0)
        .sort((a, b) => b.projectedWasteTonnes - a.projectedWasteTonnes)
        .slice(0, 25)
        .map((c) => ({ state: c.state, tonnes: c.projectedWasteTonnes })),
    [coverage],
  );

  const wasteDeserts = coverage.filter((p) => p.wasteDesert);

  const isLoading = landfillsLoading || solarLoading || cohortsLoading;
  const isError = landfillsError || solarError;

  if (isLoading) {
    return (
      <div className="p-6">
        <DataLoadingState message="Loading EPA landfill and USGS solar data…" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <DataErrorState
          message="Could not load live data from EPA LMOP or USGS USPVDB. Check your network connection and try again."
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-foreground">State Coverage Analysis</h1>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="Methodology">
                  <Info className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-sm">
                Landfill counts, capacities and solar capacity are measured (EPA LMOP, USGS USPVDB).
                Retirement tonnage is modelled by shifting each real install-year cohort forward{" "}
                {PANEL_LIFETIME_YEARS} years at {TONNES_PER_MW} t/MW (IRENA/IEA-PVPS). No tipping-fee
                or PV-acceptance data is shown — no public API publishes it.
              </TooltipContent>
            </Tooltip>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Disposal capacity vs. modelled panel retirement · EPA LMOP + USGS USPVDB
          </p>
          <DataFreshnessBadge />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Analyze state:</span>
          <Select value={effectiveState} onValueChange={setSelectedState}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {coverage.map((c) => (
                <SelectItem key={c.state} value={c.state}>
                  {c.state}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {stateRow && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="glass-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <Recycle className="h-4 w-4 text-primary" />
              <span className="stat-label">{WASTE_HORIZON_YEARS}-yr Panel Waste</span>
            </div>
            <p className="stat-value text-foreground">
              {formatTonnes(stateRow.projectedWasteTonnes)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Modelled from USPVDB install years</p>
          </div>

          <div className="glass-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <CalendarClock className="h-4 w-4 text-primary" />
              <span className="stat-label">Peak Retirement</span>
            </div>
            <p className="stat-value text-foreground">{stateRow.peakRetirementYear ?? "—"}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Fleet avg {fleetAge != null ? `${fleetAge}y` : "—"} old · retires at {PANEL_LIFETIME_YEARS}y
            </p>
          </div>

          <div className="glass-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <MapPin className="h-4 w-4 text-primary" />
              <span className="stat-label">Landfill Headroom</span>
            </div>
            <p className="stat-value text-foreground">
              {stateRow.remainingCapacityTons != null
                ? `${(stateRow.remainingCapacityTons / 1e6).toFixed(1)}M`
                : "—"}
              <span className="text-lg text-muted-foreground"> t</span>
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {stateRow.wasteToCapacityPct != null
                ? `${WASTE_HORIZON_YEARS}-yr panel waste = ${stateRow.wasteToCapacityPct}% of headroom`
                : "Capacity not reported by LMOP"}
            </p>
          </div>

          <div className="glass-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-primary" />
              <span className="stat-label">Disposal Density</span>
            </div>
            <p className="stat-value text-foreground">
              {stateRow.landfillsPerGw}
              <span className="text-lg text-muted-foreground"> /GW</span>
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {stateRow.landfillCount} open sites · {Math.round(stateRow.solarMw).toLocaleString()} MW
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-foreground">
            Projected annual panel retirement — {effectiveState}
          </h3>
          <p className="text-xs text-muted-foreground mb-4">
            Real install-year cohorts shifted {PANEL_LIFETIME_YEARS} years · modelled
          </p>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={wasteCurve}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="year" stroke={AXIS} fontSize={12} />
              <YAxis
                stroke={AXIS}
                fontSize={12}
                tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
              />
              <RTooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(v: number) => [`${Math.round(v).toLocaleString()} t`, "Retiring"]}
              />
              <Area
                type="monotone"
                dataKey="retiringTonnes"
                stroke={SERIES}
                fill={SERIES}
                fillOpacity={0.22}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-foreground">Modelled {WASTE_HORIZON_YEARS}-year waste by state</h3>
          <p className="text-xs text-muted-foreground mb-4">Top 25 states by retiring tonnage</p>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={wasteByState}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="state" stroke={AXIS} fontSize={11} interval={0} />
              <YAxis
                stroke={AXIS}
                fontSize={12}
                tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
              />
              <RTooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(v: number) => [`${Math.round(v).toLocaleString()} t`, `${WASTE_HORIZON_YEARS}-yr waste`]}
              />
              <Bar dataKey="tonnes" fill={SERIES} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {hazard.length > 0 && (
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-foreground">
            National module chemistry — hazard profile
          </h3>
          <p className="text-xs text-muted-foreground mb-4">
            USGS USPVDB <code className="font-mono">p_tech_sec</code> · determines which TCLP metal
            governs disposal
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {hazard.map((h) => (
              <div key={h.hazardClass} className="rounded-lg border border-border/60 bg-background/20 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-foreground capitalize">
                    {h.hazardClass.replace("-", " ")}
                  </span>
                  <span className="font-mono text-xs text-primary">{h.shareOfMw}%</span>
                </div>
                <p className="font-mono text-xs text-muted-foreground mt-1">
                  {h.capacityMw.toLocaleString()} MW · {h.facilityCount.toLocaleString()} plants
                </p>
                <p className="text-[11px] text-muted-foreground mt-1.5">{h.note}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {wasteDeserts.length > 0 && (
        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <h3 className="text-sm font-semibold text-foreground">Waste Desert States</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Fewer than 3 open landfills, or the nearest is over 100 mi from a large solar fleet
          </p>
          <div className="flex flex-wrap gap-2">
            {wasteDeserts.map((d) => (
              <div key={d.state} className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{d.state}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {d.landfillCount} open
                  </Badge>
                </div>
                <p className="font-mono text-[10px] text-muted-foreground mt-0.5">
                  {d.landfillsPerGw}/GW · {Math.round(d.solarMw).toLocaleString()} MW
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

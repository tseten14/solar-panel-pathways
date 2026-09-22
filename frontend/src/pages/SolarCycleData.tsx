/**
 * SolarCycle's own landfill survey — real call results, not modelled data.
 *
 * Answers the customer questions directly: which landfills near me take
 * panels, which refuse, and what disposal costs. The table underneath keeps
 * every field from the survey, including contacts and call notes.
 */
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Building2,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleX,
  DollarSign,
  HelpCircle,
  Search,
  Sparkles,
} from "lucide-react";
import surveyCsv from "@/data/solarcycle-landfill-survey.csv?raw";
import SurveyAssistantPanel from "@/components/solarcycle/SurveyAssistantPanel";
import { StatCard } from "@/components/StatCard";
import { Button } from "@/components/ui/button";
import { WIDE_LAYOUT_QUERY } from "@/hooks/useMediaQuery";
import { PageContainer, PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useThemeTokens } from "@/hooks/useThemeTokens";
import {
  PV_STATUS_LABEL,
  PV_STATUS_ORDER,
  type PvStatus,
  type SurveySite,
  parseSurvey,
  pricedSites,
  summariseByState,
  summariseByType,
} from "@/lib/solarcycle";

const SITES = parseSurvey(surveyCsv);

const STATE_NAMES: Record<string, string> = {
  AZ: "Arizona",
  NV: "Nevada",
  NM: "New Mexico",
  TX: "Texas",
};

const STATUS_COLOURS: Record<"dark" | "light", Record<PvStatus, string>> = {
  dark: {
    accepts: "hsl(152 45% 50%)",
    declines: "hsl(0 65% 60%)",
    unknown: "hsl(38 92% 55%)",
    not_surveyed: "hsl(150 6% 38%)",
  },
  light: {
    accepts: "hsl(152 50% 34%)",
    declines: "hsl(0 65% 48%)",
    unknown: "hsl(38 92% 42%)",
    not_surveyed: "hsl(150 6% 72%)",
  },
};

const STATUS_BADGE: Record<PvStatus, string> = {
  accepts: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  declines: "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400",
  unknown: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  not_surveyed: "border-border text-muted-foreground",
};

type SortKey = "state" | "name" | "type" | "pvStatus" | "costPerPanel";

const money = (n: number) => `$${n.toFixed(2)}`;

function stateLabel(code: string) {
  return STATE_NAMES[code] ?? code;
}

export default function SolarCycleData() {
  const { isDark, chart } = useThemeTokens();
  const { axis: AXIS, grid: GRID, tooltip: TOOLTIP_STYLE, series: SERIES } = chart;
  const colours = STATUS_COLOURS[isDark ? "dark" : "light"];

  const byState = useMemo(() => summariseByState(SITES), []);
  const byType = useMemo(() => summariseByType(SITES), []);
  const priced = useMemo(() => pricedSites(SITES), []);

  const counts = useMemo(() => {
    const c: Record<PvStatus, number> = { accepts: 0, declines: 0, unknown: 0, not_surveyed: 0 };
    for (const s of SITES) c[s.pvStatus]++;
    return c;
  }, []);
  const surveyed = SITES.length - counts.not_surveyed;

  const priceChart = useMemo(() => {
    const nameCounts = new Map<string, number>();
    for (const s of priced) nameCounts.set(s.name, (nameCounts.get(s.name) ?? 0) + 1);
    return priced.map((s) => ({
      label:
        nameCounts.get(s.name)! > 1 && s.restrictions
          ? `${s.name} (${s.restrictions}), ${s.state}`
          : `${s.name}, ${s.state}`,
      perPanel: s.costPerPanel!,
      perTon: s.cost,
      restrictions: s.restrictions,
    }));
  }, [priced]);

  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | PvStatus>("all");
  const [sortKey, setSortKey] = useState<SortKey>("state");
  const [sortAsc, setSortAsc] = useState(true);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = SITES.filter(
      (s) =>
        (stateFilter === "all" || s.state === stateFilter) &&
        (statusFilter === "all" || s.pvStatus === statusFilter) &&
        (!q ||
          s.name.toLowerCase().includes(q) ||
          (s.location ?? "").toLowerCase().includes(q) ||
          (s.owner ?? "").toLowerCase().includes(q)),
    );
    const dir = sortAsc ? 1 : -1;
    return rows.sort((a, b) => {
      if (sortKey === "costPerPanel") {
        // Unpriced sites always sink to the bottom.
        if (a.costPerPanel == null) return b.costPerPanel == null ? 0 : 1;
        if (b.costPerPanel == null) return -1;
        return (a.costPerPanel - b.costPerPanel) * dir;
      }
      if (sortKey === "pvStatus") {
        return (PV_STATUS_ORDER.indexOf(a.pvStatus) - PV_STATUS_ORDER.indexOf(b.pvStatus)) * dir;
      }
      return String(a[sortKey] ?? "").localeCompare(String(b[sortKey] ?? "")) * dir || a.name.localeCompare(b.name);
    });
  }, [search, stateFilter, statusFilter, sortKey, sortAsc]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) =>
    sortKey === col ? (
      sortAsc ? <ChevronUp className="ml-1 inline h-3 w-3" /> : <ChevronDown className="ml-1 inline h-3 w-3" />
    ) : null;

  const [assistantOpen, setAssistantOpen] = useState(() => window.matchMedia(WIDE_LAYOUT_QUERY).matches);

  const minPrice = priced[0]?.costPerPanel;
  const maxPrice = priced[priced.length - 1]?.costPerPanel;
  const states = byState.map((s) => s.state);

  return (
    <div className="flex items-start">
      <div className="min-w-0 flex-1">
        <PageContainer>
          <PageHeader
            title="SolarCycle Data"
            subtitle={
              <>
                SolarCycle called landfills in {states.map(stateLabel).join(", ")} to ask whether they accept end-of-life
                solar panels. Prices are as quoted in July 2024. Sites marked &ldquo;not yet surveyed&rdquo; are on the
                call list but have no answer recorded yet.
              </>
            }
            actions={
              <>
                <Badge variant="outline" className="text-xs">SolarCycle survey</Badge>
                <Badge variant="outline" className="text-xs">Prices as of July 2024</Badge>
                {!assistantOpen && (
                  <Button variant="outline" size="sm" onClick={() => setAssistantOpen(true)}>
                    <Sparkles className="mr-2 h-3.5 w-3.5 text-primary" /> Ask the data
                  </Button>
                )}
              </>
            }
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard
              icon={Building2}
              label="Sites listed"
              value={SITES.length}
              subtitle={`${surveyed} contacted · ${states.length} states`}
            />
            <StatCard
              icon={CircleCheck}
              label="Accept PV panels"
              value={counts.accepts}
              subtitle={surveyed ? `${Math.round((counts.accepts / surveyed) * 100)}% of contacted sites` : undefined}
              highlight
            />
            <StatCard
              icon={CircleX}
              label="Do not accept"
              value={counts.declines}
              subtitle={`${counts.unknown} more gave no clear answer`}
            />
            <StatCard
              icon={HelpCircle}
              label="Not yet surveyed"
              value={counts.not_surveyed}
              subtitle="On the call list, no answer yet"
            />
            <StatCard
              icon={DollarSign}
              label="Cost per panel"
              value={minPrice != null && maxPrice != null ? `${money(minPrice)}–${money(maxPrice)}` : "—"}
              subtitle={`${priced.length} sites gave a price`}
            />
          </div>

          <div className="glass-card p-5">
            <h3 className="text-sm font-semibold text-foreground">Do landfills accept solar panels? By state</h3>
            <p className="mb-4 text-xs text-muted-foreground">
              Each bar is every listed landfill in that state, split by the answer SolarCycle received.
            </p>
            <ResponsiveContainer width="100%" height={Math.max(220, byState.length * 56)}>
              <BarChart data={byState} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                <XAxis type="number" stroke={AXIS} fontSize={12} allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="state"
                  stroke={AXIS}
                  fontSize={12}
                  width={90}
                  tickFormatter={stateLabel}
                />
                <RTooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelFormatter={(code: string) => stateLabel(code)}
                  formatter={(v: number, key: string) => [`${v} sites`, PV_STATUS_LABEL[key as PvStatus]]}
                />
                <Legend formatter={(key: string) => PV_STATUS_LABEL[key as PvStatus]} wrapperStyle={{ fontSize: 12 }} />
                {PV_STATUS_ORDER.map((status, i) => (
                  <Bar
                    key={status}
                    dataKey={status}
                    stackId="pv"
                    fill={colours[status]}
                    radius={i === PV_STATUS_ORDER.length - 1 ? [0, 4, 4, 0] : 0}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="glass-card p-5 lg:col-span-2">
              <h3 className="text-sm font-semibold text-foreground">Disposal cost per panel</h3>
              <p className="mb-4 text-xs text-muted-foreground">
                Landfills that quoted a price, cheapest first. Per-panel figure is SolarCycle&rsquo;s estimate from the
                quoted price per ton.
              </p>
              {priceChart.length ? (
                <ResponsiveContainer width="100%" height={Math.max(220, priceChart.length * 34)}>
                  <BarChart data={priceChart} layout="vertical" margin={{ left: 8, right: 48 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                    <XAxis type="number" stroke={AXIS} fontSize={12} tickFormatter={(v: number) => `$${v}`} />
                    <YAxis type="category" dataKey="label" stroke={AXIS} fontSize={11} width={260} interval={0} />
                    <RTooltip
                      contentStyle={TOOLTIP_STYLE}
                      formatter={(v: number, _k, item) => {
                        const perTon = item.payload.perTon as number | null;
                        return [`${money(v)} per panel${perTon != null ? ` · $${perTon}/ton` : ""}`, "Cost"];
                      }}
                    />
                    <Bar
                      dataKey="perPanel"
                      fill={colours.accepts}
                      radius={[0, 4, 4, 0]}
                      label={{ position: "right", fill: AXIS, fontSize: 11, formatter: (v: number) => money(v) }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-muted-foreground">No prices recorded yet.</p>
              )}
            </div>

            <div className="glass-card p-5">
              <h3 className="text-sm font-semibold text-foreground">Who runs these landfills</h3>
              <p className="mb-4 text-xs text-muted-foreground">
                Operator type, for the {byType.reduce((n, t) => n + t.count, 0)} sites where it was recorded.
              </p>
              <ResponsiveContainer width="100%" height={Math.max(200, byType.length * 44)}>
                <BarChart data={byType} layout="vertical" margin={{ left: 8, right: 32 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                  <XAxis type="number" stroke={AXIS} fontSize={12} allowDecimals={false} />
                  <YAxis type="category" dataKey="type" stroke={AXIS} fontSize={12} width={90} />
                  <RTooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`${v} sites`, "Landfills"]} />
                  <Bar
                    dataKey="count"
                    fill={SERIES}
                    radius={[0, 4, 4, 0]}
                    label={{ position: "right", fill: AXIS, fontSize: 11 }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Find a landfill</h2>
              <p className="text-xs text-muted-foreground">
                Every site from the survey, with contact details, restrictions and call notes.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full max-w-sm">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search name, city or operator…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={stateFilter} onValueChange={setStateFilter}>
                <SelectTrigger className="w-40" aria-label="Filter by state">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All states</SelectItem>
                  {states.map((s) => (
                    <SelectItem key={s} value={s}>
                      {stateLabel(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "all" | PvStatus)}>
                <SelectTrigger className="w-48" aria-label="Filter by PV acceptance">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any PV answer</SelectItem>
                  {PV_STATUS_ORDER.map((s) => (
                    <SelectItem key={s} value={s}>
                      {PV_STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="glass-card overflow-hidden">
              <div className="max-h-[70vh] overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky top-0 cursor-pointer bg-card" onClick={() => handleSort("state")}>
                        State
                        <SortIcon col="state" />
                      </TableHead>
                      <TableHead className="sticky top-0 cursor-pointer bg-card" onClick={() => handleSort("name")}>
                        Landfill
                        <SortIcon col="name" />
                      </TableHead>
                      <TableHead className="sticky top-0 cursor-pointer bg-card" onClick={() => handleSort("type")}>
                        Type
                        <SortIcon col="type" />
                      </TableHead>
                      <TableHead className="sticky top-0 cursor-pointer bg-card" onClick={() => handleSort("pvStatus")}>
                        Accepts PV?
                        <SortIcon col="pvStatus" />
                      </TableHead>
                      <TableHead className="sticky top-0 bg-card">Restrictions</TableHead>
                      <TableHead
                        className="sticky top-0 cursor-pointer bg-card text-right"
                        onClick={() => handleSort("costPerPanel")}
                      >
                        $/panel
                        <SortIcon col="costPerPanel" />
                      </TableHead>
                      <TableHead className="sticky top-0 bg-card">Operator &amp; contact</TableHead>
                      <TableHead className="sticky top-0 bg-card">Location</TableHead>
                      <TableHead className="sticky top-0 bg-card">Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((s) => (
                      <SiteRow key={s.id} site={s} />
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="border-t border-border/50 p-3 text-xs text-muted-foreground">
                Showing {filtered.length} of {SITES.length} sites.
              </p>
            </div>
          </div>
        </PageContainer>
      </div>

      {assistantOpen && (
        <div className="sticky top-0 h-[calc(100vh-3rem)] w-[320px] shrink-0 overflow-hidden border-l border-border/70 2xl:w-[380px]">
          <SurveyAssistantPanel sites={SITES} onCollapse={() => setAssistantOpen(false)} />
        </div>
      )}
    </div>
  );
}

function SiteRow({ site: s }: { site: SurveySite }) {
  const notes = [
    s.notes,
    s.callNotes && `Call notes: ${s.callNotes}`,
    s.acceptLqg && `Accepts LQG: ${s.acceptLqg}`,
  ].filter(Boolean) as string[];
  const website = s.website?.startsWith("http") ? s.website : null;

  return (
    <TableRow className="align-top hover:bg-muted/30">
      <TableCell className="font-mono text-xs">{s.state}</TableCell>
      <TableCell className="min-w-48 font-medium">
        {website ? (
          <a href={website} target="_blank" rel="noreferrer" className="hover:text-primary hover:underline">
            {s.name}
          </a>
        ) : (
          s.name
        )}
      </TableCell>
      <TableCell className="text-muted-foreground">{s.type ?? "—"}</TableCell>
      <TableCell>
        <Badge variant="outline" className={`whitespace-nowrap text-xs ${STATUS_BADGE[s.pvStatus]}`}>
          {PV_STATUS_LABEL[s.pvStatus]}
        </Badge>
        {s.pvRaw && s.pvRaw !== "Yes" && s.pvRaw !== "No" && s.pvRaw !== "?" && (
          <p className="mt-1 text-xs text-muted-foreground">{s.pvRaw}</p>
        )}
      </TableCell>
      <TableCell className="min-w-48 max-w-64 text-xs text-muted-foreground">{s.restrictions ?? "—"}</TableCell>
      <TableCell className="whitespace-nowrap text-right font-mono text-xs">
        {s.costPerPanel != null && s.costPerPanel > 0 ? (
          <>
            <span className="text-foreground">{money(s.costPerPanel)}</span>
            {s.cost != null && (
              <p className="text-muted-foreground">
                ${s.cost}/{s.costPer === "2000" && s.costUnit === "lbs" ? "ton" : [s.costPer, s.costUnit].filter(Boolean).join(" ")}
              </p>
            )}
          </>
        ) : s.cost != null ? (
          <span className="text-muted-foreground">
            {s.cost === 0 ? "Free" : `$${s.cost}`}
            {s.costPer ? ` / ${s.costPer.toLowerCase()}` : ""}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="min-w-48 text-xs">
        {s.owner && <p className="text-foreground">{s.owner}</p>}
        {s.phone && <p className="whitespace-pre-line text-muted-foreground">{s.phone}</p>}
        {s.altContact && <p className="text-muted-foreground">{s.altContact}</p>}
        {!s.owner && !s.phone && !s.altContact && <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell className="min-w-48 text-xs text-muted-foreground">{s.location ?? "—"}</TableCell>
      <TableCell className="min-w-56 max-w-80 text-xs text-muted-foreground">
        {notes.length ? notes.map((n) => <p key={n}>{n}</p>) : "—"}
      </TableCell>
    </TableRow>
  );
}

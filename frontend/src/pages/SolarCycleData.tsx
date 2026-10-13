/**
 * SolarCycle's landfill phone survey, told in plain language.
 *
 * The top of the page answers three questions a visitor can see without
 * reading a table: did the landfill say yes, how does that differ by state,
 * and what does one panel cost. The table underneath is the lookup.
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Search, Sparkles } from "lucide-react";
import surveyCsv from "@/data/solarcycle-landfill-survey.csv?raw";
import SurveyAssistantPanel from "@/components/solarcycle/SurveyAssistantPanel";
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
  type StateBreakdown,
  type SurveySite,
  parseSurvey,
  pricedSites,
  summariseByState,
} from "@/lib/solarcycle";

const SITES = parseSurvey(surveyCsv);

const STATE_NAMES: Record<string, string> = {
  AZ: "Arizona",
  NV: "Nevada",
  NM: "New Mexico",
  TX: "Texas",
};

const STATE_ORDER = ["AZ", "NV", "NM", "TX"];

/** Short labels for the story at the top. The table keeps the fuller wording. */
const STORY: Record<PvStatus, { title: string; hint: string }> = {
  accepts: { title: "Take panels", hint: "Said yes to old solar panels" },
  declines: { title: "Won't take them", hint: "Said no" },
  unknown: { title: "Unclear", hint: "Reached, but no clear yes or no" },
  not_surveyed: { title: "Not called yet", hint: "On the list, no answer recorded" },
};

const STATUS_COLOURS: Record<"dark" | "light", Record<PvStatus, string>> = {
  dark: {
    accepts: "hsl(152 45% 50%)",
    declines: "hsl(0 65% 60%)",
    unknown: "hsl(38 92% 55%)",
    not_surveyed: "hsl(222 18% 42%)",
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

type SortKey = "state" | "name" | "pvStatus" | "costPerPanel";

const money = (n: number) => `$${n.toFixed(2)}`;

function stateLabel(code: string) {
  return STATE_NAMES[code] ?? code;
}

function medianPrice(sites: SurveySite[]): number | null {
  if (sites.length === 0) return null;
  const mid = Math.floor(sites.length / 2);
  if (sites.length % 2 === 1) return sites[mid].costPerPanel!;
  return (sites[mid - 1].costPerPanel! + sites[mid].costPerPanel!) / 2;
}

const PRICE_BUCKETS: { label: string; hint: string; min: number; max: number }[] = [
  { label: "Under $2", hint: "Cheaper than a typical quote", min: 0, max: 2 },
  { label: "$2 to $4", hint: "Around the middle of the quotes", min: 2, max: 4 },
  { label: "$4 to $8", hint: "On the expensive side", min: 4, max: 8 },
  { label: "$8 or more", hint: "The highest quotes", min: 8, max: Infinity },
];

export default function SolarCycleData() {
  const { isDark } = useThemeTokens();
  const colours = STATUS_COLOURS[isDark ? "dark" : "light"];
  const navy = isDark ? "hsl(210 80% 62%)" : "hsl(222 58% 32%)";
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const byState = useMemo(() => {
    const rows = summariseByState(SITES);
    return STATE_ORDER.map((code) => rows.find((r) => r.state === code)).filter(
      (r): r is StateBreakdown => r != null,
    );
  }, []);
  const priced = useMemo(() => pricedSites(SITES), []);
  const cheapest = priced.slice(0, 5);
  const highest = priced[priced.length - 1]?.costPerPanel ?? null;

  const counts = useMemo(() => {
    const c: Record<PvStatus, number> = { accepts: 0, declines: 0, unknown: 0, not_surveyed: 0 };
    for (const s of SITES) c[s.pvStatus]++;
    return c;
  }, []);
  const surveyed = SITES.length - counts.not_surveyed;
  const yesShare = surveyed ? Math.round((counts.accepts / surveyed) * 100) : 0;
  const typical = medianPrice(priced);

  const coverage = useMemo(
    () =>
      byState.map((row) => {
        const called = row.total - row.not_surveyed;
        return {
          ...row,
          called,
          calledPct: Math.round((called / row.total) * 100),
          yesPct: called ? Math.round((row.accepts / called) * 100) : 0,
        };
      }),
    [byState],
  );
  const furthest = [...coverage].sort((a, b) => b.calledPct - a.calledPct)[0];
  const thinnest = [...coverage].sort((a, b) => a.calledPct - b.calledPct)[0];
  const mostYes = [...coverage].filter((row) => row.called > 0).sort((a, b) => b.yesPct - a.yesPct)[0];

  const byOperator = useMemo(() => {
    const map = new Map<string, { yes: number; called: number }>();
    for (const site of SITES) {
      if (!site.type || site.pvStatus === "not_surveyed") continue;
      const row = map.get(site.type) ?? { yes: 0, called: 0 };
      row.called += 1;
      if (site.pvStatus === "accepts") row.yes += 1;
      map.set(site.type, row);
    }
    return [...map.entries()]
      .map(([type, row]) => ({ type, ...row, yesPct: Math.round((row.yes / row.called) * 100) }))
      .sort((a, b) => b.called - a.called);
  }, []);

  const priceBuckets = useMemo(
    () =>
      PRICE_BUCKETS.map((bucket) => ({
        ...bucket,
        count: priced.filter((s) => s.costPerPanel! >= bucket.min && s.costPerPanel! < bucket.max).length,
      })),
    [priced],
  );
  const busiestBucket = Math.max(1, ...priceBuckets.map((b) => b.count));

  const priceByState = useMemo(
    () =>
      STATE_ORDER.map((code) => {
        const quotes = priced.filter((s) => s.state === code);
        const median = medianPrice(quotes);
        if (median == null) return null;
        return { state: code, median, count: quotes.length };
      }).filter((row): row is { state: string; median: number; count: number } => row != null),
    [priced],
  );
  const highestStateMedian = Math.max(1, ...priceByState.map((row) => row.median));

  const callOnly = (["accepts", "declines", "unknown"] as const).map((status) => ({
    status,
    count: counts[status],
  }));
  const accepting = useMemo(() => SITES.filter((site) => site.pvStatus === "accepts"), []);
  const withRestriction = accepting.filter((site) => {
    const text = site.restrictions?.trim().toLowerCase() ?? "";
    return text !== "" && text !== "none" && text !== "n/a" && text !== "na";
  }).length;
  const withPhone = accepting.filter((site) => Boolean(site.phone?.trim())).length;
  const tonQuotes = useMemo(
    () =>
      SITES.map((site) => site.cost)
        .filter((cost): cost is number => cost != null && cost > 0)
        .sort((a, b) => a - b),
    [],
  );
  const tonLow = tonQuotes[0];
  const tonHigh = tonQuotes[tonQuotes.length - 1];
  const tonTypical = tonQuotes.length
    ? tonQuotes.length % 2
      ? tonQuotes[Math.floor(tonQuotes.length / 2)]
      : (tonQuotes[tonQuotes.length / 2 - 1] + tonQuotes[tonQuotes.length / 2]) / 2
    : null;

  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | PvStatus>("all");
  const [sortKey, setSortKey] = useState<SortKey>("state");
  const [sortAsc, setSortAsc] = useState(true);
  const [assistantOpen, setAssistantOpen] = useState(() => window.matchMedia(WIDE_LAYOUT_QUERY).matches);

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

  const focusStatus = (status: PvStatus) => {
    setStatusFilter((current) => (current === status ? "all" : status));
    setStateFilter("all");
    document.getElementById("landfill-lookup")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const focusState = (code: string) => {
    setStateFilter((current) => (current === code ? "all" : code));
    document.getElementById("landfill-lookup")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const SortIcon = ({ col }: { col: SortKey }) =>
    sortKey === col ? (
      sortAsc ? <ChevronUp className="ml-1 inline h-3 w-3" /> : <ChevronDown className="ml-1 inline h-3 w-3" />
    ) : null;

  return (
    <div className="flex items-start">
      <div className="min-w-0 flex-1">
        <PageContainer>
          <PageHeader
            title="SolarCycle Data"
            subtitle="SolarCycle phoned landfills in Arizona, Nevada, New Mexico, and Texas and asked one question: will you take old solar panels? Prices are from July 2024."
            actions={
              !assistantOpen && (
                <Button variant="outline" size="sm" onClick={() => setAssistantOpen(true)}>
                  <Sparkles className="mr-2 h-3.5 w-3.5 text-primary" /> Ask the data
                </Button>
              )
            }
          />

          <section className="glass-card p-5 sm:p-6" aria-labelledby="answers-heading">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 id="answers-heading" className="text-lg font-semibold text-foreground">
                  What landfills said
                </h2>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                  {SITES.length} landfills are on the list. SolarCycle has reached {surveyed}. Of those calls,{" "}
                  <span className="font-medium text-foreground">{yesShare}% said yes</span>.
                </p>
              </div>
              <p className="text-xs text-muted-foreground">Click a color to see those landfills below.</p>
            </div>

            <div
              className="mt-5 flex h-10 overflow-hidden rounded-full bg-muted"
              role="img"
              aria-label={PV_STATUS_ORDER.map((status) => `${STORY[status].title}: ${counts[status]}`).join(", ")}
            >
              {PV_STATUS_ORDER.map((status) =>
                counts[status] > 0 ? (
                  <div
                    key={status}
                    className="h-full transition-[width] duration-700 ease-out"
                    style={{
                      width: drawn ? `${(counts[status] / SITES.length) * 100}%` : "0%",
                      background: colours[status],
                    }}
                  />
                ) : null,
              )}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {PV_STATUS_ORDER.map((status) => {
                const share = Math.round((counts[status] / SITES.length) * 100);
                const selected = statusFilter === status;
                return (
                  <button
                    key={status}
                    type="button"
                    onClick={() => focusStatus(status)}
                    aria-pressed={selected}
                    className={`rounded-lg border px-3 py-3 text-left transition-colors ${
                      selected ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted/60"
                    }`}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colours[status] }} />
                      {STORY[status].title}
                    </span>
                    <span className="mt-1 block font-mono text-2xl font-semibold tracking-tight text-foreground">
                      {counts[status]}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {share}% of the list · {STORY[status].hint}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="states-heading">
            <h2 id="states-heading" className="text-lg font-semibold text-foreground">
              Same answers, by state
            </h2>
            <p className="mt-1 mb-4 text-sm text-muted-foreground">
              Each bar is every landfill in that state. Green means they take panels. Click a state to filter the list.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {byState.map((row) => {
                const called = row.total - row.not_surveyed;
                const yes = called ? Math.round((row.accepts / called) * 100) : 0;
                const selected = stateFilter === row.state;
                return (
                  <button
                    key={row.state}
                    type="button"
                    onClick={() => focusState(row.state)}
                    aria-pressed={selected}
                    className={`glass-card p-4 text-left ${selected ? "ring-2 ring-primary" : ""}`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-base font-semibold text-foreground">{stateLabel(row.state)}</span>
                      <span className="font-mono text-xs text-muted-foreground">{row.total} listed</span>
                    </div>
                    <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-muted" aria-hidden>
                      {PV_STATUS_ORDER.map((status) =>
                        row[status] > 0 ? (
                          <div
                            key={status}
                            className="h-full transition-[width] duration-700 ease-out"
                            style={{
                              width: drawn ? `${(row[status] / row.total) * 100}%` : "0%",
                              background: colours[status],
                            }}
                          />
                        ) : null,
                      )}
                    </div>
                    <p className="mt-3 text-sm text-foreground">
                      <span className="font-semibold">{row.accepts}</span>{" "}
                      {row.accepts === 1 ? "takes panels" : "take panels"}
                      {called > 0 && <span className="text-muted-foreground"> · {yes}% of calls</span>}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {row.declines} said no · {row.unknown} unclear · {row.not_surveyed} not called
                    </p>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-labelledby="reading-heading">
            <div className="glass-card p-5">
              <h2 id="reading-heading" className="text-lg font-semibold text-foreground">
                How much of the list has been called
              </h2>
              <p className="mt-1 mb-4 text-sm text-muted-foreground">
                A short bar means most landfills in that state have not been phoned yet, so the picture there is still
                incomplete.
              </p>
              <div className="space-y-3">
                {coverage.map((row) => (
                  <LabeledBar
                    key={row.state}
                    label={stateLabel(row.state)}
                    caption={`${row.called} of ${row.total} called · ${row.calledPct}%`}
                    value={row.calledPct}
                    max={100}
                    color={navy}
                    drawn={drawn}
                  />
                ))}
              </div>
              {furthest && thinnest && furthest.state !== thinnest.state && (
                <p className="mt-4 text-xs text-muted-foreground">
                  {stateLabel(furthest.state)} is furthest along ({furthest.calledPct}% called).{" "}
                  {stateLabel(thinnest.state)} is earliest ({thinnest.calledPct}% called), so treat that state&rsquo;s
                  yes-rate cautiously — it rests on {thinnest.called} {thinnest.called === 1 ? "call" : "calls"}.
                </p>
              )}
            </div>

            <div className="glass-card p-5">
              <h2 className="text-lg font-semibold text-foreground">Of the calls, how often they said yes</h2>
              <p className="mt-1 mb-4 text-sm text-muted-foreground">
                This ignores landfills that have not been called, so states can be compared on the same terms.
              </p>
              <div className="space-y-3">
                {coverage.map((row) => (
                  <LabeledBar
                    key={row.state}
                    label={stateLabel(row.state)}
                    caption={
                      row.called
                        ? `${row.accepts} of ${row.called} calls · ${row.yesPct}%`
                        : "No calls yet"
                    }
                    value={row.yesPct}
                    max={100}
                    color={navy}
                    drawn={drawn}
                  />
                ))}
              </div>
              {mostYes && (
                <p className="mt-4 text-xs text-muted-foreground">
                  {stateLabel(mostYes.state)} said yes most often: {mostYes.yesPct}% of {mostYes.called}{" "}
                  {mostYes.called === 1 ? "call" : "calls"}.
                </p>
              )}
            </div>
          </section>

          {byOperator.length > 0 && (
            <section className="glass-card p-5 sm:p-6" aria-labelledby="operator-heading">
              <h2 id="operator-heading" className="text-lg font-semibold text-foreground">
                Who said yes, by who runs the landfill
              </h2>
              <p className="mt-1 mb-4 text-sm text-muted-foreground">
                Only landfills SolarCycle reached, and only where the survey recorded an operator type. The bar is the
                share of those calls that said yes.
              </p>
              <div className="space-y-3">
                {byOperator.map((row) => (
                  <LabeledBar
                    key={row.type}
                    label={row.type}
                    caption={`${row.yes} of ${row.called} said yes · ${row.yesPct}%`}
                    value={row.yesPct}
                    max={100}
                    color={navy}
                    drawn={drawn}
                  />
                ))}
              </div>
            </section>
          )}

          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-labelledby="calls-heading">
            <div className="glass-card p-5">
              <h2 id="calls-heading" className="text-lg font-semibold text-foreground">
                Just the {surveyed} completed calls
              </h2>
              <p className="mt-1 mb-4 text-sm text-muted-foreground">
                The bar above includes landfills nobody has phoned yet. This one does not, so yes, no, and unclear fill
                the whole bar.
              </p>
              <div
                className="flex h-8 overflow-hidden rounded-full bg-muted"
                role="img"
                aria-label={callOnly.map((part) => `${STORY[part.status].title}: ${part.count}`).join(", ")}
              >
                {callOnly.map((part) =>
                  part.count > 0 ? (
                    <div
                      key={part.status}
                      className="h-full transition-[width] duration-700 ease-out"
                      style={{
                        width: drawn && surveyed ? `${(part.count / surveyed) * 100}%` : "0%",
                        background: colours[part.status],
                      }}
                    />
                  ) : null,
                )}
              </div>
              <ul className="mt-4 space-y-1 text-sm text-muted-foreground">
                {callOnly.map((part) => (
                  <li key={part.status} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-foreground">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: colours[part.status] }} />
                      {STORY[part.status].title}
                    </span>
                    <span className="font-mono text-xs">
                      {part.count} · {surveyed ? Math.round((part.count / surveyed) * 100) : 0}% of calls
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="glass-card p-5">
              <h2 className="text-lg font-semibold text-foreground">Yes against no, by state</h2>
              <p className="mt-1 mb-4 text-sm text-muted-foreground">
                Unclear answers and sites not yet called are left out. Green is yes, red is no.
              </p>
              <div className="space-y-3">
                {coverage.map((row) => {
                  const decided = row.accepts + row.declines;
                  return (
                    <div key={row.state}>
                      <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                        <span className="text-foreground">{stateLabel(row.state)}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {decided ? `${row.accepts} yes · ${row.declines} no` : "No clear yes or no yet"}
                        </span>
                      </div>
                      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
                        {decided > 0 && (
                          <>
                            <div
                              className="h-full transition-[width] duration-700 ease-out"
                              style={{
                                width: drawn ? `${(row.accepts / decided) * 100}%` : "0%",
                                background: colours.accepts,
                              }}
                            />
                            <div
                              className="h-full transition-[width] duration-700 ease-out"
                              style={{
                                width: drawn ? `${(row.declines / decided) * 100}%` : "0%",
                                background: colours.declines,
                              }}
                            />
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-3" aria-labelledby="practical-heading">
            <h2 id="practical-heading" className="sr-only">
              What a yes actually means
            </h2>
            <PriceCallout
              label="Yes, but with rules"
              value={`${withRestriction} of ${accepting.length}`}
              detail="Sites that take panels and listed a restriction, such as residents only or no hazardous waste."
            />
            <PriceCallout
              label="Yes, and left a phone"
              value={`${withPhone} of ${accepting.length}`}
              detail="Sites that take panels and recorded a number you can call."
            />
            <PriceCallout
              label="Quoted per ton"
              value={tonLow != null && tonHigh != null ? `$${Math.round(tonLow)}–$${Math.round(tonHigh)}` : "—"}
              detail={
                tonTypical != null
                  ? `The landfill’s own price per ton. The middle quote is $${Math.round(tonTypical)}. Per-panel figures above are SolarCycle’s estimate from that.`
                  : "No per-ton quotes recorded."
              }
            />
          </section>

          <section className="glass-card p-5 sm:p-6" aria-labelledby="cost-heading">
            <h2 id="cost-heading" className="text-lg font-semibold text-foreground">
              What one panel costs to drop off
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Only landfills that quoted a price. The figure is SolarCycle&rsquo;s estimate for a single panel, worked
              out from the landfill&rsquo;s price per ton.
            </p>

            {priced.length > 0 && highest != null && typical != null ? (
              <>
                <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <PriceCallout label="Cheapest quote" value={money(priced[0].costPerPanel!)} detail={priced[0].name} />
                  <PriceCallout label="Typical quote" value={money(typical)} detail={`Middle of ${priced.length} prices`} />
                  <PriceCallout
                    label="Highest quote"
                    value={money(highest)}
                    detail={priced[priced.length - 1].name}
                  />
                </div>

                <h3 className="mb-3 mt-6 text-sm font-medium text-foreground">Five cheapest places</h3>
                <ul className="space-y-2.5">
                  {cheapest.map((site) => (
                    <li key={site.id} className="grid grid-cols-[1fr_auto] items-center gap-3">
                      <div className="min-w-0">
                        <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                          <span className="truncate text-foreground">
                            {site.name}
                            <span className="text-muted-foreground"> · {stateLabel(site.state)}</span>
                          </span>
                          <span className="shrink-0 font-mono text-foreground">{money(site.costPerPanel!)}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full transition-[width] duration-700 ease-out"
                            style={{
                              width: drawn ? `${(site.costPerPanel! / highest) * 100}%` : "0%",
                              background: navy,
                            }}
                          />
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-muted-foreground">
                  Bar length is compared with the highest quote ({money(highest)}), so a short bar is a cheaper drop-off.
                </p>

                <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <div>
                    <h3 className="mb-1 text-sm font-medium text-foreground">How the {priced.length} quotes cluster</h3>
                    <p className="mb-3 text-xs text-muted-foreground">
                      Each bar is a price range. Taller means more landfills quoted in that range.
                    </p>
                    <div className="space-y-3">
                      {priceBuckets.map((bucket) => (
                        <LabeledBar
                          key={bucket.label}
                          label={bucket.label}
                          caption={`${bucket.count} ${bucket.count === 1 ? "landfill" : "landfills"}`}
                          value={bucket.count}
                          max={busiestBucket}
                          color={navy}
                          drawn={drawn}
                        />
                      ))}
                    </div>
                  </div>
                  <div>
                    <h3 className="mb-1 text-sm font-medium text-foreground">Typical price in each state</h3>
                    <p className="mb-3 text-xs text-muted-foreground">
                      The middle quote for that state. States with no price yet are left out.
                    </p>
                    <div className="space-y-3">
                      {priceByState.map((row) => (
                        <LabeledBar
                          key={row.state}
                          label={stateLabel(row.state)}
                          caption={`${money(row.median)} · ${row.count} ${row.count === 1 ? "quote" : "quotes"}`}
                          value={row.median}
                          max={highestStateMedian}
                          color={navy}
                          drawn={drawn}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">No prices recorded yet.</p>
            )}
          </section>

          <section id="landfill-lookup" className="scroll-mt-4 space-y-3">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Look up a landfill</h2>
              <p className="text-sm text-muted-foreground">
                Name, answer, price, and who to call. Open a row for restrictions and notes from the phone call.
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
                  {STATE_ORDER.map((s) => (
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
                  <SelectItem value="all">Any answer</SelectItem>
                  {PV_STATUS_ORDER.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STORY[s].title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(stateFilter !== "all" || statusFilter !== "all" || search) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setStateFilter("all");
                    setStatusFilter("all");
                    setSearch("");
                  }}
                >
                  Clear
                </Button>
              )}
            </div>

            <div className="glass-card overflow-hidden">
              <div className="max-h-[70vh] overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky top-0 w-8 bg-card" />
                      <TableHead className="sticky top-0 cursor-pointer bg-card" onClick={() => handleSort("name")}>
                        Landfill
                        <SortIcon col="name" />
                      </TableHead>
                      <TableHead className="sticky top-0 cursor-pointer bg-card" onClick={() => handleSort("state")}>
                        State
                        <SortIcon col="state" />
                      </TableHead>
                      <TableHead className="sticky top-0 cursor-pointer bg-card" onClick={() => handleSort("pvStatus")}>
                        Takes panels?
                        <SortIcon col="pvStatus" />
                      </TableHead>
                      <TableHead
                        className="sticky top-0 cursor-pointer bg-card text-right"
                        onClick={() => handleSort("costPerPanel")}
                      >
                        Cost / panel
                        <SortIcon col="costPerPanel" />
                      </TableHead>
                      <TableHead className="sticky top-0 bg-card">Who to call</TableHead>
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
                Showing {filtered.length} of {SITES.length} landfills.
              </p>
            </div>
          </section>
        </PageContainer>
      </div>

      {assistantOpen && (
        <div className="sticky top-0 h-[calc(100vh-3rem)] w-[320px] shrink-0 overflow-hidden border-l border-border/70 2xl:w-[380px]">
          <SurveyAssistantPanel onCollapse={() => setAssistantOpen(false)} />
        </div>
      )}
    </div>
  );
}

function LabeledBar({
  label,
  caption,
  value,
  max,
  color,
  drawn,
}: {
  label: string;
  caption: string;
  value: number;
  max: number;
  color: string;
  drawn: boolean;
}) {
  const width = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
        <span className="text-foreground">{label}</span>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{caption}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out"
          style={{ width: drawn ? `${width}%` : "0%", background: color }}
        />
      </div>
    </div>
  );
}

function PriceCallout({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/40 px-4 py-3">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-2xl font-semibold text-foreground">{value}</p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function SiteRow({ site: s }: { site: SurveySite }) {
  const [open, setOpen] = useState(false);
  const notes = [
    s.restrictions && `Restrictions: ${s.restrictions}`,
    s.notes,
    s.callNotes && `Call notes: ${s.callNotes}`,
    s.acceptLqg && `Accepts large-quantity hazardous waste: ${s.acceptLqg}`,
    s.type && `Operator type: ${s.type}`,
  ].filter(Boolean) as string[];
  const website = s.website?.startsWith("http") ? s.website : null;
  const hasDetails = notes.length > 0 || Boolean(s.location);

  return (
    <>
      <TableRow className="hover:bg-muted/30">
        <TableCell className="w-8 pr-0">
          {hasDetails && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label={open ? `Hide details for ${s.name}` : `Show details for ${s.name}`}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          )}
        </TableCell>
        <TableCell className="min-w-48 font-medium">
          {website ? (
            <a href={website} target="_blank" rel="noreferrer" className="hover:text-primary hover:underline">
              {s.name}
            </a>
          ) : (
            s.name
          )}
        </TableCell>
        <TableCell>{stateLabel(s.state)}</TableCell>
        <TableCell>
          <Badge variant="outline" className={`whitespace-nowrap text-xs ${STATUS_BADGE[s.pvStatus]}`}>
            {PV_STATUS_LABEL[s.pvStatus]}
          </Badge>
        </TableCell>
        <TableCell className="whitespace-nowrap text-right font-mono text-sm">
          {s.costPerPanel != null && s.costPerPanel > 0 ? (
            <span className="text-foreground">{money(s.costPerPanel)}</span>
          ) : s.cost === 0 ? (
            <span className="text-muted-foreground">Free</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell className="min-w-40 text-sm">
          {s.owner && <p className="text-foreground">{s.owner}</p>}
          {s.phone && <p className="text-muted-foreground">{s.phone}</p>}
          {!s.owner && !s.phone && <span className="text-muted-foreground">—</span>}
        </TableCell>
      </TableRow>
      {open && hasDetails && (
        <TableRow className="bg-muted/20 hover:bg-muted/20">
          <TableCell />
          <TableCell colSpan={5} className="text-sm text-muted-foreground">
            {s.location && <p className="text-foreground">{s.location}</p>}
            {notes.map((n) => (
              <p key={n} className="mt-1">
                {n}
              </p>
            ))}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Search, ChevronUp, ChevronDown } from "lucide-react";
import { useLandfills } from "@/hooks/useLandfills";
import { DataErrorState, DataLoadingState } from "@/components/DataLoadingState";
import type { Landfill } from "@/types/landfill";

type SortKey = "name" | "state" | "ownership" | "acceptsPV" | "operationalStatus";

export default function DataTable() {
  const { data: landfills = [], isLoading, isError, refetch } = useLandfills();
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortAsc, setSortAsc] = useState(true);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return landfills
      .filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          l.state.toLowerCase().includes(q) ||
          l.county.toLowerCase().includes(q),
      )
      .sort((a, b) => {
        const va = a[sortKey] ?? "";
        const vb = b[sortKey] ?? "";
        return sortAsc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
      });
  }, [landfills, search, sortKey, sortAsc]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const exportCSV = () => {
    const headers = [
      "Facility Name",
      "State",
      "County",
      "Ownership",
      "Operational Status",
      "Accepts PV",
      "Latitude",
      "Longitude",
      "Source",
    ];
    const rows = landfills.map((l) => [
      l.name,
      l.state,
      l.county,
      l.ownership,
      l.operationalStatus ?? "",
      l.acceptsPV,
      l.lat,
      l.lng,
      l.source ?? "EPA LMOP",
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "solartrace-landfills.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const SortIcon = ({ col }: { col: SortKey }) =>
    sortKey === col ? (
      sortAsc ? (
        <ChevronUp className="h-3 w-3 inline ml-1" />
      ) : (
        <ChevronDown className="h-3 w-3 inline ml-1" />
      )
    ) : null;

  const pvBadgeVariant = (status: Landfill["acceptsPV"]) => {
    if (status === "Yes") return "default" as const;
    if (status === "No") return "destructive" as const;
    return "secondary" as const;
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <DataLoadingState message="Loading landfill records from EPA LMOP…" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <DataErrorState message="Failed to load landfill data from EPA LMOP." onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Data Table</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {landfills.length.toLocaleString()} MSW landfills from EPA LMOP
          </p>
        </div>
        <Button onClick={exportCSV} variant="outline" size="sm">
          <Download className="h-4 w-4 mr-2" /> Export CSV
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search facilities…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto max-h-[calc(100vh-14rem)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="cursor-pointer sticky top-0 bg-card" onClick={() => handleSort("name")}>
                  Facility Name
                  <SortIcon col="name" />
                </TableHead>
                <TableHead className="cursor-pointer sticky top-0 bg-card" onClick={() => handleSort("state")}>
                  State
                  <SortIcon col="state" />
                </TableHead>
                <TableHead className="sticky top-0 bg-card">County</TableHead>
                <TableHead className="cursor-pointer sticky top-0 bg-card" onClick={() => handleSort("ownership")}>
                  Ownership
                  <SortIcon col="ownership" />
                </TableHead>
                <TableHead
                  className="cursor-pointer sticky top-0 bg-card"
                  onClick={() => handleSort("operationalStatus")}
                >
                  Status
                  <SortIcon col="operationalStatus" />
                </TableHead>
                <TableHead className="cursor-pointer sticky top-0 bg-card" onClick={() => handleSort("acceptsPV")}>
                  Accepts PV
                  <SortIcon col="acceptsPV" />
                </TableHead>
                <TableHead className="sticky top-0 bg-card">Coordinates</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((l) => (
                <TableRow key={l.id} className="hover:bg-muted/30">
                  <TableCell className="font-medium">{l.name}</TableCell>
                  <TableCell>{l.state}</TableCell>
                  <TableCell>{l.county}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {l.ownership}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{l.operationalStatus ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={pvBadgeVariant(l.acceptsPV)} className="text-xs">
                      {l.acceptsPV}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {l.lat.toFixed(4)}, {l.lng.toFixed(4)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground p-3 border-t border-border/50">
          Showing {filtered.length.toLocaleString()} of {landfills.length.toLocaleString()} facilities. PV acceptance
          policy is not available from EPA LMOP — marked Unknown.
        </p>
      </div>
    </div>
  );
}

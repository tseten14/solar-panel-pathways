import { useState, useMemo } from "react";
import { landfills } from "@/data/mockData";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Search, ChevronUp, ChevronDown } from "lucide-react";

type SortKey = "name" | "state" | "ownership" | "acceptsPV" | "tippingFee" | "lastSurveyed";

export default function DataTable() {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortAsc, setSortAsc] = useState(true);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return landfills
      .filter((l) => l.name.toLowerCase().includes(q) || l.state.toLowerCase().includes(q) || l.county.toLowerCase().includes(q))
      .sort((a, b) => {
        let va = a[sortKey] ?? "";
        let vb = b[sortKey] ?? "";
        if (typeof va === "number" && typeof vb === "number") return sortAsc ? va - vb : vb - va;
        return sortAsc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
      });
  }, [search, sortKey, sortAsc]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  };

  const exportCSV = () => {
    const headers = ["Facility Name", "State", "County", "Ownership", "Accepts PV", "Tipping Fee", "Min Load", "TCLP Required", "Last Surveyed"];
    const rows = landfills.map((l) => [l.name, l.state, l.county, l.ownership, l.acceptsPV, l.tippingFee ?? "N/A", l.minLoad ?? "N/A", l.tclpRequired ? "Yes" : "No", l.lastSurveyed]);
    const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "solartrace-landfills.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const SortIcon = ({ col }: { col: SortKey }) =>
    sortKey === col ? (sortAsc ? <ChevronUp className="h-3 w-3 inline ml-1" /> : <ChevronDown className="h-3 w-3 inline ml-1" />) : null;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Data Table</h1>
          <p className="text-sm text-muted-foreground mt-1">{landfills.length} landfill survey records</p>
        </div>
        <Button onClick={exportCSV} variant="outline" size="sm">
          <Download className="h-4 w-4 mr-2" /> Export CSV
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search facilities..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="cursor-pointer" onClick={() => handleSort("name")}>Facility Name<SortIcon col="name" /></TableHead>
                <TableHead className="cursor-pointer" onClick={() => handleSort("state")}>State<SortIcon col="state" /></TableHead>
                <TableHead>County</TableHead>
                <TableHead className="cursor-pointer" onClick={() => handleSort("ownership")}>Ownership<SortIcon col="ownership" /></TableHead>
                <TableHead className="cursor-pointer" onClick={() => handleSort("acceptsPV")}>Accepts PV<SortIcon col="acceptsPV" /></TableHead>
                <TableHead className="cursor-pointer" onClick={() => handleSort("tippingFee")}>Tipping Fee<SortIcon col="tippingFee" /></TableHead>
                <TableHead>Min Load</TableHead>
                <TableHead>TCLP</TableHead>
                <TableHead className="cursor-pointer" onClick={() => handleSort("lastSurveyed")}>Last Surveyed<SortIcon col="lastSurveyed" /></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((l) => (
                <TableRow key={l.id} className="hover:bg-muted/30 cursor-pointer">
                  <TableCell className="font-medium">{l.name}</TableCell>
                  <TableCell>{l.state}</TableCell>
                  <TableCell>{l.county}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{l.ownership}</Badge></TableCell>
                  <TableCell>
                    <Badge variant={l.acceptsPV === "Yes" ? "default" : l.acceptsPV === "No" ? "destructive" : "secondary"} className="text-xs">
                      {l.acceptsPV}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono">{l.tippingFee ? `$${l.tippingFee}/ton` : "—"}</TableCell>
                  <TableCell className="font-mono">{l.minLoad ? `${l.minLoad}T` : "—"}</TableCell>
                  <TableCell>{l.tclpRequired ? "Yes" : "No"}</TableCell>
                  <TableCell className="text-muted-foreground">{l.lastSurveyed}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

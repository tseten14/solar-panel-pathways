import { Building2, MapPin, DollarSign, ArrowRightLeft } from "lucide-react";
import { StatCard } from "@/components/StatCard";
import { MiniMap } from "@/components/MiniMap";
import { landfills, tradeRoutes } from "@/data/mockData";
import { useNavigate } from "react-router-dom";

export default function Dashboard() {
  const navigate = useNavigate();
  const accepting = landfills.filter((l) => l.acceptsPV === "Yes").length;
  const pctAccepting = Math.round((accepting / landfills.length) * 100);
  const avgFee = Math.round(
    landfills.filter((l) => l.tippingFee !== null).reduce((s, l) => s + l.tippingFee!, 0) /
    landfills.filter((l) => l.tippingFee !== null).length
  );

  const filters = [
    { label: "High Solar States", onClick: () => navigate("/map") },
    { label: "Rejecting Facilities", onClick: () => navigate("/data") },
    { label: "Active Trade Routes", onClick: () => navigate("/trade-flows") },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">PV Waste Flow Intelligence Overview</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Building2} label="Landfills Surveyed" value={landfills.length} subtitle="Across 13 states" />
        <StatCard icon={MapPin} label="Accepting PV Waste" value={`${pctAccepting}%`} subtitle={`${accepting} of ${landfills.length} facilities`} highlight />
        <StatCard icon={DollarSign} label="Avg Tipping Fee" value={`$${avgFee}/ton`} subtitle="Among accepting facilities" />
        <StatCard icon={ArrowRightLeft} label="Trade Routes Mapped" value={tradeRoutes.length} subtitle={`${tradeRoutes.filter((r) => r.isInternational).length} international`} />
      </div>

      <div className="flex gap-2 flex-wrap">
        {filters.map((f) => (
          <button
            key={f.label}
            onClick={f.onClick}
            className="px-3 py-1.5 text-xs font-medium rounded-full border border-primary/30 text-primary hover:bg-primary/10 transition-colors"
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="glass-card overflow-hidden" style={{ height: 400 }}>
        <MiniMap />
      </div>
    </div>
  );
}

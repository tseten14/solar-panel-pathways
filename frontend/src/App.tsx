import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/AppLayout";
import Dashboard from "./pages/Dashboard";
import LandfillMap from "./pages/LandfillMap";
import TradeFlows from "./pages/TradeFlows";
import MLPredictions from "./pages/MLPredictions";
import DataTable from "./pages/DataTable";
import NotFound from "./pages/NotFound";
import SolarMap from "./pages/SolarMap";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 1000 * 60 * 30,
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AppLayout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/map" element={<LandfillMap />} />
            <Route path="/trade-flows" element={<TradeFlows />} />
            <Route path="/predictions" element={<MLPredictions />} />
            <Route path="/data" element={<DataTable />} />
            <Route path="/solar-map" element={<SolarMap />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AppLayout>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

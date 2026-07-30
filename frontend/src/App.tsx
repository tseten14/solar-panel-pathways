import { Suspense, lazy } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/AppLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { DataLoadingState } from "@/components/DataLoadingState";

// Each page is loaded only when you first visit it. Without this, opening the
// Dashboard would also download the map and charting libraries it never uses.
const Dashboard = lazy(() => import("./pages/Dashboard"));
const LandfillMap = lazy(() => import("./pages/LandfillMap"));
const TradeFlows = lazy(() => import("./pages/TradeFlows"));
const MLPredictions = lazy(() => import("./pages/MLPredictions"));
const DataTable = lazy(() => import("./pages/DataTable"));
const NotFound = lazy(() => import("./pages/NotFound"));
const SolarMap = lazy(() => import("./pages/SolarMap"));

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
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AppLayout>
          <ErrorBoundary>
            <Suspense fallback={<div className="p-6"><DataLoadingState message="Loading…" /></div>}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/map" element={<LandfillMap />} />
              <Route path="/trade-flows" element={<TradeFlows />} />
              <Route path="/predictions" element={<MLPredictions />} />
              <Route path="/data" element={<DataTable />} />
              <Route path="/solar-map" element={<SolarMap />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
            </Suspense>
          </ErrorBoundary>
        </AppLayout>
      </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;

export type { Landfill } from "@/types/landfill";

export interface TradeRoute {
  id: string;
  origin: string;
  originLat: number;
  originLng: number;
  destination: string;
  destLat: number;
  destLng: number;
  estimatedVolume: string;
  mode: "Truck" | "Rail" | "Ship";
  legalStatus: "Tracked" | "Unmonitored" | "Flagged";
  isInternational: boolean;
}

export const tradeRoutes: TradeRoute[] = [
  { id: "tr1", origin: "NJ", originLat: 40.22, originLng: -74.76, destination: "PA (Recycler)", destLat: 40.27, destLng: -76.88, estimatedVolume: "~450 tons/yr", mode: "Truck", legalStatus: "Tracked", isInternational: false },
  { id: "tr2", origin: "CA", originLat: 34.05, originLng: -118.24, destination: "Mexico (Reuse)", destLat: 23.63, destLng: -102.55, estimatedVolume: "~1,200 tons/yr", mode: "Truck", legalStatus: "Unmonitored", isInternational: true },
  { id: "tr3", origin: "TX", originLat: 31.97, originLng: -99.9, destination: "LA (Landfill)", destLat: 30.98, destLng: -91.96, estimatedVolume: "~300 tons/yr", mode: "Truck", legalStatus: "Tracked", isInternational: false },
  { id: "tr4", origin: "AZ", originLat: 34.05, originLng: -111.09, destination: "India (Export)", destLat: 20.59, destLng: 78.96, estimatedVolume: "~800 tons/yr", mode: "Ship", legalStatus: "Flagged", isInternational: true },
];

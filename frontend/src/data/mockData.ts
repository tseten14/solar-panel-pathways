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

export interface MLPrediction {
  state: string;
  acceptanceProbability: number;
  avgCost: number;
  nearestFacility: string;
  nearestDistance: number;
  wasteDesert: boolean;
  confidence: [number, number];
}

export const tradeRoutes: TradeRoute[] = [
  { id: "tr1", origin: "NJ", originLat: 40.22, originLng: -74.76, destination: "PA (Recycler)", destLat: 40.27, destLng: -76.88, estimatedVolume: "~450 tons/yr", mode: "Truck", legalStatus: "Tracked", isInternational: false },
  { id: "tr2", origin: "CA", originLat: 34.05, originLng: -118.24, destination: "Mexico (Reuse)", destLat: 23.63, destLng: -102.55, estimatedVolume: "~1,200 tons/yr", mode: "Truck", legalStatus: "Unmonitored", isInternational: true },
  { id: "tr3", origin: "TX", originLat: 31.97, originLng: -99.9, destination: "LA (Landfill)", destLat: 30.98, destLng: -91.96, estimatedVolume: "~300 tons/yr", mode: "Truck", legalStatus: "Tracked", isInternational: false },
  { id: "tr4", origin: "AZ", originLat: 34.05, originLng: -111.09, destination: "India (Export)", destLat: 20.59, destLng: 78.96, estimatedVolume: "~800 tons/yr", mode: "Ship", legalStatus: "Flagged", isInternational: true },
];

export const mlPredictions: MLPrediction[] = [
  { state: "CA", acceptanceProbability: 82, avgCost: 88, nearestFacility: "Sunshine Recycling Landfill", nearestDistance: 45, wasteDesert: false, confidence: [74, 90] },
  { state: "TX", acceptanceProbability: 61, avgCost: 75, nearestFacility: "Lone Star Waste Management", nearestDistance: 32, wasteDesert: false, confidence: [52, 70] },
  { state: "NJ", acceptanceProbability: 18, avgCost: 120, nearestFacility: "Garden State Disposal", nearestDistance: 85, wasteDesert: true, confidence: [10, 26] },
  { state: "FL", acceptanceProbability: 22, avgCost: 110, nearestFacility: "Everglades Solid Waste", nearestDistance: 120, wasteDesert: true, confidence: [14, 30] },
  { state: "AZ", acceptanceProbability: 91, avgCost: 62, nearestFacility: "Desert Sun Landfill", nearestDistance: 28, wasteDesert: false, confidence: [85, 97] },
  { state: "CO", acceptanceProbability: 74, avgCost: 80, nearestFacility: "Rocky Mountain Disposal", nearestDistance: 55, wasteDesert: false, confidence: [65, 83] },
  { state: "NY", acceptanceProbability: 15, avgCost: 135, nearestFacility: "Empire State Waste Authority", nearestDistance: 95, wasteDesert: true, confidence: [8, 22] },
  { state: "GA", acceptanceProbability: 55, avgCost: 70, nearestFacility: "Peach State Landfill", nearestDistance: 40, wasteDesert: false, confidence: [45, 65] },
  { state: "NV", acceptanceProbability: 88, avgCost: 58, nearestFacility: "Silver State Environmental", nearestDistance: 22, wasteDesert: false, confidence: [80, 96] },
  { state: "WA", acceptanceProbability: 79, avgCost: 95, nearestFacility: "Cascade Disposal", nearestDistance: 38, wasteDesert: false, confidence: [70, 88] },
  { state: "KS", acceptanceProbability: 12, avgCost: 140, nearestFacility: "Prairie Wind Landfill", nearestDistance: 150, wasteDesert: true, confidence: [5, 19] },
  { state: "NC", acceptanceProbability: 72, avgCost: 71, nearestFacility: "Blue Ridge Waste", nearestDistance: 35, wasteDesert: false, confidence: [63, 81] },
  { state: "LA", acceptanceProbability: 48, avgCost: 78, nearestFacility: "Bayou Waste Services", nearestDistance: 52, wasteDesert: false, confidence: [38, 58] },
];

export const stateWasteVolume: Record<string, number> = {
  CA: 95, TX: 78, AZ: 88, FL: 72, NV: 85, CO: 65, NC: 58, GA: 52, NJ: 35, NY: 40, WA: 48, LA: 42, KS: 15,
};

export interface Landfill {
  id: string;
  name: string;
  state: string;
  county: string;
  lat: number;
  lng: number;
  ownership: "Municipal" | "Private";
  acceptsPV: "Yes" | "No" | "Conditional";
  tippingFee: number | null;
  tippingFeeUnit: "$/ton" | "$/panel";
  minLoad: number | null;
  tclpRequired: boolean;
  notes: string;
  lastSurveyed: string;
  surveyorName: string;
}

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

export const landfills: Landfill[] = [
  { id: "1", name: "Garden State Disposal", state: "NJ", county: "Essex", lat: 40.786, lng: -74.177, ownership: "Private", acceptsPV: "No", tippingFee: null, tippingFeeUnit: "$/ton", minLoad: null, tclpRequired: false, notes: "Strictly refuses PV waste. Cites TCLP concerns.", lastSurveyed: "2024-11-15", surveyorName: "M. Chen" },
  { id: "2", name: "Sunshine Recycling Landfill", state: "CA", county: "Riverside", lat: 33.953, lng: -117.396, ownership: "Private", acceptsPV: "Yes", tippingFee: 85, tippingFeeUnit: "$/ton", minLoad: 2, tclpRequired: true, notes: "Accepts PV panels after TCLP testing. Dedicated cell for e-waste.", lastSurveyed: "2024-10-20", surveyorName: "J. Park" },
  { id: "3", name: "Lone Star Waste Management", state: "TX", county: "Harris", lat: 29.76, lng: -95.37, ownership: "Municipal", acceptsPV: "Conditional", tippingFee: 72, tippingFeeUnit: "$/ton", minLoad: 5, tclpRequired: true, notes: "Accepts with pre-approval. Requires manifest documentation.", lastSurveyed: "2024-09-08", surveyorName: "R. Garcia" },
  { id: "4", name: "Desert Sun Landfill", state: "AZ", county: "Maricopa", lat: 33.448, lng: -112.074, ownership: "Private", acceptsPV: "Yes", tippingFee: 60, tippingFeeUnit: "$/ton", minLoad: 1, tclpRequired: false, notes: "Actively markets PV acceptance. Low-cost option.", lastSurveyed: "2025-01-10", surveyorName: "A. Singh" },
  { id: "5", name: "Everglades Solid Waste", state: "FL", county: "Miami-Dade", lat: 25.761, lng: -80.191, ownership: "Municipal", acceptsPV: "No", tippingFee: null, tippingFeeUnit: "$/ton", minLoad: null, tclpRequired: false, notes: "State regulation prohibits without special permit.", lastSurveyed: "2024-12-01", surveyorName: "L. Williams" },
  { id: "6", name: "Rocky Mountain Disposal", state: "CO", county: "Denver", lat: 39.739, lng: -104.99, ownership: "Private", acceptsPV: "Yes", tippingFee: 78, tippingFeeUnit: "$/ton", minLoad: 3, tclpRequired: true, notes: "Part of solar recycling pilot program.", lastSurveyed: "2025-01-22", surveyorName: "K. Johnson" },
  { id: "7", name: "Empire State Waste Authority", state: "NY", county: "Queens", lat: 40.713, lng: -73.935, ownership: "Municipal", acceptsPV: "No", tippingFee: null, tippingFeeUnit: "$/ton", minLoad: null, tclpRequired: false, notes: "NYC prohibits PV in municipal waste stream.", lastSurveyed: "2024-08-30", surveyorName: "D. Brown" },
  { id: "8", name: "Peach State Landfill", state: "GA", county: "Fulton", lat: 33.749, lng: -84.388, ownership: "Private", acceptsPV: "Conditional", tippingFee: 65, tippingFeeUnit: "$/ton", minLoad: 2, tclpRequired: true, notes: "Case-by-case review. Prefers bulk commercial loads.", lastSurveyed: "2024-11-28", surveyorName: "S. Taylor" },
  { id: "9", name: "Silver State Environmental", state: "NV", county: "Clark", lat: 36.169, lng: -115.14, ownership: "Private", acceptsPV: "Yes", tippingFee: 55, tippingFeeUnit: "$/ton", minLoad: 1, tclpRequired: false, notes: "Near major solar farms. High volume capacity.", lastSurveyed: "2025-02-05", surveyorName: "J. Park" },
  { id: "10", name: "Bayou Waste Services", state: "LA", county: "East Baton Rouge", lat: 30.451, lng: -91.187, ownership: "Municipal", acceptsPV: "Conditional", tippingFee: 70, tippingFeeUnit: "$/ton", minLoad: 3, tclpRequired: true, notes: "Requires state DEQ notification prior to acceptance.", lastSurveyed: "2024-10-15", surveyorName: "M. Davis" },
  { id: "11", name: "Cascade Disposal", state: "WA", county: "King", lat: 47.606, lng: -122.332, ownership: "Municipal", acceptsPV: "Yes", tippingFee: 92, tippingFeeUnit: "$/ton", minLoad: 2, tclpRequired: true, notes: "Progressive e-waste policy. High tipping fees.", lastSurveyed: "2025-01-18", surveyorName: "R. Garcia" },
  { id: "12", name: "Prairie Wind Landfill", state: "KS", county: "Sedgwick", lat: 37.687, lng: -97.336, ownership: "Private", acceptsPV: "No", tippingFee: null, tippingFeeUnit: "$/ton", minLoad: null, tclpRequired: false, notes: "No infrastructure for PV waste handling.", lastSurveyed: "2024-07-22", surveyorName: "K. Johnson" },
  { id: "13", name: "Blue Ridge Waste", state: "NC", county: "Mecklenburg", lat: 35.227, lng: -80.843, ownership: "Private", acceptsPV: "Yes", tippingFee: 68, tippingFeeUnit: "$/ton", minLoad: 2, tclpRequired: false, notes: "Partnered with regional solar decommissioner.", lastSurveyed: "2025-02-12", surveyorName: "A. Singh" },
];

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

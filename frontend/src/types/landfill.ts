export interface Landfill {
  id: string;
  name: string;
  state: string;
  county: string;
  lat: number;
  lng: number;
  ownership: "Municipal" | "Private";
  acceptsPV: "Yes" | "No" | "Conditional" | "Unknown";
  tippingFee: number | null;
  tippingFeeUnit: "$/ton" | "$/panel";
  minLoad: number | null;
  tclpRequired: boolean;
  notes: string;
  lastSurveyed: string;
  surveyorName: string;
  /** EPA LMOP operational status, e.g. Open / Closed */
  operationalStatus?: string;
  /** Data source label */
  source?: string;
}

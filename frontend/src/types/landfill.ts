/**
 * A municipal solid waste landfill from EPA LMOP. Every field here comes from the
 * live LMOP feed or is derived from it — there is no survey/policy data, because
 * no public API publishes per-landfill PV acceptance or tipping fees.
 */
export interface Landfill {
  id: string;
  name: string;
  state: string;
  county: string;
  lat: number;
  lng: number;
  /** Inferred from LMOP's owner-organisation string (keyword match), not a reported field. */
  ownership: "Municipal" | "Private";
  notes: string;
  /** EPA LMOP operational status, e.g. Open / Closed */
  operationalStatus?: string;
  /** LMOP design capacity in tons, when reported. */
  designCapacityTons?: number | null;
  /** LMOP waste-in-place in tons, when reported. */
  wasteInPlaceTons?: number | null;
  /** Data source label */
  source?: string;
}

export interface SolarFacility {
  id: string;
  name: string;
  state: string;
  county: string;
  capacityMw: number;
  lat: number;
  lng: number;
}

export interface SolarStateStats {
  state: string;
  facilityCount: number;
  totalCapacityMw: number;
}

/** One (state, install-year) bucket from USPVDB `p_year` — drives retirement timing. */
export interface SolarCohort {
  state: string;
  year: number;
  facilityCount: number;
  capacityMw: number;
}

/**
 * Capacity split by USPVDB `p_tech_sec`. Module chemistry determines the hazard
 * profile of the eventual waste stream: crystalline-silicon modules carry lead
 * solder, thin-film (CdTe) carries cadmium.
 */
export interface SolarTechMix {
  tech: string;
  facilityCount: number;
  capacityMw: number;
}

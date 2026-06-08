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

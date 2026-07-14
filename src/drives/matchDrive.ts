import type { VehicleClass } from '../auth/types';

type VehicleCapacity = {
  vehicleClass: VehicleClass;
  seats: number;
};

type DriveRequirements = {
  vehicleClass?: VehicleClass | null;
  seats?: number | null;
  posterId?: string;
};

/**
 * Open board match: same vehicle class, and driver seats ≥ seats needed.
 * Posters always match their own drives so they can manage applicants.
 */
export function driverMatchesOpenDrive(
  driver: VehicleCapacity | null | undefined,
  drive: DriveRequirements,
  viewerId?: string,
): boolean {
  if (viewerId != null && drive.posterId === viewerId) return true;
  if (!driver) return false;
  if (drive.vehicleClass == null || drive.seats == null) return false;
  return (
    driver.vehicleClass === drive.vehicleClass && driver.seats >= drive.seats
  );
}

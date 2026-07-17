type VehicleCapacity = {
  seats: number;
};

type DriveRequirements = {
  seats?: number | null;
  posterId?: string;
};

/**
 * Open board match: driver seats ≥ seats needed (exact or extra seats).
 * Vehicle class is not filtered. Posters always match their own drives
 * so they can manage applicants.
 */
export function driverMatchesOpenDrive(
  driver: VehicleCapacity | null | undefined,
  drive: DriveRequirements,
  viewerId?: string,
): boolean {
  if (viewerId != null && drive.posterId === viewerId) return true;
  if (!driver) return false;
  if (drive.seats == null) return false;
  return driver.seats >= drive.seats;
}

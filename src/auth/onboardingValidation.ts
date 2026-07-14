import type { OnboardingInput, VehicleClass } from './types';

export type OnboardingFieldErrors = Partial<
  Record<
    | 'vehicleClass'
    | 'vehicleType'
    | 'seats'
    | 'yearsDrivingUpstate'
    | 'zelle',
    string
  >
>;

export function validateVehicleClass(
  value: VehicleClass | null,
): string | undefined {
  if (!value) return 'Choose a vehicle class';
  return undefined;
}

export function validateVehicleTypeName(value: string): string | undefined {
  const name = value.trim();
  if (!name) return 'Enter the vehicle type (e.g. Escalade)';
  if (name.length < 2) return 'Vehicle type is too short';
  if (name.length > 60) return 'Vehicle type is too long';
  return undefined;
}

export function validateSeats(value: number | null): string | undefined {
  if (value == null) return 'Enter number of seats';
  if (!Number.isInteger(value) || value < 1) return 'Seats must be at least 1';
  if (value > 20) return 'Seats seem too high';
  return undefined;
}

export function validateYearsDrivingUpstate(
  value: number | null,
): string | undefined {
  if (value == null) return 'Enter years driving upstate';
  if (!Number.isFinite(value) || value < 0) {
    return 'Years can’t be negative';
  }
  if (value > 80) return 'That doesn’t look right';
  return undefined;
}

export function validateZelle(value: string): string | undefined {
  const zelle = value.trim();
  if (!zelle) return undefined;
  if (zelle.length < 5) return 'Enter a valid Zelle email or phone';
  if (zelle.length > 120) return 'Zelle info is too long';
  return undefined;
}

export function validateOnboardingVehicle(values: {
  vehicleClass: VehicleClass | null;
  vehicleType: string;
  seats: number | null;
}): OnboardingFieldErrors {
  const errors: OnboardingFieldErrors = {};
  const classError = validateVehicleClass(values.vehicleClass);
  if (classError) errors.vehicleClass = classError;
  const typeError = validateVehicleTypeName(values.vehicleType);
  if (typeError) errors.vehicleType = typeError;
  const seatsError = validateSeats(values.seats);
  if (seatsError) errors.seats = seatsError;
  return errors;
}

export function validateOnboardingExperience(values: {
  yearsDrivingUpstate: number | null;
}): OnboardingFieldErrors {
  const errors: OnboardingFieldErrors = {};
  const yearsError = validateYearsDrivingUpstate(values.yearsDrivingUpstate);
  if (yearsError) errors.yearsDrivingUpstate = yearsError;
  return errors;
}

export function validateOnboardingZelle(values: {
  zelle: string;
}): OnboardingFieldErrors {
  const errors: OnboardingFieldErrors = {};
  const zelleError = validateZelle(values.zelle);
  if (zelleError) errors.zelle = zelleError;
  return errors;
}

export function buildOnboardingProfile(input: {
  vehicleClass: VehicleClass;
  vehicleType: string;
  seats: number;
  selfPhotoUri?: string;
  vehicleInteriorUri?: string;
  vehicleExteriorUri?: string;
  yearsDrivingUpstate: number;
  extraInfo: string;
  zelle: string;
}): OnboardingInput {
  return {
    vehicleClass: input.vehicleClass,
    vehicleType: input.vehicleType.trim(),
    seats: input.seats,
    selfPhotoUri: input.selfPhotoUri,
    vehicleInteriorUri: input.vehicleInteriorUri,
    vehicleExteriorUri: input.vehicleExteriorUri,
    yearsDrivingUpstate: input.yearsDrivingUpstate,
    extraInfo: input.extraInfo.trim() || undefined,
    zelle: input.zelle.trim() || undefined,
  };
}

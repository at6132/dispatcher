export type AuthMode = 'signIn' | 'signUp';

/** Size / class of the vehicle (not the model name). */
export type VehicleClass =
  | 'sedan'
  | 'suv'
  | 'large_suv'
  | 'minivan'
  | 'sprinter';

export const VEHICLE_CLASS_OPTIONS: { value: VehicleClass; label: string }[] = [
  { value: 'sedan', label: 'Sedan' },
  { value: 'suv', label: 'SUV' },
  { value: 'large_suv', label: 'Large SUV' },
  { value: 'minivan', label: 'Minivan' },
  { value: 'sprinter', label: 'Sprinter' },
];

export type OnboardingProfile = {
  vehicleClass: VehicleClass;
  /** Brand / model — e.g. Escalade, Sienna, Sprinter 2500 */
  vehicleType: string;
  seats: number;
  /** Local URI for now — upload later · profile photo */
  selfPhotoUri?: string;
  /** Max one each */
  vehicleInteriorUri?: string;
  vehicleExteriorUri?: string;
  yearsDrivingUpstate: number;
  extraInfo?: string;
  /** Zelle email or phone — optional unless posting rides */
  zelle?: string;
};

export type AuthUser = {
  id: string;
  phone: string;
  name: string;
  onboardingComplete: boolean;
  onboarding?: OnboardingProfile;
};

export type SignInInput = {
  phone: string;
  password: string;
};

export type SignUpInput = {
  name: string;
  phone: string;
  password: string;
};

export type OnboardingInput = OnboardingProfile;

export type AuthStatus = 'bootstrapping' | 'authenticated' | 'unauthenticated';

export type FieldErrors = Partial<
  Record<'name' | 'phone' | 'password' | 'confirmPassword', string>
>;

export type AuthRoute = 'auth' | 'contactSupport';

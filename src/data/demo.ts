/**
 * Demo-only fixtures for home / bank UI while backend is in flight.
 * Replace with API responses later — do not treat as source of truth.
 */

export type DemoDriver = {
  id: string;
  name: string;
  vehicleType: string;
  phone: string;
  detail: string;
  photoUri?: string;
};

export const DEMO_DRIVERS: DemoDriver[] = [
  {
    id: 'd1',
    name: 'Maya Chen',
    vehicleType: 'Suburban',
    phone: '(845) 555-0142',
    detail: '7 seats · 4 yrs upstate',
  },
  {
    id: 'd2',
    name: 'Jonah Weiss',
    vehicleType: 'Transit',
    phone: '(914) 555-0198',
    detail: '12 seats · 6 yrs upstate',
  },
  {
    id: 'd3',
    name: 'Leah Rosen',
    vehicleType: 'Odyssey',
    phone: '(845) 555-0177',
    detail: '7 seats · 2 yrs upstate',
  },
];

export const DEMO_BANK = {
  availableCents: 128400,
  pendingCents: 42000,
  currency: 'USD' as const,
};

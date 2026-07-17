/**
 * Shared k6 config. Override via env:
 *   BASE_URL, LOAD_TEST_BYPASS_SECRET, DRIVERS, DISPATCHERS
 */
export const BASE_URL = __ENV.BASE_URL ||
  'https://dispatcher-production-31d1.up.railway.app';

export const LOAD_TEST_SECRET = __ENV.LOAD_TEST_BYPASS_SECRET || '';

export const DRIVER_VUS = Number(__ENV.DRIVERS || 2000);
export const DISPATCHER_VUS = Number(__ENV.DISPATCHERS || 500);

/** Pass thresholds — fail the run if breached. */
export const THRESHOLDS = {
  http_req_failed: ['rate<0.02'],
  http_req_duration: ['p(95)<1500', 'p(99)<3000'],
  'http_req_duration{name:board_open}': ['p(95)<1500'],
  'http_req_duration{name:board_offers}': ['p(95)<1200'],
  'http_req_duration{name:drive_create}': ['p(95)<2000'],
  'http_req_duration{name:drive_apply}': ['p(95)<2000'],
  checks: ['rate>0.95'],
};

export const ROUTES = [
  'Monticello → Brooklyn',
  'South Fallsburg → Manhattan',
  'Woodridge → Borough Park',
  'Kiamesha → Flatbush',
  'Liberty → Williamsburg',
  'Mountaindale → Crown Heights',
  'Monroe → Brooklyn',
  'Monroe → Queens',
];

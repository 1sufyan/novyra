/**
 * Reference data the store needs before anyone can use it. No demo products, prices or orders:
 * the owner configures those (docs/02-database.md §8).
 */

export const PROVINCES = {
  PUNJAB: "Punjab",
  SINDH: "Sindh",
  KP: "Khyber Pakhtunkhwa",
  BALOCHISTAN: "Balochistan",
  ICT: "Islamabad Capital Territory",
  GB: "Gilgit-Baltistan",
  AJK: "Azad Jammu and Kashmir",
} as const;

/** Canonical city list for the checkout picker. Admin can add more; couriers map onto these. */
export const PAKISTAN_CITIES: readonly { name: string; province: string }[] = [
  { name: "Islamabad", province: PROVINCES.ICT },
  { name: "Karachi", province: PROVINCES.SINDH },
  { name: "Hyderabad", province: PROVINCES.SINDH },
  { name: "Sukkur", province: PROVINCES.SINDH },
  { name: "Larkana", province: PROVINCES.SINDH },
  { name: "Nawabshah", province: PROVINCES.SINDH },
  { name: "Mirpur Khas", province: PROVINCES.SINDH },
  { name: "Lahore", province: PROVINCES.PUNJAB },
  { name: "Rawalpindi", province: PROVINCES.PUNJAB },
  { name: "Faisalabad", province: PROVINCES.PUNJAB },
  { name: "Multan", province: PROVINCES.PUNJAB },
  { name: "Gujranwala", province: PROVINCES.PUNJAB },
  { name: "Sialkot", province: PROVINCES.PUNJAB },
  { name: "Bahawalpur", province: PROVINCES.PUNJAB },
  { name: "Sargodha", province: PROVINCES.PUNJAB },
  { name: "Sheikhupura", province: PROVINCES.PUNJAB },
  { name: "Gujrat", province: PROVINCES.PUNJAB },
  { name: "Sahiwal", province: PROVINCES.PUNJAB },
  { name: "Jhelum", province: PROVINCES.PUNJAB },
  { name: "Rahim Yar Khan", province: PROVINCES.PUNJAB },
  { name: "Dera Ghazi Khan", province: PROVINCES.PUNJAB },
  { name: "Okara", province: PROVINCES.PUNJAB },
  { name: "Kasur", province: PROVINCES.PUNJAB },
  { name: "Chiniot", province: PROVINCES.PUNJAB },
  { name: "Peshawar", province: PROVINCES.KP },
  { name: "Mardan", province: PROVINCES.KP },
  { name: "Abbottabad", province: PROVINCES.KP },
  { name: "Mingora", province: PROVINCES.KP },
  { name: "Kohat", province: PROVINCES.KP },
  { name: "Dera Ismail Khan", province: PROVINCES.KP },
  { name: "Mansehra", province: PROVINCES.KP },
  { name: "Nowshera", province: PROVINCES.KP },
  { name: "Quetta", province: PROVINCES.BALOCHISTAN },
  { name: "Gwadar", province: PROVINCES.BALOCHISTAN },
  { name: "Turbat", province: PROVINCES.BALOCHISTAN },
  { name: "Gilgit", province: PROVINCES.GB },
  { name: "Skardu", province: PROVINCES.GB },
  { name: "Muzaffarabad", province: PROVINCES.AJK },
  { name: "Mirpur", province: PROVINCES.AJK },
];

/** Fallback zone so every city resolves to one. The owner adds narrower zones with their rates. */
export const DEFAULT_ZONE = { name: "Pakistan", countryCode: "PK" } as const;

/**
 * Shipping methods offered once the owner adds rates for them (a method without a rate is not
 * offered at checkout).
 */
export const SHIPPING_METHODS = [
  {
    code: "standard",
    name: "Standard delivery",
    description: "Tracked courier delivery.",
    isInsured: false,
    requiresSignature: false,
    position: 0,
  },
  {
    code: "insured-express",
    name: "Insured express",
    description: "Faster, insured to the order value, signature on delivery.",
    isInsured: true,
    requiresSignature: true,
    position: 1,
  },
] as const;

/** Payment methods that need no external account (D1). Gateways are added when onboarded. */
export const PAYMENT_METHODS = [
  {
    providerCode: "cod",
    type: "CASH_ON_DELIVERY",
    displayName: "Cash on Delivery",
    description: "Pay in cash when your order arrives. We confirm every order by WhatsApp or phone first.",
    isEnabled: true,
    position: 0,
  },
  {
    providerCode: "bank_transfer",
    type: "BANK_TRANSFER",
    displayName: "Bank transfer",
    description: "Transfer to our bank account and upload the receipt.",
    // Stays off until the owner enters the account details shown to customers.
    isEnabled: false,
    position: 1,
  },
] as const;

export const DEFAULT_LOCATION = { code: "MAIN", name: "Main stock" } as const;

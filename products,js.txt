// LEVI SUPPLYZ — live inventory
//
// Pricing works in two parts per schedule:
//  - "exact": a fixed TOTAL price for quantities 1 through however high it goes
//    (your pricing isn't linear at low quantities, so these are exact totals,
//    not unit price × quantity)
//  - "tiers": once you're past the exact table, a per-unit rate kicks in for
//    a quantity range. The bot picks the tier whose [min, max] contains the
//    order quantity and multiplies unit rate × quantity.
//
// Edit stock counts here as they change, or whenever you add/remove sizes.
// Setting a size to 0 means it simply won't show up as an option to order.

const BAPE_SCHEDULE = {
  exact: {
    1: 42, 2: 80, 3: 114, 4: 144, 5: 175,
    6: 204, 7: 231, 8: 256, 9: 279, 10: 300,
  },
  tiers: [
    { min: 11, max: 49, unit: 30 },
    { min: 50, max: 99, unit: 27 },
    { min: 100, max: Infinity, unit: 23 },
  ],
};

const AIRPODS_SCHEDULE = {
  exact: {
    1: 40, 2: 75, 3: 105, 4: 135, 5: 150, 6: 175,
  },
  tiers: [
    { min: 7, max: 9, unit: 29 },
    { min: 10, max: 14, unit: 28 },
    { min: 15, max: Infinity, unit: 25 },
  ],
};

module.exports = [
  // ---------------- BAPE ----------------
  {
    id: 'bape-blue-camo-tee',
    name: 'Blue Camo Bape Tee',
    category: 'Bape',
    schedule: BAPE_SCHEDULE,
    stock: { L: 7, XL: 9 },
  },
  {
    id: 'bape-camo-black-tee',
    name: 'Camo Black Bape Tee',
    category: 'Bape',
    schedule: BAPE_SCHEDULE,
    stock: { S: 1, M: 1 },
  },
  {
    id: 'bape-baby-milo-white-tee',
    name: 'Baby Milo White Bape Tee',
    category: 'Bape',
    schedule: BAPE_SCHEDULE,
    stock: { L: 2, XL: 2 },
  },
  {
    id: 'bape-baby-milo-blue-tee',
    name: 'Baby Milo Blue Bape Tee',
    category: 'Bape',
    schedule: BAPE_SCHEDULE,
    stock: { L: 1, XL: 2 },
  },
  {
    id: 'bape-black-chrome-tee',
    name: 'Black Chrome Bape Tee',
    category: 'Bape',
    schedule: BAPE_SCHEDULE,
    stock: { S: 3, L: 1, XL: 8 },
  },
  {
    id: 'bape-coach-tee',
    name: 'Bape Coach Tee',
    category: 'Bape',
    schedule: BAPE_SCHEDULE,
    stock: { M: 1 },
  },
  {
    id: 'bape-red-camo-tee',
    name: 'Red Camo Bape Tee',
    category: 'Bape',
    schedule: BAPE_SCHEDULE,
    stock: { S: 1, L: 2, XL: 7 },
  },
  {
    id: 'bape-blackberry-tee',
    name: 'Blackberry Bape Tee',
    category: 'Bape',
    schedule: BAPE_SCHEDULE,
    stock: { S: 3, M: 5, L: 3, XL: 8 },
  },
  {
    id: 'bape-whiteberry-tee',
    name: 'Whiteberry Bape Tee',
    category: 'Bape',
    schedule: BAPE_SCHEDULE,
    stock: { S: 1, M: 2, L: 4, XL: 9 },
  },
  {
    id: 'bape-purple-camo-tee',
    name: 'Purple Camo Bape Tee',
    category: 'Bape',
    schedule: BAPE_SCHEDULE,
    stock: { S: 1 },
  },
  {
    id: 'bape-black-college-tee',
    name: 'Black College Bape Tee',
    category: 'Bape',
    schedule: BAPE_SCHEDULE,
    stock: { S: 4, M: 5, L: 10, XL: 10 },
  },

  // ---------------- ESSENTIALS ----------------
  {
    id: 'essentials-dark-oatmeal-shorts',
    name: 'Dark Oatmeal Essentials Shorts',
    category: 'Essentials',
    schedule: BAPE_SCHEDULE,
    stock: { S: 4 },
  },
  {
    id: 'essentials-black-shorts',
    name: 'Black Essentials Shorts',
    category: 'Essentials',
    schedule: BAPE_SCHEDULE,
    stock: { S: 4 },
  },

  // ---------------- CHROME HEARTS ----------------
  // none in stock right now — add items here when restocked

  // ---------------- AIRPODS ----------------
  {
    id: 'airpods-pro-gen2',
    name: 'AirPods Pro Gen 2',
    category: 'Airpods',
    schedule: AIRPODS_SCHEDULE,
    stock: 100, // no sizes — flat stock count
  },

  // ---------------- EXTRAS ----------------
  {
    id: 'extras-rwb-cough-syrup-shorts',
    name: 'Red White & Blue Cough Syrup Shorts',
    category: 'Extras',
    schedule: BAPE_SCHEDULE,
    stock: { M: 2 },
  },
  {
    id: 'extras-burberry-swimsuit',
    name: 'Burberry Swimsuit',
    category: 'Extras',
    schedule: BAPE_SCHEDULE,
    stock: { L: 1 },
  },
  {
    id: 'extras-bw-spider-tee',
    name: 'Black & White Spider Tee',
    category: 'Extras',
    schedule: BAPE_SCHEDULE,
    stock: { M: 1 },
  },
  {
    id: 'extras-cough-syrup-rwb-tee',
    name: 'Cough Syrup Red White & Blue Tee',
    category: 'Extras',
    schedule: BAPE_SCHEDULE,
    stock: { M: 2 },
  },
  {
    id: 'extras-pink-yellow-bape-tee',
    name: 'Pink & Yellow Bape Tee',
    category: 'Extras',
    schedule: BAPE_SCHEDULE,
    stock: { M: 1 },
  },
  {
    id: 'extras-bape-camo-white-tee',
    name: 'Bape Camo White Tee',
    category: 'Extras',
    schedule: BAPE_SCHEDULE,
    stock: { L: 1 },
  },
  {
    id: 'extras-bw-palm-angels-tee',
    name: 'Black & White Palm Angels Tee',
    category: 'Extras',
    schedule: BAPE_SCHEDULE,
    stock: { M: 1 },
  },
  {
    id: 'extras-bw-cough-syrup-shirt',
    name: 'Black & White Cough Syrup Shirt',
    category: 'Extras',
    schedule: BAPE_SCHEDULE,
    stock: { M: 1 },
  },
];
/**
 * Coin packs for sale (design doc 10.1: coins are bought with real money through Paystack; naira prices appear only
 * on the buy-coins screen). The server reads the price and the coins from here, never from the phone. First prices
 * to tune (owner, 19 Oct 2026): about ₦1 a coin, more coins for bigger packs.
 */
export type CoinPack = { id: string; name: string; coins: number; naira: number };

export const COIN_PACKS: readonly CoinPack[] = [
  { id: "handful", name: "A handful", coins: 500, naira: 500 },
  { id: "pouch", name: "A pouch", coins: 1200, naira: 1000 },
  { id: "bag", name: "A bag", coins: 3200, naira: 2500 },
  { id: "chest", name: "A chest", coins: 7000, naira: 5000 },
  { id: "vault", name: "A vault", coins: 15000, naira: 10000 },
];

export const packById = (id: string) => COIN_PACKS.find((p) => p.id === id) ?? null;

/** How many more coins than ₦1 a coin, as a percentage (0 for the smallest pack). */
export const packBonus = (p: CoinPack) => Math.round((p.coins / p.naira - 1) * 100);

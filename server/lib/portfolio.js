// WealthCore — Portfolio Engine.
//
// For each holding:    Quantity × Current Price = Current Value
// Then:                Current Value − Invested Value = P&L
// For the portfolio:   SUM(Holdings) = Portfolio Value
//
// The engine also validates the arithmetic and flags any holding where the
// stored price would produce an inconsistency.

import * as money from './money.js';
import { getHoldingsValuation } from './networth.js';

export function computePortfolio(db, userId) {
  const valuations = getHoldingsValuation(db, userId);

  let totalValueMinor = 0;
  let totalCostMinor = 0;
  let unpricedCount = 0;
  const byAssetClass = new Map();
  const perHolding = [];

  for (const h of valuations) {
    totalValueMinor = money.add(totalValueMinor, h.currentValueMinor);
    totalCostMinor = money.add(totalCostMinor, h.costBasisMinor);
    if (h.priceMissing) unpricedCount++;
    const cls = h.assetClass || 'other';
    byAssetClass.set(cls, (byAssetClass.get(cls) || 0) + h.currentValueMinor);
    perHolding.push(h);
  }

  const totalValue = Number(totalValueMinor);
  const totalCost = Number(totalCostMinor);
  const totalPnl = Number(BigInt(totalValue) - BigInt(totalCost));

  // Automatic arithmetic validation of the portfolio invariant.
  const calcSum = perHolding.reduce((acc, h) => acc + h.currentValueMinor, 0);
  const validation = {
    invariantHolds: calcSum === totalValue,
    calcSum,
    totalValue,
    mismatches: perHolding.filter((h) => {
      const recomputed = Math.round(Number(h.quantity) * h.priceMinor);
      return recomputed !== h.currentValueMinor;
    }).length,
  };

  return {
    totalValueMinor: totalValue,
    totalCostMinor: totalCost,
    totalPnlMinor: totalPnl,
    totalPnlPct: totalCost ? (totalPnl / totalCost) : 0,
    holdingsCount: perHolding.length,
    unpricedCount,
    byAssetClass: [...byAssetClass.entries()].map(([name, valueMinor]) => ({
      name,
      valueMinor,
      pct: totalValue ? (valueMinor / totalValue) : 0,
    })),
    holdings: perHolding,
    validation,
  };
}

export default { computePortfolio };

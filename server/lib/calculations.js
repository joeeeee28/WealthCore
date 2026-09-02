// WealthCore — deterministic financial calculator engine.
//
// ABSOLUTE RULE 6: No financial calculation in WealthCore may depend on an LLM.
// Every formula below is closed-form or a deterministic numeric solver and is
// covered by automated tests asserting known expected results.
//
// All rates are expressed as decimals (e.g. 8.5% = 0.085) unless stated.

import * as money from './money.js';

const DAYS_PER_YEAR = 365;

/** Compound annual growth rate. */
export function cagr(beginValue, endValue, years) {
  if (years <= 0) throw new Error('CAGR years must be > 0');
  if (beginValue <= 0) throw new Error('CAGR begin value must be > 0');
  if (endValue <= 0) throw new Error('CAGR end value must be > 0');
  return (endValue / beginValue) ** (1 / years) - 1;
}

/**
 * Equated Monthly Instalment (EMI).
 * Formula: P * r * (1+r)^n / ((1+r)^n - 1)
 */
export function emi(principal, annualRate, months) {
  if (principal <= 0) throw new Error('EMI principal must be > 0');
  if (months <= 0) throw new Error('EMI months must be > 0');
  const r = annualRate / 12;
  if (r === 0) return principal / months;
  const factor = (1 + r) ** months;
  return principal * r * factor / (factor - 1);
}

/**
 * Full amortization schedule for a loan.
 * Returns { emi, totalInterest, schedule: [{month, principal, interest, balance}] }
 */
export function amortization(principal, annualRate, months) {
  const r = annualRate / 12;
  const e = r === 0 ? principal / months : emi(principal, annualRate, months);
  let balance = principal;
  let totalInterest = 0;
  const schedule = [];
  for (let m = 1; m <= months; m++) {
    const interest = balance * r;
    const principalPart = e - interest;
    // In the final month clamp tiny residuals so the balance lands exactly on 0.
    const adjustedPrincipal = m === months ? balance : principalPart;
    const adjustedEmi = m === months ? interest + balance : e;
    balance = balance - adjustedPrincipal;
    if (balance < 1e-9) balance = 0;
    totalInterest += interest;
    schedule.push({
      month: m,
      principal: round2(adjustedPrincipal),
      interest: round2(interest),
      emi: round2(adjustedEmi),
      balance: round2(balance),
    });
  }
  return { emi: round2(e), totalInterest: round2(totalInterest), schedule };
}

/**
 * SIP future value.
 * @param monthlyInvestment monthly contribution (major units)
 * @param annualRate        annual return (decimal)
 * @param months            number of months
 * @param atBeginning       true = annuity due (deposit at start of month), false = deposit at end
 */
export function sipFutureValue(monthlyInvestment, annualRate, months, atBeginning = true) {
  if (months <= 0) throw new Error('SIP months must be > 0');
  const i = annualRate / 12;
  if (i === 0) return monthlyInvestment * months;
  const factor = ((1 + i) ** months - 1) / i;
  return atBeginning ? monthlyInvestment * factor * (1 + i) : monthlyInvestment * factor;
}

/**
 * Fixed-Deposit maturity value with periodic compounding.
 * Formula: P * (1 + r/n)^(n*t)
 */
export function fdMaturity(principal, annualRate, compoundingPerYear, years) {
  if (principal <= 0) throw new Error('FD principal must be > 0');
  if (compoundingPerYear <= 0) throw new Error('FD compoundingPerYear must be > 0');
  if (years <= 0) throw new Error('FD years must be > 0');
  return principal * (1 + annualRate / compoundingPerYear) ** (compoundingPerYear * years);
}

/** Simple-interest maturity (rare for FD but useful for some instruments). */
export function simpleInterestMaturity(principal, annualRate, years) {
  return principal * (1 + annualRate * years);
}

/**
 * Extended Internal Rate of Return (XIRR) for a list of dated cash flows.
 * @param flows [{date: Date|string, amount: number}] amount is +/- in major units
 * @returns internal rate of return as a decimal
 */
export function xirr(flows, guess = 0.1) {
  if (!Array.isArray(flows) || flows.length < 2) {
    throw new Error('XIRR requires at least two cash flows');
  }
  const parsed = flows.map((f) => {
    const d = f.date instanceof Date ? f.date : new Date(f.date);
    if (Number.isNaN(d.getTime())) throw new Error(`Invalid date in XIRR flow: ${f.date}`);
    return { t: d.getTime(), amount: Number(f.amount) };
  });
  parsed.sort((a, b) => a.t - b.t);
  const t0 = parsed[0].t;

  function npv(rate) {
    let sum = 0;
    for (const { t, amount } of parsed) {
      sum += amount / (1 + rate) ** ((t - t0) / DAYS_PER_YEAR / 86400000);
    }
    return sum;
  }

  // Newton iteration with bisection fallback for robustness.
  let rate = guess;
  for (let i = 0; i < 60; i++) {
    const f = npv(rate);
    const h = 1e-6;
    const fprime = (npv(rate + h) - npv(rate - h)) / (2 * h);
    if (Math.abs(fprime) < 1e-12) break;
    const next = rate - f / fprime;
    if (!Number.isFinite(next)) break;
    if (Math.abs(next - rate) < 1e-10) { rate = next; break; }
    rate = next;
  }

  // bisection on [lo, hi] to guarantee convergence and validity.
  let lo = -0.999999, hi = 10;
  let flo = npv(lo);
  for (let i = 0; i < 240; i++) {
    if (flo === 0) return lo;
    let mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (flo * fm <= 0) { hi = mid; }
    else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}

/** Savings rate = (income - expense) / income. */
export function savingsRate(income, expense) {
  if (income <= 0) throw new Error('Savings rate requires income > 0');
  return (income - expense) / income;
}

/** Debt ratio = total liabilities / total assets. */
export function debtRatio(totalLiabilities, totalAssets) {
  if (totalAssets <= 0) return 0;
  return totalLiabilities / totalAssets;
}

/** Investment rate = investments / income. */
export function investmentRate(investments, income) {
  if (income <= 0) return 0;
  return investments / income;
}

/** Inflation-adjusted value of an amount in future (real) terms. */
export function futureValue(amount, inflationRate, years) {
  return amount / (1 + inflationRate) ** years;
}

/** Inflation-adjusted value of amount in current terms given past years. */
export function presentValue(amount, inflationRate, years) {
  return amount * (1 + inflationRate) ** years;
}

/** Total return %. */
export function totalReturn(begin, end) {
  if (begin === 0) return 0;
  return (end - begin) / begin;
}

/** Percentage change helper producing a rounded percent number. */
export function pctChange(begin, end) {
  if (begin === 0) return 0;
  return ((end - begin) / begin) * 100;
}

function round2(x) {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

export default {
  cagr, emi, amortization, sipFutureValue, fdMaturity, simpleInterestMaturity,
  xirr, savingsRate, debtRatio, investmentRate, futureValue, presentValue,
  totalReturn, pctChange,
};

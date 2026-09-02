// WealthCore — Mock AA synthetic fixture data.
//
// TEST DATA — NOT REAL FINANCIAL DATA.
// Deterministic IDs so tests / imports are stable and idempotent.
// This mimics a set of ReBIT-adjacent deposit/equity/mutual-fund payloads as
// returned by a real Account Aggregator, but with clearly fabricated values.

export const MOCK_FIPS = [
  { fipId: 'NMB0000001', name: 'Mock Bank (Savings & Current)' },
  { fipId: 'NMB0000002', name: 'Mock Bank (Credit Card)' },
  { fipId: 'NMB0000003', name: 'Mock Broker (Equity & MF)' },
  { fipId: 'NMB0000004', name: 'Mock Insurance' },
];

// Each account mirrors a ReBIT deposit/equity "Account" with stable IDs.
export const MOCK_ACCOUNTS = [
  {
    fipId: 'NMB0000001',
    linkRefNumber: 'MOCK-LINK-SAV-0001',
    maskedAccNumber: 'XXXXXX4200',
    accountType: 'SAVINGS',
    name: 'Salary Savings Account',
    currency: 'INR',
    currentBalanceMinor: 25899000, // ₹2,58,990.00
    balanceDateTime: '2026-08-31T23:59:00.000Z',
    isLiability: false,
  },
  {
    fipId: 'NMB0000001',
    linkRefNumber: 'MOCK-LINK-CUR-0002',
    maskedAccNumber: 'XXXXXX1100',
    accountType: 'CURRENT',
    name: 'Current Account',
    currency: 'INR',
    currentBalanceMinor: 110000000, // ₹11,00,000.00
    balanceDateTime: '2026-08-31T23:59:00.000Z',
    isLiability: false,
  },
  {
    fipId: 'NMB0000002',
    linkRefNumber: 'MOCK-LINK-CC-0003',
    maskedAccNumber: 'XXXXXX7700',
    accountType: 'CREDIT_CARD',
    name: 'Credit Card',
    currency: 'INR',
    currentBalanceMinor: -4250000, // owed ₹42,500 -> liability
    balanceDateTime: '2026-08-31T23:59:00.000Z',
    isLiability: true,
  },
  {
    fipId: 'NMB0000001',
    linkRefNumber: 'MOCK-LINK-FD-0004',
    maskedAccNumber: 'XXXXXX3300',
    accountType: 'TERM_DEPOSIT',
    name: 'Fixed Deposit',
    currency: 'INR',
    currentBalanceMinor: 150000000, // ₹15,00,000.00
    balanceDateTime: '2026-08-31T23:59:00.000Z',
    isLiability: false,
  },
  {
    fipId: 'NMB0000003',
    linkRefNumber: 'MOCK-LINK-BRK-0005',
    maskedAccNumber: 'XXXXXX9900',
    accountType: 'BROKERAGE',
    name: 'Brokerage / Demat',
    currency: 'INR',
    currentBalanceMinor: 0,
    balanceDateTime: '2026-08-31T23:59:00.000Z',
    isLiability: false,
  },
];

export const MOCK_HOLDINGS = [
  { accountLinkRef: 'MOCK-LINK-BRK-0005', securityName: 'Reliance Industries', ticker: 'RELIANCE', assetClass: 'equity', currency: 'INR', quantity: '10', priceMinor: 295000, costBasisTotalMinor: 2450000 },
  { accountLinkRef: 'MOCK-LINK-BRK-0005', securityName: 'HDFC Bank', ticker: 'HDFCBANK', assetClass: 'equity', currency: 'INR', quantity: '20', priceMinor: 168000, costBasisTotalMinor: 3200000 },
  { accountLinkRef: 'MOCK-LINK-BRK-0005', securityName: 'Nifty 50 Index Fund', ticker: 'NIFTY50', assetClass: 'mutual_fund', currency: 'INR', quantity: '120', priceMinor: 24500, costBasisTotalMinor: 2400000 },
  { accountLinkRef: 'MOCK-LINK-BRK-0005', securityName: 'Gold ETF', ticker: 'GOLDBEES', assetClass: 'gold', currency: 'INR', quantity: '15', priceMinor: 69000, costBasisTotalMinor: 960000 },
  { accountLinkRef: 'MOCK-LINK-BRK-0005', securityName: 'Sovereign Gold Bond 2028', ticker: 'SGB2028', assetClass: 'gold', currency: 'INR', quantity: '2', priceMinor: 685000, costBasisTotalMinor: 1210000 },
];

// Employment Provident Fund, Public Provident Fund, NPS (retirement).
export const MOCK_RETIREMENT = [
  { accountLinkRef: 'MOCK-LINK-RET-0006', instrumentType: 'EPF', name: 'Employees Provident Fund', currency: 'INR', currentBalanceMinor: 320000000, maskedAccNumber: 'XXXXXX5550' },
  { accountLinkRef: 'MOCK-LINK-RET-0007', instrumentType: 'PPF', name: 'Public Provident Fund', currency: 'INR', currentBalanceMinor: 180000000, maskedAccNumber: 'XXXXXX6660' },
  { accountLinkRef: 'MOCK-LINK-RET-0008', instrumentType: 'NPS', name: 'National Pension System', currency: 'INR', currentBalanceMinor: 96000000, maskedAccNumber: 'XXXXXX7770' },
];

export const MOCK_INSURANCE = [
  { accountLinkRef: 'MOCK-LINK-INS-0009', policyType: 'LIFE', name: 'Term Life Insurance', currency: 'INR', sumAssuredMinor: 1000000000, premiumMinor: 1200000 },
  { accountLinkRef: 'MOCK-LINK-INS-0010', policyType: 'HEALTH', name: 'Health Insurance (Family)', currency: 'INR', sumAssuredMinor: 100000000, premiumMinor: 2400000 },
  { accountLinkRef: 'MOCK-LINK-INS-0011', policyType: 'VEHICLE', name: 'Car Insurance', currency: 'INR', sumAssuredMinor: 5000000, premiumMinor: 480000 },
];

// Transactions with stable ids (idempotency). Date range Aug 2026.
export const MOCK_TRANSACTIONS = [
  { txnId: 'MTX-0001', accountLinkRef: 'MOCK-LINK-SAV-0001', transactionType: 'CREDIT', amountMinor: 15000000, narration: 'Salary ACME Corp', transactionDateTime: '2026-08-01T09:00:00.000Z', category: 'Salary' },
  { txnId: 'MTX-0002', accountLinkRef: 'MOCK-LINK-SAV-0001', transactionType: 'DEBIT', amountMinor: 1800000, narration: 'Rent Landlord', transactionDateTime: '2026-08-05T10:00:00.000Z', category: 'Housing' },
  { txnId: 'MTX-0003', accountLinkRef: 'MOCK-LINK-SAV-0001', transactionType: 'DEBIT', amountMinor: 1240000, narration: 'BigBasket Groceries', transactionDateTime: '2026-08-07T12:00:00.000Z', category: 'Food' },
  { txnId: 'MTX-0004', accountLinkRef: 'MOCK-LINK-SAV-0001', transactionType: 'DEBIT', amountMinor: 860000, narration: 'Electricity Bill', transactionDateTime: '2026-08-12T11:00:00.000Z', category: 'Utilities' },
  { txnId: 'MTX-0005', accountLinkRef: 'MOCK-LINK-SAV-0001', transactionType: 'DEBIT', amountMinor: 580000, narration: 'Swiggy Dining', transactionDateTime: '2026-08-15T13:00:00.000Z', category: 'Food' },
  { txnId: 'MTX-0006', accountLinkRef: 'MOCK-LINK-SAV-0001', transactionType: 'DEBIT', amountMinor: 650000, narration: 'Netflix Subscription', transactionDateTime: '2026-08-20T08:00:00.000Z', category: 'Subscriptions' },
  { txnId: 'MTX-0007', accountLinkRef: 'MOCK-LINK-SAV-0001', transactionType: 'DEBIT', amountMinor: 1200000, narration: 'SIP Index Fund', transactionDateTime: '2026-08-25T09:00:00.000Z', category: 'Investments' },
  { txnId: 'MTX-0008', accountLinkRef: 'MOCK-LINK-SAV-0001', transactionType: 'DEBIT', amountMinor: 1860000, narration: 'Car Loan EMI', transactionDateTime: '2026-08-18T09:00:00.000Z', category: 'EMI/Debt' },
  { txnId: 'MTX-0009', accountLinkRef: 'MOCK-LINK-SAV-0001', transactionType: 'DEBIT', amountMinor: 2400000, narration: 'Term Insurance Premium', transactionDateTime: '2026-08-22T09:00:00.000Z', category: 'Insurance' },
  { txnId: 'MTX-0010', accountLinkRef: 'MOCK-LINK-CC-0003', transactionType: 'CREDIT', amountMinor: 4250000, narration: 'Credit card bill payment', transactionDateTime: '2026-08-28T09:00:00.000Z', category: 'Transfer' },
  { txnId: 'MTX-0011', accountLinkRef: 'MOCK-LINK-SAV-0001', transactionType: 'DEBIT', amountMinor: 4250000, narration: 'Credit card bill payment', transactionDateTime: '2026-08-28T09:00:00.000Z', category: 'Transfer' },
  { txnId: 'MTX-0012', accountLinkRef: 'MOCK-LINK-SAV-0001', transactionType: 'DEBIT', amountMinor: 900000, narration: 'Uber Travel', transactionDateTime: '2026-08-23T19:00:00.000Z', category: 'Transport' },
];

// Loans associated with the mock FIPs.
export const MOCK_LOANS = [
  { accountLinkRef: 'MOCK-LINK-LOAN-0012', loanType: 'CAR_LOAN', name: 'Car Loan', currency: 'INR', outstandingMinor: 115000000, emiMinor: 1860000 },
  { accountLinkRef: 'MOCK-LINK-LOAN-0013', loanType: 'HOME_LOAN', name: 'Home Loan', currency: 'INR', outstandingMinor: 1850000000, emiMinor: 14500000 },
];

/**
 * Assemble a full canonical synthetic FinancialData envelope for the Mock AA.
 * Every value is fabricated; nothing is real.
 */
export function buildMockFinancialData() {
  return {
    provider: 'mock',
    fips: MOCK_FIPS,
    accounts: MOCK_ACCOUNTS,
    holdings: MOCK_HOLDINGS,
    retirement: MOCK_RETIREMENT,
    insurance: MOCK_INSURANCE,
    transactions: MOCK_TRANSACTIONS,
    loans: MOCK_LOANS,
  };
}

export default {
  MOCK_FIPS, MOCK_ACCOUNTS, MOCK_HOLDINGS, MOCK_RETIREMENT, MOCK_INSURANCE,
  MOCK_TRANSACTIONS, MOCK_LOANS, buildMockFinancialData,
};

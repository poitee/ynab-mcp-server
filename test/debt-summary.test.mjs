import { test } from "node:test";
import assert from "node:assert/strict";
import { DEBT_SUMMARY_SORT, presentDebtSummary, summarizeDebtAccounts } from "../lib/debt-summary.mjs";

const AS_OF = "2026-10-13";
const NOTE = `RAW &amp; note ${"x".repeat(200)}`;
const NOTE_EXCERPT = `RAW &amp; note ${"x".repeat(144)}…`;

const accounts = [
  {
    id: "card-visa",
    name: "Visa",
    type: "creditCard",
    on_budget: true,
    closed: false,
    deleted: false,
    balance: -2009670,
    last_reconciled_at: "2026-08-01T12:00:00Z",
    note: null,
    debt_interest_rates: { "2026-01-01": 19.99 },
    debt_minimum_payments: { "2026-01-01": 35000 },
    debt_escrow_amounts: null,
  },
  {
    id: "loan-auto",
    name: "Auto Loan",
    type: "autoLoan",
    on_budget: false,
    closed: false,
    deleted: false,
    balance: -5000000,
    last_reconciled_at: "2026-03-01T00:00:00.000Z",
    note: NOTE,
    debt_interest_rates: { "2024-01-01": 4.5, "2025-06-01": 5.25, "2099-01-01": 99 },
    debt_minimum_payments: { "2024-01-01": 200000, "2025-06-01": 250000, "2099-01-01": 999000 },
    debt_escrow_amounts: { "2025-01-01": 50000, "2025-06-01": 75000 },
  },
  {
    id: "loan-small",
    name: "Small Personal",
    type: "personalLoan",
    on_budget: false,
    closed: false,
    deleted: false,
    balance: -1000000,
    last_reconciled_at: null,
    note: "",
    debt_interest_rates: { "2025-06-01": 5.25 },
    debt_minimum_payments: null,
    debt_escrow_amounts: null,
  },
  {
    id: "med-1",
    name: "Medical",
    type: "medicalDebt",
    on_budget: false,
    closed: false,
    deleted: false,
    balance: -9000000,
    last_reconciled_at: null,
    debt_interest_rates: null,
    debt_minimum_payments: null,
    debt_escrow_amounts: null,
  },
  {
    id: "mortgage-old",
    name: "Old Mortgage",
    type: "mortgage",
    on_budget: false,
    closed: true,
    deleted: false,
    balance: -100,
    last_reconciled_at: "2020-01-01T00:00:00Z",
    note: "paid off",
    debt_interest_rates: { "2020-01-01": 3 },
    debt_minimum_payments: { "2020-01-01": 1 },
    debt_escrow_amounts: { "2020-01-01": 2 },
  },
  { id: "checking", name: "Checking", type: "checking", balance: 5000000, closed: false, deleted: false },
  { id: "liability", name: "Other Liability", type: "otherLiability", balance: -50, closed: false, deleted: false },
  { id: "gone", name: "Deleted Card", type: "otherDebt", balance: -42, closed: false, deleted: true },
];

const transactions = [
  { id: "card-start", account_id: "card-visa", date: "2024-01-01", amount: -1000000, cleared: "cleared", deleted: false },
  { id: "card-reconciled", account_id: "card-visa", date: "2025-06-01", amount: -500000, cleared: "reconciled", deleted: false },
  { id: "card-uncleared", account_id: "card-visa", date: "2026-09-01", amount: -599540, cleared: "uncleared", deleted: false },
  { id: "card-payment", account_id: "card-visa", date: "2026-09-20", amount: 100000, cleared: "cleared", deleted: false },
  { id: "card-deleted", account_id: "card-visa", date: "2026-09-02", amount: -888888, cleared: "cleared", deleted: true },
  { id: "auto-start", account_id: "loan-auto", date: "2020-01-01", amount: -6000000, cleared: "reconciled", deleted: false },
  { id: "pay-a", account_id: "loan-auto", date: "2026-04-01", amount: 500000, cleared: "cleared", deleted: false },
  { id: "pay-b", account_id: "loan-auto", date: "2026-04-01", amount: 1000000, cleared: "cleared", deleted: false },
  { id: "auto-uncleared", account_id: "loan-auto", date: "2026-05-01", amount: -100000, cleared: "uncleared", deleted: false },
  { id: "auto-deleted", account_id: "loan-auto", date: "2026-05-02", amount: 999999, cleared: "cleared", deleted: true },
  { id: "small-start", account_id: "loan-small", date: "2021-01-01", amount: -1000000, cleared: "cleared", deleted: false },
  { id: "med-start", account_id: "med-1", date: "2022-01-01", amount: -9000000, cleared: "cleared", deleted: false },
  { id: "mortgage-start", account_id: "mortgage-old", date: "2018-01-01", amount: -100, cleared: "reconciled", deleted: false },
  { id: "checking-spend", account_id: "checking", date: "2026-01-01", amount: -5000, cleared: "cleared", deleted: false },
  { id: "gone-txn", account_id: "gone", date: "2026-01-01", amount: -42, cleared: "cleared", deleted: false },
];

function summarize({ includeClosed = false } = {}) {
  return summarizeDebtAccounts({ accounts, transactions, includeClosed, asOf: AS_OF });
}

test("credit card estimated interest is the balance gap, including when the gap is not zero", () => {
  const visa = summarize().accounts.find((account) => account.id === "card-visa");
  assert.deepEqual(visa, {
    id: "card-visa",
    name: "Visa",
    type: "creditCard",
    balance: { milliunits: -2009670, dollars: -2009.67 },
    principal_balance: { milliunits: -1999540, dollars: -1999.54 },
    cleared_principal: { milliunits: -1400000, dollars: -1400 },
    estimated_interest: { milliunits: -10130, dollars: -10.13 },
    has_estimated_interest: true,
    interest_rate: 19.99,
    minimum_payment: { milliunits: 35000, dollars: 35 },
    escrow: null,
    on_budget: true,
    closed: false,
    last_reconciled_at: "2026-08-01T12:00:00Z",
    last_payment: { date: "2026-09-20", amount: { milliunits: 100000, dollars: 100 } },
    note_excerpt: null,
  });
});

test("a loan uses the current dated rate, minimum payment, and escrow", () => {
  const loan = summarize().accounts.find((account) => account.id === "loan-auto");
  assert.deepEqual(loan, {
    id: "loan-auto",
    name: "Auto Loan",
    type: "autoLoan",
    balance: { milliunits: -5000000, dollars: -5000 },
    principal_balance: { milliunits: -4600000, dollars: -4600 },
    cleared_principal: { milliunits: -4500000, dollars: -4500 },
    estimated_interest: { milliunits: -400000, dollars: -400 },
    has_estimated_interest: true,
    interest_rate: 5.25,
    minimum_payment: { milliunits: 250000, dollars: 250 },
    escrow: { milliunits: 75000, dollars: 75 },
    on_budget: false,
    closed: false,
    last_reconciled_at: "2026-03-01T00:00:00.000Z",
    last_payment: { date: "2026-04-01", amount: { milliunits: 1000000, dollars: 1000 } },
    note_excerpt: NOTE_EXCERPT,
  });
  assert.equal(loan.note_excerpt.includes("&amp;"), true);
  assert.equal(loan.note_excerpt.length, 160);
});

test("closed debt accounts are excluded unless include_closed is set", () => {
  const open = summarize();
  assert.equal(open.accounts.some((account) => account.id === "mortgage-old"), false);
  assert.equal(open.accounts.some((account) => account.id === "checking"), false);
  assert.equal(open.accounts.some((account) => account.id === "gone"), false);
  assert.equal(open.account_count, 4);
  const withClosed = summarize({ includeClosed: true });
  assert.deepEqual(withClosed.accounts.map((account) => account.id), [
    "card-visa",
    "loan-auto",
    "loan-small",
    "mortgage-old",
    "med-1",
  ]);
  assert.equal(withClosed.accounts.find((account) => account.id === "mortgage-old").closed, true);
  assert.equal(withClosed.account_count, 5);
  assert.deepEqual(withClosed.totals.total_balance, { milliunits: -17009770, dollars: -17009.77 });
});

test("equal interest rates sort by absolute balance, largest debt magnitude first", () => {
  const summary = summarize();
  assert.equal(summary.sort, DEBT_SUMMARY_SORT);
  assert.deepEqual(summary.accounts.map((account) => account.id), [
    "card-visa",
    "loan-auto",
    "loan-small",
    "med-1",
  ]);
  assert.equal(summary.accounts[1].interest_rate, summary.accounts[2].interest_rate);
  assert.ok(Math.abs(summary.accounts[1].balance.milliunits) > Math.abs(summary.accounts[2].balance.milliunits));
  assert.deepEqual(summary.totals, {
    total_balance: { milliunits: -17009670, dollars: -17009.67 },
    total_principal: { milliunits: -16599540, dollars: -16599.54 },
    total_cleared_principal: { milliunits: -15900000, dollars: -15900 },
    total_estimated_interest: { milliunits: -410130, dollars: -410.13 },
    total_minimum_payment: { milliunits: 285000, dollars: 285 },
  });
});

test("deleted transactions are ignored and cleared principal omits uncleared rows", () => {
  const visa = summarize().accounts.find((account) => account.id === "card-visa");
  assert.equal(visa.principal_balance.milliunits, -1999540);
  assert.equal(visa.cleared_principal.milliunits, -1400000);
  assert.notEqual(visa.principal_balance.milliunits, visa.cleared_principal.milliunits);
});

test("split parents count once and a top-level subtransaction row is ignored", () => {
  const summary = summarizeDebtAccounts({
    asOf: AS_OF,
    accounts: [{ id: "loc", name: "Line", type: "lineOfCredit", balance: -3000, closed: false, deleted: false, debt_interest_rates: { "2026-01-01": 0 } }],
    transactions: [
      { id: "split", account_id: "loc", date: "2026-02-01", amount: -3000, cleared: "cleared", deleted: false, subtransactions: [{ id: "a", amount: -1000 }, { id: "b", amount: -2000 }] },
      { id: "child", account_id: "loc", type: "subtransaction", date: "2026-02-01", amount: -3000, cleared: "cleared", deleted: false },
    ],
  });
  assert.equal(summary.accounts[0].principal_balance.milliunits, -3000);
  assert.equal(summary.accounts[0].estimated_interest.milliunits, 0);
  assert.equal(summary.accounts[0].has_estimated_interest, false);
  assert.equal(summary.accounts[0].interest_rate, 0);
});

test("compact output is totals plus one line per account", () => {
  const compact = presentDebtSummary(summarize(), { verbose: false });
  assert.deepEqual(compact.accounts, [
    "card-visa · Visa · creditCard · balance -2009.67 (-2009670 milliunits) · principal -1999.54 (-1999540 milliunits) · estimated_interest -10.13 (-10130 milliunits) · rate 19.99",
    "loan-auto · Auto Loan · autoLoan · balance -5000 (-5000000 milliunits) · principal -4600 (-4600000 milliunits) · estimated_interest -400 (-400000 milliunits) · rate 5.25",
    "loan-small · Small Personal · personalLoan · balance -1000 (-1000000 milliunits) · principal -1000 (-1000000 milliunits) · estimated_interest 0 (0 milliunits) · rate 5.25",
    "med-1 · Medical · medicalDebt · balance -9000 (-9000000 milliunits) · principal -9000 (-9000000 milliunits) · estimated_interest 0 (0 milliunits) · rate none",
  ]);
  assert.deepEqual(compact.totals.total_estimated_interest, { milliunits: -410130, dollars: -410.13 });
  const verbose = presentDebtSummary(summarize(), { verbose: true });
  assert.equal(verbose.accounts[0].id, "card-visa");
  assert.equal(verbose.accounts[0].has_estimated_interest, true);
});

test("same-day payments pick the greater id and null rates sort after a zero rate", () => {
  const summary = summarizeDebtAccounts({
    asOf: AS_OF,
    accounts: [
      { id: "b-loan", name: "B", type: "studentLoan", balance: -100, closed: false, deleted: false, debt_interest_rates: { "2026-01-01": 1 } },
      { id: "a-loan", name: "A", type: "studentLoan", balance: -100, closed: false, deleted: false, debt_interest_rates: { "2026-01-01": 1 } },
      { id: "zero", name: "Zero", type: "otherDebt", balance: -1, closed: false, deleted: false, debt_interest_rates: { "2026-01-01": 0 } },
      { id: "none", name: "None", type: "otherDebt", balance: -999999, closed: false, deleted: false, debt_interest_rates: null },
    ],
    transactions: [
      { id: "pay-a", account_id: "a-loan", date: "2026-04-01", amount: 40, cleared: "cleared" },
      { id: "pay-b", account_id: "a-loan", date: "2026-04-01", amount: 60, cleared: "cleared" },
    ],
  });
  assert.deepEqual(summary.accounts.map((account) => account.id), ["a-loan", "b-loan", "zero", "none"]);
  assert.deepEqual(summary.accounts[0].last_payment, { date: "2026-04-01", amount: { milliunits: 60, dollars: 0.06 } });
});

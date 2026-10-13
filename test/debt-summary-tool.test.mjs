import { test } from "node:test";
import assert from "node:assert/strict";

process.env.YNAB_MCP_NO_AUTOSTART = "1";
process.env.YNAB_DISABLE_AGENT_CONFIG_FALLBACK = "1";
process.env.YNAB_API_TOKEN = "debt-summary-fake-token";
process.env.YNAB_RATE_LIMIT_PER_HOUR = "0";
const { createYnabServer } = await import("../index.js");

const accounts = [
  {
    id: "card-visa",
    name: "Visa",
    type: "creditCard",
    on_budget: true,
    closed: false,
    deleted: false,
    balance: -2009670,
    cleared_balance: -1500000,
    uncleared_balance: -509670,
    debt_interest_rates: { "2026-01-01": 19.99 },
    debt_minimum_payments: { "2026-01-01": 35000 },
    debt_escrow_amounts: null,
    note: null,
  },
  {
    id: "loan-big",
    name: "Big Loan",
    type: "autoLoan",
    on_budget: false,
    closed: false,
    deleted: false,
    balance: -5000,
    debt_interest_rates: { "2024-01-01": 4, "2026-01-01": 6, "2099-01-01": 99 },
    debt_minimum_payments: { "2026-01-01": 1000 },
    debt_escrow_amounts: { "2026-01-01": 250 },
  },
  {
    id: "loan-small",
    name: "Small Loan",
    type: "autoLoan",
    on_budget: false,
    closed: false,
    deleted: false,
    balance: -1000,
    debt_interest_rates: { "2026-01-01": 6 },
    debt_minimum_payments: null,
    debt_escrow_amounts: null,
  },
  { id: "mortgage-old", name: "Old Mortgage", type: "mortgage", closed: true, deleted: false, balance: -100, debt_interest_rates: { "2020-01-01": 3 } },
  { id: "checking", name: "Checking", type: "checking", closed: false, deleted: false, balance: 8000 },
];

const transactions = [
  { id: "card-cleared", account_id: "card-visa", date: "2024-01-01", amount: -1500000, cleared: "cleared", deleted: false },
  { id: "card-uncleared", account_id: "card-visa", date: "2026-09-01", amount: -599540, cleared: "uncleared", deleted: false },
  { id: "card-payment", account_id: "card-visa", date: "2026-09-20", amount: 100000, cleared: "reconciled", deleted: false },
  { id: "card-deleted", account_id: "card-visa", date: "2026-09-02", amount: -888888, cleared: "cleared", deleted: true },
  { id: "big", account_id: "loan-big", date: "2020-01-01", amount: -5000, cleared: "cleared", deleted: false },
  { id: "small", account_id: "loan-small", date: "2020-01-01", amount: -1000, cleared: "cleared", deleted: false },
  { id: "closed-row", account_id: "mortgage-old", date: "2019-01-01", amount: -100, cleared: "cleared", deleted: false },
  { id: "checking-row", account_id: "checking", date: "2026-01-01", amount: -50, cleared: "cleared", deleted: false },
];

function fakeDebtServer(t) {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(String(url));
    requests.push({ path: parsed.pathname, query: Object.fromEntries(parsed.searchParams), method: init.method || "GET" });
    assert.equal(init.method || "GET", "GET");
    assert.equal(parsed.hostname, "api.ynab.com");
    const tail = parsed.pathname.split("/").at(-1);
    let data;
    if (tail === "accounts") data = { accounts, server_knowledge: 1 };
    else if (tail === "transactions") data = { transactions, server_knowledge: 1 };
    else throw new Error(`Unexpected fake request: ${parsed.pathname}`);
    return new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const instance = createYnabServer({
    hasCredentials: true,
    getAccessToken: async () => "debt-summary-fake-token",
    defaultBudgetId: "fake-budget",
    writesEnabled: false,
    journal: null,
  });
  const call = async (args = {}) => {
    const parsed = instance.internals.parseToolExecuteInput("debt_summary", args);
    const response = await instance.internals.invokeRegisteredTool("debt_summary", parsed);
    return { response, result: response.isError ? null : JSON.parse(response.content[0].text), requests };
  };
  return { call, requests };
}

test("debt_summary reads accounts and full history once and reports the credit card gap", async (t) => {
  const fake = fakeDebtServer(t);
  const { response, result, requests } = await fake.call({ verbose: true });
  assert.equal(response.isError ?? false, false, response.content[0].text);
  assert.equal(requests.length, 2);
  assert.equal(requests.filter((request) => request.path.endsWith("/accounts")).length, 1);
  const history = requests.find((request) => request.path.endsWith("/transactions"));
  assert.equal(history.query.since_date, "1970-01-01");
  assert.equal(result.budget_id, "fake-budget");
  const visa = result.accounts.find((account) => account.id === "card-visa");
  assert.deepEqual(visa.estimated_interest, { milliunits: -10130, dollars: -10.13 });
  assert.equal(visa.principal_balance.milliunits, -1999540);
  assert.equal(visa.cleared_principal.milliunits, -1400000);
  assert.equal(visa.has_estimated_interest, true);
  assert.deepEqual(result.accounts.map((account) => account.id), ["card-visa", "loan-big", "loan-small"]);
  assert.equal(result.accounts.find((account) => account.id === "loan-big").interest_rate, 6);
  assert.equal(result.accounts.some((account) => account.id === "mortgage-old"), false);
  assert.equal(result.accounts.some((account) => account.id === "checking"), false);
});

test("include_closed adds the closed account and compact mode is one line per account", async (t) => {
  const fake = fakeDebtServer(t);
  const compact = await fake.call();
  assert.equal(compact.response.isError ?? false, false, compact.response.content[0].text);
  assert.equal(compact.requests.length, 2);
  assert.equal(compact.result.accounts.every((account) => typeof account === "string"), true);
  assert.match(compact.result.accounts[0], /estimated_interest -10\.13 \(-10130 milliunits\)/);
  assert.equal(compact.result.accounts.some((line) => line.includes("mortgage-old")), false);
  const opened = await fake.call({ include_closed: true });
  assert.equal(opened.result.accounts.some((line) => line.includes("mortgage-old") && line.endsWith("closed")), true);
  assert.equal(opened.requests.length, 4);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createMcpHarness, assertToolOk } from "./support/mcp-harness.mjs";
import { compactCategoryGroup } from "../lib/field-projections.mjs";

const { resolveToolProfile } = await import("../index.js");
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const REMOVED_TOOLS = [
  "list_payee_locations",
  "get_payee_location",
  "get_payee_locations_by_payee",
  "list_money_movements",
  "list_money_movement_groups",
  "get_money_movements_by_month",
  "get_money_movement_groups_by_month",
];

const WRITE_TOOLS = [
  "create_account",
  "update_month_category",
  "update_category",
  "create_category",
  "create_category_group",
  "update_category_group",
  "update_payee",
  "create_payee",
  "create_transaction",
  "create_transactions",
  "update_transaction",
  "delete_transaction",
  "update_transactions",
  "approve_transactions",
  "reassign_payee_transactions",
  "import_transactions",
  "create_scheduled_transaction",
  "update_scheduled_transaction",
  "delete_scheduled_transaction",
  "move_category_budget",
  "resume_operation",
  "merge_category",
  "retire_category",
  "prepare_split_for_matching",
  "undo_operation",
  "ynab_write_tool_execute",
];

function assertProfileTools(names, { writes }) {
  for (const name of REMOVED_TOOLS) {
    assert.equal(names.has(name), false, `${name} must not be registered`);
  }
  for (const name of WRITE_TOOLS) {
    assert.equal(names.has(name), writes, `${name} should ${writes ? "" : "not "}be registered`);
  }
  assert.equal(names.has("list_accounts"), true);
  assert.equal(names.has("preview_write_tool"), true);
}

test("resolveToolProfile stays read-only unless a write opt-in is explicit", () => {
  assert.equal(resolveToolProfile({ env: {}, argv: ["node", "index.js"] }), "read");
  assert.equal(resolveToolProfile({ env: { YNAB_TOOL_PROFILE: "read" }, argv: [] }), "read");
  assert.equal(resolveToolProfile({ env: { YNAB_TOOL_PROFILE: "write" }, argv: [] }), "write");
  assert.equal(resolveToolProfile({ env: {}, argv: ["node", "index.js", "--profile", "write"] }), "write");
  assert.equal(resolveToolProfile({ env: {}, argv: ["node", "index.js", "--profile=write"] }), "write");
  assert.equal(resolveToolProfile({ env: { YNAB_ALLOW_WRITES: "1" }, argv: [] }), "write");
  assert.equal(resolveToolProfile({ env: { YNAB_ALLOW_WRITES: "0", YNAB_TOOL_PROFILE: "read" }, argv: ["--profile", "read"] }), "read");
  assert.equal(resolveToolProfile({ env: { YNAB_TOOL_PROFILE: "read" }, argv: [], allowWrites: true }), "write");
});

test("default profile hides write tools and removed tools", async (t) => {
  const harness = await createMcpHarness({ writesEnabled: false });
  t.after(() => harness.close());
  const names = new Set((await harness.client.listTools()).tools.map((tool) => tool.name));
  assertProfileTools(names, { writes: false });
});

test("write profile registers write tools and still omits removed tools", async (t) => {
  const harness = await createMcpHarness({ writesEnabled: true });
  t.after(() => harness.close());
  const names = new Set((await harness.client.listTools()).tools.map((tool) => tool.name));
  assertProfileTools(names, { writes: true });
});

function childEnv(extra = {}) {
  const env = { ...process.env };
  delete env.YNAB_MCP_NO_AUTOSTART;
  delete env.YNAB_ALLOW_WRITES;
  delete env.YNAB_TOOL_PROFILE;
  delete env.YNAB_OP_PATH;
  delete env.YNAB_API_TOKEN_FILE;
  env.YNAB_API_TOKEN = "test-token-for-list-tools";
  env.YNAB_DISABLE_AGENT_CONFIG_FALLBACK = "1";
  env.YNAB_RATE_LIMIT_PER_HOUR = "0";
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

async function listedNames({ env, args }) {
  const client = new Client({ name: "phase1-trim", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: "node",
    args: ["index.js", ...args],
    cwd: projectRoot,
    env,
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const response = await client.listTools();
    return new Set(response.tools.map((tool) => tool.name));
  } finally {
    await client.close();
  }
}

test("stdio default, YNAB_TOOL_PROFILE=write, and --profile write gate registration", async () => {
  const readOnly = await listedNames({ env: childEnv(), args: [] });
  assertProfileTools(readOnly, { writes: false });
  const fromEnv = await listedNames({ env: childEnv({ YNAB_TOOL_PROFILE: "write" }), args: [] });
  assertProfileTools(fromEnv, { writes: true });
  const fromFlag = await listedNames({ env: childEnv(), args: ["--profile", "write"] });
  assertProfileTools(fromFlag, { writes: true });
});

test("compact category groups keep the internal flag and drop verbose-only fields", () => {
  const compact = compactCategoryGroup({
    id: "g", name: "Internal Master Category", hidden: true, internal: true, deleted: false,
    categories: [{ id: "rta", name: "Inflow: Ready to Assign", category_group_id: "g", hidden: true, internal: true, budgeted: 0, activity: 0, balance: 0, deleted: false, goal_target: 1 }],
  });
  assert.equal(compact.internal, true);
  assert.equal(compact.categories[0].internal, true);
  assert.equal("deleted" in compact, false);
  assert.equal("goal_target" in compact.categories[0], false);
});

test("five read tools are compact by default and unchanged with verbose:true", async (t) => {
  const harness = await createMcpHarness({ writesEnabled: false });
  t.after(() => harness.close());

  const accounts = assertToolOk(await harness.call("list_accounts"));
  assert.deepEqual(accounts, [{
    id: "fake-checking",
    name: "Synthetic checking a",
    type: "checking",
    on_budget: true,
    closed: false,
    balance: 2000,
    cleared_balance: 2000,
    uncleared_balance: 0,
  }]);
  const verboseAccounts = assertToolOk(await harness.call("list_accounts", { verbose: true }));
  assert.equal(verboseAccounts[0].deleted, false);
  assert.equal(verboseAccounts[0].transfer_payee_id, "fake-transfer");
  assert.equal(verboseAccounts[0].debt_original_balance, null);
  assert.equal("debt_original_balance" in accounts[0], false);
  assert.equal("deleted" in accounts[0], false);

  const groups = assertToolOk(await harness.call("list_categories"));
  assert.deepEqual(groups[0], {
    id: "fake-living",
    name: "Living",
    hidden: false,
    internal: false,
    categories: [
      { id: "fake-food", name: "Food", category_group_id: "fake-living", hidden: false, internal: false, budgeted: 100, activity: -12, balance: 88 },
      { id: "fake-travel", name: "Travel", category_group_id: "fake-living", hidden: false, internal: false, budgeted: 20, activity: 0, balance: 20 },
    ],
  });
  const verboseGroups = assertToolOk(await harness.call("list_categories", { verbose: true }));
  const verboseFood = verboseGroups[0].categories[0];
  assert.equal(verboseFood.deleted, false);
  assert.equal(verboseFood.internal, false);
  assert.equal(verboseFood.goal_target, null);
  assert.equal(verboseGroups[0].deleted, false);
  assert.equal(verboseGroups[0].internal, false);
  assert.equal("deleted" in groups[0], false);
  assert.equal("goal_target" in groups[0].categories[0], false);
  assert.equal(groups[0].internal, false);
  assert.equal(groups[0].categories[0].internal, false);

  const month = assertToolOk(await harness.call("get_month", { month: "2026-10-01" }));
  assert.deepEqual(month, {
    month: "2026-10-01",
    income: 0,
    budgeted: 120,
    activity: -12,
    to_be_budgeted: 0,
    categories: [
      { id: "fake-food", name: "Food", hidden: false, budgeted: 100, activity: -12, balance: 88 },
      { id: "fake-travel", name: "Travel", hidden: false, budgeted: 20, activity: 0, balance: 20 },
      { id: "fake-income", name: "Ingresos: por asignar", hidden: false, budgeted: 0, activity: 0, balance: 0 },
    ],
  });
  const verboseMonth = assertToolOk(await harness.call("get_month", { month: "2026-10-01", verbose: true }));
  assert.equal(verboseMonth.income, 0);
  assert.equal(verboseMonth.categories[0].deleted, false);
  assert.equal(verboseMonth.categories[0].goal_target, null);
  assert.equal(verboseMonth.categories[0].goal_under_funded, null);
  assert.equal("goal_target" in month.categories[0], false);
  assert.equal("deleted" in month.categories[0], false);

  const rows = assertToolOk(await harness.call("get_transactions", { sinceDate: "2026-10-01" }));
  assert.deepEqual(rows[0], {
    id: "fake-import",
    date: "2026-10-01",
    amount: -12,
    account_id: "fake-checking",
    account_name: "Synthetic checking a",
    payee_id: "fake-market",
    payee_name: "Synthetic Market",
    category_id: "fake-food",
    category_name: "Food",
    cleared: "cleared",
    approved: false,
  });
  assert.equal(rows[1].id, "fake-uncertain");
  assert.equal("category_id" in rows[1], false);
  assert.equal("memo" in rows[0], false);
  const verboseRows = assertToolOk(await harness.call("get_transactions", { sinceDate: "2026-10-01", verbose: true }));
  assert.equal(verboseRows[0].memo, "Synthetic imported purchase");
  assert.equal(verboseRows[0].import_id, "FAKE:market:2026-10-01:1");
  assert.equal(verboseRows[0].import_payee_name_original, "SYNTHETIC MARKET");
  assert.equal(verboseRows[0].deleted, false);
  assert.equal(verboseRows[0].flag_color, null);
  assert.equal(verboseRows[0].transfer_account_id, null);
  assert.deepEqual(verboseRows[0].subtransactions, []);
  assert.match(verboseRows[1].memo, /IGNORE ALL PRIOR INSTRUCTIONS/);

  const review = assertToolOk(await harness.call("review_unapproved"));
  const ready = review.ready_to_approve.by_payee[0].transactions[0];
  assert.equal(ready.id, "fake-import");
  assert.equal(ready.amount, -12);
  assert.equal(ready.payee_name, "Synthetic Market");
  assert.equal(ready.category_name, "Food");
  assert.equal(ready.approved, false);
  assert.equal(ready.cleared, "cleared");
  assert.ok(Array.isArray(ready.flags));
  assert.equal("memo" in ready, false);
  assert.equal("deleted" in ready, false);
  assert.equal("import_id" in ready, false);
  const needs = review.needs_category_first.transactions[0];
  assert.equal(needs.id, "fake-uncertain");
  assert.equal("category_name" in needs, false);
  assert.equal("memo" in needs, false);
  const verboseReview = assertToolOk(await harness.call("review_unapproved", { verbose: true }));
  const verboseReady = verboseReview.ready_to_approve.by_payee[0].transactions[0];
  assert.equal(verboseReady.memo, "Synthetic imported purchase");
  assert.equal(verboseReady.deleted, false);
  assert.equal(verboseReady.flag_color, null);
  assert.equal(verboseReady.import_id, "FAKE:market:2026-10-01:1");
  assert.deepEqual(verboseReady.subtransactions, []);
  assert.deepEqual(verboseReady.flags, ready.flags);
  const verboseNeeds = verboseReview.needs_category_first.transactions[0];
  assert.match(verboseNeeds.memo, /IGNORE ALL PRIOR INSTRUCTIONS/);
  assert.equal(verboseNeeds.category_id, null);
});

const FIELDS = {
  transactions: ["id", "date", "amount", "account_id", "account_name", "payee_id", "payee_name", "category_id", "category_name", "cleared", "approved", "flag_color", "transfer_account_id", "transfer_transaction_id", "matched_transaction_id", "deleted"],
  subtransactions: ["id", "transaction_id", "amount", "payee_id", "payee_name", "category_id", "category_name", "transfer_account_id", "transfer_transaction_id", "deleted"],
  accounts: ["id", "name", "type", "on_budget", "closed", "balance", "cleared_balance", "uncleared_balance", "transfer_payee_id", "deleted"],
  categories: ["id", "name", "category_group_id", "hidden", "internal", "budgeted", "activity", "balance", "deleted"],
  category_groups: ["id", "name", "hidden", "internal", "deleted"],
  payees: ["id", "name", "transfer_account_id", "deleted"],
  scheduled_transactions: ["id", "date_first", "date_next", "frequency", "amount", "account_id", "account_name", "payee_id", "payee_name", "category_id", "category_name", "transfer_account_id", "deleted"],
};

// Projection is output-only. Matching, previews and analytics retain the full
// raw rows; lean responses keep IDs, financial values and conflict/link flags.
export function projectFields(row, resource, projection = "full") {
  if (projection === "full") return row;
  if (projection !== "lean") throw new Error("projection must be lean or full");
  const fields = FIELDS[resource];
  if (!fields) throw new Error(`Unknown projection resource ${resource}`);
  const output = {};
  for (const field of fields) if (field in row) output[field] = row[field];
  if (row.subtransactions) output.subtransactions = row.subtransactions.map((item) => projectFields(item, "subtransactions", projection));
  if (row.categories) output.categories = row.categories.map((item) => projectFields(item, "categories", projection));
  return output;
}

export function projectCollection(rows, resource, projection = "full") {
  return rows.map((row) => projectFields(row, resource, projection));
}

const TRANSACTION_FIELDS = ["id", "date", "amount", "account_id", "account_name", "payee_id", "payee_name", "category_id", "category_name", "cleared", "approved", "transfer_account_id", "matched_transaction_id"];
const SUBTRANSACTION_FIELDS = ["id", "transaction_id", "amount", "payee_id", "payee_name", "category_id", "category_name", "transfer_account_id"];
const ACCOUNT_FIELDS = ["id", "name", "type", "on_budget", "closed", "balance", "cleared_balance", "uncleared_balance"];
const CATEGORY_FIELDS = ["id", "name", "category_group_id", "category_group_name", "hidden", "internal", "budgeted", "activity", "balance"];
const GROUP_FIELDS = ["id", "name", "hidden", "internal"];
const MONTH_FIELDS = ["month", "income", "budgeted", "activity", "to_be_budgeted", "age_of_money"];
const MONTH_CATEGORY_FIELDS = ["id", "name", "category_group_name", "hidden", "budgeted", "activity", "balance"];

function compactFields(row, fields) {
  const out = {};
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(row, field)) continue;
    const value = row[field];
    if (value == null) continue;
    out[field] = value;
  }
  return out;
}

export function compactTransaction(row, { includeFlags = false } = {}) {
  const out = compactFields(row, includeFlags ? [...TRANSACTION_FIELDS, "flags"] : TRANSACTION_FIELDS);
  if (Array.isArray(row.subtransactions) && row.subtransactions.length) {
    out.subtransactions = row.subtransactions.map((item) => compactFields(item, SUBTRANSACTION_FIELDS));
  }
  return out;
}

export function compactAccount(row) {
  return compactFields(row, ACCOUNT_FIELDS);
}

export function compactCategoryGroup(row) {
  const out = compactFields(row, GROUP_FIELDS);
  if (Array.isArray(row.categories)) out.categories = row.categories.map((item) => compactFields(item, CATEGORY_FIELDS));
  return out;
}

export function compactMonth(row) {
  const out = compactFields(row, MONTH_FIELDS);
  if (Array.isArray(row.categories)) out.categories = row.categories.map((item) => compactFields(item, MONTH_CATEGORY_FIELDS));
  return out;
}

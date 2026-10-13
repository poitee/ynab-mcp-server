// Debt principal is the sum of non-deleted register amounts. Estimated interest
// is the YNAB account balance minus that sum, for every debt type. Interest
// rates stay as YNAB sent them. Amounts on the way in are milliunits.

export const DEBT_ACCOUNT_TYPES = Object.freeze([
  "creditCard",
  "lineOfCredit",
  "mortgage",
  "autoLoan",
  "studentLoan",
  "personalLoan",
  "medicalDebt",
  "otherDebt",
]);

const DEBT_ACCOUNT_TYPE_SET = new Set(DEBT_ACCOUNT_TYPES);
const NOTE_EXCERPT_LIMIT = 160;
const DATED_KEY = /^\d{4}-\d{2}-\d{2}$/;

export const DEBT_SUMMARY_SORT = "interest_rate desc, then absolute balance desc (largest debt magnitude first), then id asc. Null rates sort last.";

function requireMilliunits(value, label) {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer number of milliunits.`);
  }
  return value;
}

function addMilliunits(left, right) {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) {
    throw new Error("Debt summary amounts must stay within safe integer milliunits.");
  }
  return sum;
}

export function moneyFromMilliunits(milliunits) {
  const amount = requireMilliunits(milliunits, "amount");
  return { milliunits: amount, dollars: amount / 1000 };
}

function formatDollars(milliunits) {
  const negative = milliunits < 0;
  const absolute = Math.abs(milliunits);
  const whole = Math.trunc(absolute / 1000);
  const fraction = absolute % 1000;
  const body = fraction === 0
    ? String(whole)
    : `${whole}.${String(fraction).padStart(3, "0").replace(/0+$/, "")}`;
  return negative ? `-${body}` : body;
}

function moneyText(milliunits) {
  return `${formatDollars(milliunits)} (${milliunits} milliunits)`;
}

function currentDatedValue(map, asOf) {
  if (map == null || typeof map !== "object" || Array.isArray(map)) return null;
  let bestKey = null;
  let bestValue = null;
  for (const [key, value] of Object.entries(map)) {
    if (!DATED_KEY.test(key)) continue;
    if (asOf && key > asOf) continue;
    if (bestKey === null || key > bestKey) {
      bestKey = key;
      bestValue = value;
    }
  }
  return bestValue;
}

function currentRate(map, asOf) {
  const value = currentDatedValue(map, asOf);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function currentMilliunits(map, asOf) {
  const value = currentDatedValue(map, asOf);
  return Number.isSafeInteger(value) ? value : null;
}

function noteExcerpt(note) {
  if (typeof note !== "string" || note.length === 0) return null;
  const chars = Array.from(note);
  if (chars.length <= NOTE_EXCERPT_LIMIT) return note;
  return `${chars.slice(0, NOTE_EXCERPT_LIMIT - 1).join("")}…`;
}

function isDebtAccount(account) {
  return !!account && DEBT_ACCOUNT_TYPE_SET.has(account.type) && account.deleted !== true;
}

function compareDebtAccounts(left, right) {
  const leftRate = left.interest_rate;
  const rightRate = right.interest_rate;
  if ((leftRate == null) !== (rightRate == null)) return leftRate == null ? 1 : -1;
  if (leftRate != null && leftRate !== rightRate) return rightRate - leftRate;
  // Equal rates: larger absolute balance first, so the bigger debt comes first.
  const magnitude = Math.abs(right.balance.milliunits) - Math.abs(left.balance.milliunits);
  if (magnitude !== 0) return magnitude;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

function emptyTotals() {
  return {
    total_balance: 0,
    total_principal: 0,
    total_cleared_principal: 0,
    total_estimated_interest: 0,
    total_minimum_payment: 0,
  };
}

export function summarizeDebtAccounts({ accounts = [], transactions = [], includeClosed = false, asOf = null } = {}) {
  const selected = accounts.filter((account) => isDebtAccount(account) && (includeClosed || account.closed !== true));
  const buckets = new Map(selected.map((account) => [account.id, {
    principal: 0,
    cleared: 0,
    lastPayment: null,
  }]));

  for (const txn of transactions) {
    if (!txn || txn.deleted === true || txn.type === "subtransaction") continue;
    const bucket = buckets.get(txn.account_id);
    if (!bucket) continue;
    const amount = requireMilliunits(txn.amount, "transaction amount");
    bucket.principal = addMilliunits(bucket.principal, amount);
    if (txn.cleared === "cleared" || txn.cleared === "reconciled") {
      bucket.cleared = addMilliunits(bucket.cleared, amount);
    }
    if (amount > 0 && typeof txn.date === "string" && DATED_KEY.test(txn.date)) {
      const candidate = { id: txn.id, date: txn.date, amount };
      const current = bucket.lastPayment;
      if (!current || candidate.date > current.date || (candidate.date === current.date && String(candidate.id) > String(current.id))) {
        bucket.lastPayment = candidate;
      }
    }
  }

  const totals = emptyTotals();
  const rows = selected.map((account) => {
    const bucket = buckets.get(account.id);
    const balance = requireMilliunits(account.balance, "account balance");
    const estimated = addMilliunits(balance, -bucket.principal);
    const minimum = currentMilliunits(account.debt_minimum_payments, asOf);
    const escrow = currentMilliunits(account.debt_escrow_amounts, asOf);
    totals.total_balance = addMilliunits(totals.total_balance, balance);
    totals.total_principal = addMilliunits(totals.total_principal, bucket.principal);
    totals.total_cleared_principal = addMilliunits(totals.total_cleared_principal, bucket.cleared);
    totals.total_estimated_interest = addMilliunits(totals.total_estimated_interest, estimated);
    totals.total_minimum_payment = addMilliunits(totals.total_minimum_payment, minimum ?? 0);
    return {
      id: account.id,
      name: account.name,
      type: account.type,
      balance: moneyFromMilliunits(balance),
      principal_balance: moneyFromMilliunits(bucket.principal),
      cleared_principal: moneyFromMilliunits(bucket.cleared),
      estimated_interest: moneyFromMilliunits(estimated),
      has_estimated_interest: estimated !== 0,
      interest_rate: currentRate(account.debt_interest_rates, asOf),
      minimum_payment: minimum == null ? null : moneyFromMilliunits(minimum),
      escrow: escrow == null ? null : moneyFromMilliunits(escrow),
      on_budget: account.on_budget,
      closed: account.closed === true,
      last_reconciled_at: account.last_reconciled_at ?? null,
      last_payment: bucket.lastPayment
        ? { date: bucket.lastPayment.date, amount: moneyFromMilliunits(bucket.lastPayment.amount) }
        : null,
      note_excerpt: noteExcerpt(account.note),
    };
  });
  rows.sort(compareDebtAccounts);

  return {
    include_closed: includeClosed === true,
    as_of: asOf,
    account_count: rows.length,
    sort: DEBT_SUMMARY_SORT,
    totals: {
      total_balance: moneyFromMilliunits(totals.total_balance),
      total_principal: moneyFromMilliunits(totals.total_principal),
      total_cleared_principal: moneyFromMilliunits(totals.total_cleared_principal),
      total_estimated_interest: moneyFromMilliunits(totals.total_estimated_interest),
      total_minimum_payment: moneyFromMilliunits(totals.total_minimum_payment),
    },
    accounts: rows,
  };
}

export function debtAccountLine(account) {
  const rate = account.interest_rate == null ? "none" : String(account.interest_rate);
  const parts = [
    account.id,
    account.name,
    account.type,
    `balance ${moneyText(account.balance.milliunits)}`,
    `principal ${moneyText(account.principal_balance.milliunits)}`,
    `estimated_interest ${moneyText(account.estimated_interest.milliunits)}`,
    `rate ${rate}`,
  ];
  if (account.closed) parts.push("closed");
  return parts.join(" · ");
}

export function presentDebtSummary(summary, { verbose = false } = {}) {
  if (verbose) return summary;
  return {
    ...summary,
    accounts: summary.accounts.map(debtAccountLine),
  };
}

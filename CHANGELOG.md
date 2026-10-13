# Changelog

## Unreleased

### Added

- `debt_summary` reports principal, cleared principal, and estimated interest for debt accounts. Amounts are milliunits and dollars. `interest_rate` is YNAB's raw `debt_interest_rates` milli-percent (18990 means 18.99%), passed through with no conversion. Closed accounts are excluded unless `include_closed` is true. Compact output is totals plus one line per account.

### Breaking

- The default tool profile is read-only. Write and other mutating tools are registered only for an explicit write profile: `YNAB_ALLOW_WRITES=1`, `YNAB_TOOL_PROFILE=write`, or `--profile write`. Direct registration was already read-only via `YNAB_ALLOW_WRITES`; the profile flag and env var are additional opt-ins for the same gate.
- Removed `list_payee_locations`, `get_payee_location`, `get_payee_locations_by_payee`, `list_money_movements`, `list_money_movement_groups`, `get_money_movements_by_month`, and `get_money_movement_groups_by_month`.
- `review_unapproved`, `get_transactions`, `list_accounts`, `list_categories`, and `get_month` now return a compact field set by default (ids, names, dates, dollar amounts, payee and category names, cleared/approved, and balances). Null, deleted, and redundant fields are omitted. Pass `verbose: true` for the previous full payload.

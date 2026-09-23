# AGENTS.md

## Project

`Amortize` — a single-page loan amortization calculator. Vanilla HTML/CSS/JS, no build step, no dependencies, no package manager, no tests. Open `index.html` directly in a browser (or serve the directory with any static server) to run it. There is nothing to install and no compile/lint/test command to run.

Three files matter:

| File | Role |
| --- | --- |
| `index.html` | Static markup and element IDs. All DOM that JS reads must exist here. |
| `app.js` | All logic: state, amortization math, rendering, canvas chart, CSV export. |
| `styles.css` | Dark theme, CSS custom properties, responsive breakpoints. |

## Architecture and data flow

Everything lives in `app.js` as a flat set of top-level functions and one mutable `state` object. There are no modules, classes, or imports.

The flow is a one-way loop:

1. User input (number input, range slider, loan-type tab, payment frequency, date picker, year filter) mutates `state`. Numeric controls go through the `sync(key, value)` helper at app.js:233, which coerces to a number, clamps negatives to 0, and writes the value into every element with a matching `data-key`. The frequency and date selects have their own `change` handlers.
2. `render()` at app.js:182 recomputes both plans, rewrites every result element, then calls the sub-renderers.
3. If `state.autoSave` is on, `saveState()` persists to `localStorage`.

`render()` is the single entry point for all output. Any new UI must be wired into it or it will silently go stale.

### Payment frequency is the core of the math

`state.frequency` is `"monthly" | "weekly" | "daily"`, with `PERIODS` (app.js:9) mapping each to its `days` length and `label`. Three derived helpers drive everything: `periodDays()`, `periodsPerYear()` (365 / days), and `dailyRate()` (APR / 100 / 365). Interest always accrues on the daily rate times the period length, so `growth = dailyRate() * periodDays()`.

The critical invariant: **the user's cash outflow is preserved across frequencies.** `state.extra` is always expressed per month, so it is converted with `extra * 12 / periodsPerYear()` in two places — `strategyPayment(includeExtra)` (app.js:47) for the scheduled amount and `amortize(strategy, extra)` (app.js:74) for the extra. Forgetting either conversion silently inflates weekly/daily paydowns by ~4x or ~30x. The base payment is likewise `paymentFor(...) * 12 / periodsPerYear()`.

`payoffWithPayment(strategy, payment)` (app.js:57) is the single amortization loop. It applies a per-period floor of `minPaymentFor(state.amount) * 12 / periodsPerYear()`, and the loop is capped by frequency: 1200 monthly, 5200 weekly, 37000 daily periods. A 40-year daily loan produces ~14,500 rows, so do not lower these caps without checking that case.

`minPaymentFor` (app.js:53) returns 0 unless `state.loanType === "card"`, where it enforces a 1% (min $25) revolving minimum. Applying that floor to installment loans makes their payments explode.

### Two plans, always

`render()` builds `strategy = { scheduled: strategyPayment(false) }` and then calls `amortize(strategy, state.extra)` and `amortize(strategy, 0)` (app.js:182), storing the results in `currentPlan` (with extra payments) and `standardPlan` (baseline). Most metrics are a comparison between the two. The loop stops when the balance drops below `0.005`, a float-tolerance guard — do not replace it with `> 0`, since floating-point residue otherwise causes an extra near-zero payment row.

### The frequency benefit comparison

`sameOutlayMonthly(payment)` (app.js:122) replays the plan as a single monthly payment of the same total cash (`payment * periodsPerYear() / 12`) and returns the interest it accrues. `render()` shows the difference as "Extra interest avoided". This is the honest way to demonstrate the weekly/daily benefit, which is modest (~$2,000 on a 30-year mortgage, ~$70 on a credit card). It returns `never: true` when the monthly-equivalent payment cannot cover monthly interest. `accrualComparison()` (app.js:138) only feeds the "add an extra payment" insight text.


### The investing scenario

When `state.extra > 0`, three extra views activate: the investment assumptions block, the tradeoff cards, and a third line on the chart. The investing path is simulated **monthly** regardless of `state.frequency`, receiving `state.extra * periodsPerYear() / 12` per month so the contribution rate matches the payoff path.

- `investSnapshot(months)` (app.js:86) simulates a portfolio fed by the monthly-converted extra, grown monthly from the annual return and taxed on gains over basis.
- `investmentTradeoff()` (app.js:97) finds the first month the after-tax portfolio covers the remaining standard-plan balance, then falls back to the final month.
- `getInvestPlan()` (app.js:106) is the chart-only variant; it expresses the loan balance net of the portfolio and breaks early once the portfolio covers the balance.

These three duplicate the same compounding loop by design (one returns a snapshot, one a payoff month, one a series). If you change the investment math, change all three consistently.

### Chart

`drawChart()` (app.js:209) is hand-rolled canvas 2D rendering — no chart library. It reads the canvas's CSS size, scales for `devicePixelRatio`, resizes the backing store, and re-styles the context each call. It is re-run on `window.resize`. Colours are hardcoded here and do not read the CSS custom properties; the legend dots in `index.html`/`styles.css` must be kept in sync manually:

- strategy (`currentPlan`) — gold `#d8b45f`, filled
- standard payoff (`standardPlan`) — teal dashed
- investing (`getInvestPlan()`) — purple `#a78bfa` dashed

The x-axis is period index, not calendar time, so a daily plan's labels are dates while a monthly plan's are `M0`..`M5`; `rangeLabel(index, length)` (app.js:176) chooses the format.

## Conventions

- **Currency:** `money()` for whole dollars (metrics), `cents` for the ledger table and CSV. `shortMoney()` abbreviates chart axis labels only.
- **Dates:** `dateForPayment(n)` (app.js:42) is `startDate + (n - 1) * periodDays()` days. `state.startDate` is an ISO date string (`"2026-10-01"`) backing an `<input type="date">`; payment 1 lands on that date exactly. `fmtDate()` renders `Sep 2026` for metric cards, `fmtDateShort()` renders `Sep 1, 2026` for the table and CSV. The default appears in both `index.html` and `DEFAULTS`.
- **Driving the UI from data:** the control panels are not written in HTML. `DEFINITIONS` (app.js:10) declares `[key, label, type, min, max, step]` tuples and `renderControls()` generates the number input, range slider, and min/max labels for each. `loan` and `card` are separate definition sets selected by `activeDefinitions()` (app.js:81) based on `state.loanType`; `extra` and `invest` are shared. Add a tunable by adding a tuple, a `DEFAULTS` entry, and a metric binding in `render()`. The key must match `state`, the input's `data-key`, and the `label`'s `for`.
- **Loan presets:** `PRESETS` (app.js:3) holds per-loan-type amounts plus a `frequency`; the tab click handler assigns the whole preset onto `state` and resets `yearFilter`.
- **Persisted state:** `STORAGE_KEY = "amortizeLoanPlan.v1"` (app.js:1). `loadState()` merges over `DEFAULTS` so added keys work against old stored payloads. Bump `.v1` only for a breaking shape change.
- **Style:** dense, single-purpose functions; many statements per line; template literals for all HTML generation. Match the surrounding density rather than reformatting.
- **DOM lookups:** queried once at module scope into `loanControls`, `extraControls`, etc. (app.js:22), but several handlers call `document.querySelector("#id")` inline instead. Either style is consistent with the file.
- **Event wiring:** a single delegated `input` listener on `document` (app.js:232) handles all slider and number edits; `#paymentFrequency` and `#startDate` have their own `change` listeners. `syncInputs()` (app.js:226) centrally resyncs checkbox/date/select/tab DOM from `state` and is called on load, on reset, and after a loan-type switch.

## Gotchas

- **The two cash-scaling sites.** `state.extra` and the base payment are both monthly-denominated and must be divided by `periodsPerYear() / 12` (multiplied by `12 / periodsPerYear()`) for weekly/daily. There are exactly two places: `strategyPayment()` and `amortize()`. If weekly/daily "saved" numbers look wildly large, one of these is missing the conversion.
- **Do not use `paymentFor()` directly as the per-period payment.** It returns a monthly amount; it is only valid after the frequency conversion.
- `index.html` does not set `autocomplete`/validation on the numeric inputs; out-of-range values are only clamped by the `min`/`max` attributes on the inputs, not in JS beyond the `Math.max(0, ...)` in `sync`.
- `minPaymentFor` must stay gated on `state.loanType === "card"`. Applying a 1% floor to an installment loan overrides the amortized payment and produces a wrong (too fast) payoff.
- `renderYearFilter()` (app.js:207) preserves the selected year across recomputes and falls back to `"all"` when the year no longer exists in the plan. Switching frequency or loan type resets it explicitly, because the schedule span changes.
- The tradeoff section and invest block are toggled with the `hidden` attribute, and `styles.css` re-declares `[hidden] { display:none; }` for both because their base rules set `display`.
- `#saveButton` writes to `localStorage` explicitly; `#resetButton` removes the key, re-applies `DEFAULTS`, then calls `syncInputs()` to resync the checkbox/date/frequency/tab DOM. New persisted fields need the same treatment there.
- CSV export bypasses the year filter and always writes the full `currentPlan`, with `fmtDateShort` dates.
- The metric grid is 4 columns wide and holds five metrics; the `@media` rules step it down at 1050px and 980px. The loan-type tab strip is 4 columns and steps to 2 at 640px.
- The four `@media` blocks in `styles.css` are split across two locations (near line 10 and near line 36) rather than grouped together.
- `#accrualSaved` / `#accrualNote` show "—" and a prompt in monthly mode, since there is nothing to compare against.
- No tests, no CI, and no git hooks exist. Verify changes by loading the page and exercising the inputs; there is no automated safety net. A quick headless check is to `node --check app.js`, then evaluate the file in a VM with a stubbed `document`/`window`/`localStorage` and a dummy canvas context to confirm `render()` runs and the metrics populate.

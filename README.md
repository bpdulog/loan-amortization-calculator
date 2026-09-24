# Amortize — Monthly Loan Calculator

A standalone, no-build web project for exploring loan payoff plans. Open `index.html` in a browser.

Features include loan-type presets (home, auto, personal, credit card), monthly/weekly/daily payment frequency, live sliders and number inputs, optional extra payments, saved preferences, an interactive balance trajectory (comparing standard payoff, accelerated paydown, and investing the difference), investment tradeoff analysis, a year-filtered payment schedule, and CSV export.

## Credit cards are modelled differently

A card is not an amortizing loan, so the card tab does not ask for a payoff term and payoff time is a result rather than an input.

**How you pay.** The issuer's minimum is due monthly and is recalculated as the balance falls. You then choose whether your recurring amount is extra on top of that minimum, or a total payment that already includes it.

**What you keep charging.** Most tools assume you stop using the card, which is rarely true. You can say:

- **I pay new charges in full** — the statement is cleared each period, so charges never become debt and the balance holds flat until extra payments reduce it.
- **I keep charging a fixed amount** — a monthly figure is added to the balance each statement.
- **I stop using the card** — the balance amortizes on its own.

**Some plans never clear, and the calculator says so.** Paying only the minimum while still spending does not work: on a $6,200 balance at 22.9% APR the minimum is about $179 a month while interest alone runs near $118, so anything you keep charging makes the balance grow. Those cases show "Balance never clears" with the interest, the spending, and the monthly payment that would break even, instead of inventing a payoff date.

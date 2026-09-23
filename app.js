const STORAGE_KEY = "amortizeLoanPlan.v1";

const PRESETS = {
  home: { amount: 420000, rate: 6.5, term: 30, extra: 150, extraStart: 1, frequency: "monthly" },
  auto: { amount: 34000, rate: 6.1, term: 6, extra: 50, extraStart: 1, frequency: "monthly" },
  personal: { amount: 18000, rate: 10.5, term: 5, extra: 75, extraStart: 1, frequency: "monthly" },
  card: { amount: 6200, rate: 22.9, cardExtra: 15, cardPaymentMode: "extra", extraStart: 1, frequency: "weekly" }
};
const DEFAULTS = { loanType: "home", amount: 420000, rate: 6.5, term: 30, extra: 150, cardExtra: 15, cardPaymentMode: "extra", extraStart: 1, startDate: "2026-10-01", frequency: "monthly", autoSave: true, yearFilter: "all", investReturn: 7, taxRate: 15 };
const PERIODS = { monthly: { days: 30, label: "month" }, weekly: { days: 7, label: "week" }, daily: { days: 1, label: "day" } };
const DEFINITIONS = {
  loan: [["amount", "Loan amount", "currency", 1000, 1500000, 1000], ["rate", "Interest rate", "percent", 0, 30, 0.05], ["term", "Loan term", "years", 1, 40, 1]],
  card: [["amount", "Card balance", "currency", 500, 50000, 100], ["rate", "APR", "percent", 0, 36, 0.05]],
  extra: [["extra", "Extra per month", "currency", 0, 5000, 25]],
  invest: [["investReturn", "Expected annual return", "percent", 0, 15, 0.25], ["taxRate", "Capital gains tax rate", "percent", 0, 40, 1]]
};
const state = loadState();
let currentPlan = [], standardPlan = [];
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const cents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const loanControls = document.querySelector("#loanControls"), extraControls = document.querySelector("#extraControls"), investControls = document.querySelector("#investControls"), investBlock = document.querySelector("#investBlock"), tradeoffSection = document.querySelector("#tradeoffSection"), scheduleRows = document.querySelector("#scheduleRows"), yearFilter = document.querySelector("#yearFilter"), frequencySelect = document.querySelector("#paymentFrequency"), canvas = document.querySelector("#balanceChart"), ctx = canvas.getContext("2d");

function loadState() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) }; } catch { return { ...DEFAULTS }; } }
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function money(v) { return currency.format(v); }
function fmtDate(date) { return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(date); }
function fmtDateShort(date) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date); }
function scale(v, type) { return type === "currency" ? money(v) : type === "percent" ? `${v}%` : type === "years" ? `${v} yrs` : String(v); }
function periodDays() { return (PERIODS[state.frequency] || PERIODS.monthly).days; }
function periodsPerYear() { return 365 / periodDays(); }
function dailyRate() { return state.rate / 100 / 365; }
function periodsLabel(periods) {
  const unit = (PERIODS[state.frequency] || PERIODS.monthly).label;
  if (unit === "month") return monthsLabel(periods);
  const count = state.frequency === "weekly" ? periods : periods;
  const plural = `${count} ${unit}${count === 1 ? "" : "s"}`;
  const years = Math.floor(count / periodsPerYear()), rest = Math.round(count - years * periodsPerYear());
  return count <= 90 ? plural : `${plural} (${monthsLabel(Math.round(periods * periodDays() / 30.44))})`;
}
function addDays(date, days) { const copy = new Date(date.getTime()); copy.setDate(copy.getDate() + days); return copy; }
function dateForPayment(payment) { return addDays(startDateDate(), (payment - 1) * periodDays()); }
function startDateDate() { const [year, month, day] = state.startDate.split("-").map(Number); return new Date(year, month - 1, day || 1); }


function paymentFor(amount, rate, months) { const monthlyRate = rate / 100 / 12; return monthlyRate === 0 ? amount / months : amount * monthlyRate * Math.pow(1 + monthlyRate, months) / (Math.pow(1 + monthlyRate, months) - 1); }
function strategyPayment(includeExtra) {
  const months = Math.max(1, Math.round(state.term * 12));
  const base = paymentFor(state.amount, state.rate, months);
  const perPeriod = base * 12 / periodsPerYear();
  return perPeriod + (includeExtra ? state.extra * 12 / periodsPerYear() : 0);
}
function minPaymentFor(balance) {
  if (state.loanType !== "card") return 0;
  return Math.min(balance, Math.max(25, balance * 0.01));
}
function addCalendarMonths(anchor, months) { const target = new Date(anchor.getFullYear(), anchor.getMonth() + months, 1); target.setDate(Math.min(anchor.getDate(), new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate())); return target; }
function daysBetween(start, end) { return Math.round((Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / 86400000); }
function minimumMonthlyPayment(balance) { const start = startDateDate(), days = daysBetween(addCalendarMonths(start, -1), start); return balance * dailyRate() * days + minPaymentFor(balance); }
function payoffWithPayment(strategy, payment, extra) {
  const growth = dailyRate() * periodDays();
  const maxPeriods = state.frequency === "monthly" ? 1200 : state.frequency === "weekly" ? 5200 : 37000;
  const periodsPerMonth = periodsPerYear() / 12;
  const extraPerPeriod = (extra || 0) * 12 / periodsPerYear(), floor = state.loanType === "card" ? 0 : minPaymentFor(state.amount) * 12 / periodsPerYear();
  let balance = state.amount, count = 0, rows = [], accrued = 0;
  while (balance > 0.005 && count < maxPeriods) {
    count += 1;
    const interest = balance * growth;
    const scheduled = Math.min(state.loanType === "card" ? interest + minPaymentFor(balance) * 12 / periodsPerYear() : Math.max(payment, floor), balance + interest);
    const extraPaid = Math.min(extraPerPeriod, Math.max(0, balance + interest - scheduled)), amount = scheduled + extraPaid;
    const principal = Math.min(balance, Math.max(0, amount - interest));
    balance = Math.max(0, balance - principal);
    accrued += interest;
    rows.push({ payment: count, date: dateForPayment(count), scheduled, principal, interest, extra: extraPaid, balance, accrued });
  }
  return { rows, scheduled: payment, periodsPerMonth, accrued };
}
function payoffCard(extra) {
  const anchor = startDateDate(), firstPeriodDays = daysBetween(addCalendarMonths(anchor, -1), anchor), cadenceDays = periodDays();
  let balance = state.amount, accruedInterest = balance * dailyRate() * firstPeriodDays, eventInterest = accruedInterest, extraDate = extra > 0 ? anchor : null, minimumIndex = 0, minimumDate = anchor, count = 0, accrued = accruedInterest;
  const rows = [];
  while (balance > 0.005 && count < 50000) {
    const date = extraDate && extraDate <= minimumDate ? extraDate : minimumDate, extraDue = Boolean(extraDate && date.getTime() === extraDate.getTime()), minimumDue = date.getTime() === minimumDate.getTime();
    if (count > 0) { const interest = balance * dailyRate() * daysBetween(rows.at(-1).date, date); accruedInterest += interest; eventInterest = interest; accrued += interest; }
    const minimum = minimumDue ? Math.min(balance + accruedInterest, accruedInterest + minPaymentFor(balance)) : 0;
    const minimumPrincipal = Math.min(balance, Math.max(0, minimum - accruedInterest));
    balance = Math.max(0, balance - minimumPrincipal); accruedInterest = Math.max(0, accruedInterest - minimum);
    const extraPaid = extraDue ? Math.min(extra, balance) : 0;
    balance = Math.max(0, balance - extraPaid);
    const payoffInterest = balance <= 0.005 ? accruedInterest : 0, scheduled = minimum + payoffInterest;
    if (payoffInterest) accruedInterest = 0;
    rows.push({ payment: ++count, date, scheduled, principal: minimumPrincipal + extraPaid, interest: eventInterest, extra: extraPaid, balance: balance + accruedInterest, accrued });
    if (minimumDue) { minimumIndex += 1; minimumDate = addCalendarMonths(anchor, minimumIndex); }
    if (extraDue) extraDate = state.frequency === "monthly" ? minimumDate : addDays(extraDate, cadenceDays);
    if (extraDue && state.frequency === "monthly" && minimumDue) extraDate = minimumDate;
  }
  return { rows, scheduled: minimumMonthlyPayment(state.amount), accrued };
}
function payoffCardTotal(totalPayment) {
  const anchor = startDateDate(), firstPeriodDays = daysBetween(addCalendarMonths(anchor, -1), anchor), cadenceDays = periodDays();
  let balance = state.amount, accruedInterest = balance * dailyRate() * firstPeriodDays, eventInterest = accruedInterest, paymentDate = totalPayment > 0 ? anchor : null, minimumDate = anchor, minimumIndex = 0, minimumRemaining = Math.min(balance + accruedInterest, accruedInterest + minPaymentFor(balance)), count = 0, accrued = accruedInterest;
  const rows = [];
  while (balance > 0.005 && count < 50000) {
    const date = paymentDate && paymentDate <= minimumDate ? paymentDate : minimumDate, paymentDue = Boolean(paymentDate && date.getTime() === paymentDate.getTime()), minimumDue = date.getTime() === minimumDate.getTime();
    if (count > 0) { const interest = balance * dailyRate() * daysBetween(rows.at(-1).date, date); accruedInterest += interest; eventInterest = interest; accrued += interest; }
    let scheduled = 0, extraPaid = 0, principal = 0;
    const applyPayment = amount => {
      const paid = Math.min(amount, balance + accruedInterest), interestPaid = Math.min(accruedInterest, paid), principalPaid = Math.min(balance, Math.max(0, paid - interestPaid));
      accruedInterest = Math.max(0, accruedInterest - interestPaid); balance = Math.max(0, balance - principalPaid); principal += principalPaid;
      return paid;
    };
    if (paymentDue) {
      const paid = Math.min(totalPayment, balance + accruedInterest), minimumPart = Math.min(paid, minimumRemaining), minimumPaid = applyPayment(minimumPart), extraPrincipal = Math.min(balance, Math.max(0, paid - minimumPart));
      balance = Math.max(0, balance - extraPrincipal); principal += extraPrincipal; scheduled += minimumPaid; extraPaid += extraPrincipal; minimumRemaining = Math.max(0, minimumRemaining - minimumPaid);
    }
    if (minimumDue) {
      const shortfall = applyPayment(minimumRemaining); scheduled += shortfall; minimumRemaining = Math.max(0, minimumRemaining - shortfall);
    }
    if (balance <= 0.005 && accruedInterest > 0) { scheduled += accruedInterest; accruedInterest = 0; }
    rows.push({ payment: ++count, date, scheduled, principal, interest: eventInterest, extra: extraPaid, balance: balance + accruedInterest, accrued });
    if (minimumDue) {
      minimumIndex += 1; minimumDate = addCalendarMonths(anchor, minimumIndex);
      const cycleDays = daysBetween(date, minimumDate);
      minimumRemaining = Math.min(balance + accruedInterest, accruedInterest + balance * dailyRate() * cycleDays + minPaymentFor(balance));
    }
    if (paymentDue) paymentDate = state.frequency === "monthly" ? minimumDate : addDays(paymentDate, cadenceDays);
  }
  return { rows, scheduled: minimumMonthlyPayment(state.amount), accrued };
}
function amortize(strategy, extra) { return state.loanType === "card" ? state.cardPaymentMode === "total" && extra > 0 ? payoffCardTotal(extra) : payoffCard(extra) : payoffWithPayment(strategy, strategy.scheduled, extra); }


function controls(target, defs) { target.innerHTML = defs.map(([key,label,type,min,max,step]) => `<div class="control"><div class="control-head"><label for="${key}">${label}</label><input id="${key}" type="number" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${state[key]}"></div><input type="range" data-key="${key}" aria-label="${label}" min="${min}" max="${max}" step="${step}" value="${state[key]}"><div class="range-labels"><span>${scale(min,type)}</span><span>${scale(max,type)}</span></div></div>`).join(""); }
function activeDefinitions() { return DEFINITIONS[state.loanType] || DEFINITIONS.loan; }
function renderControls() { controls(loanControls, activeDefinitions()); controls(extraControls, state.loanType === "card" ? [["cardExtra", `${state.cardPaymentMode === "total" ? "Total payment" : "Extra principal"} per ${periodLabel()}`, "currency", 0, 1000, 5]] : DEFINITIONS.extra); controls(investControls, DEFINITIONS.invest); }
function monthsLabel(months) { const years = Math.floor(months / 12), rest = months % 12; return `${years ? `${years} yr${years === 1 ? "" : "s"}` : ""}${years && rest ? " " : ""}${rest ? `${rest} mo` : ""}`; }
function monthsFromPeriods(periods) { return periods * periodDays() / 30.44; }
function investSnapshot(months) {
  const monthlyGrowth = Math.pow(1 + state.investReturn / 100, 1 / 12) - 1, taxRate = state.taxRate / 100;
  let portfolio = 0, basis = 0;
  for (let m = 1; m <= months; m += 1) {
    portfolio += state.extra; basis += state.extra;
    portfolio *= 1 + monthlyGrowth;
  }
  const taxes = taxRate * Math.max(0, portfolio - basis);
  return { portfolio, taxes, net: portfolio - taxes };
}

function investmentTradeoff() {
  const perMonth = state.extra * periodsPerYear() / 12;
  for (let m = 1; m <= standardPlan.length; m += 1) {
    const account = investSnapshot(m), balance = standardPlan[m - 1].balance;
    if (account.net >= balance) return { month: m, date: dateForPayment(m), balance, leftover: account.net - balance, ...account };
  }
  const account = investSnapshot(standardPlan.length);
  return { month: standardPlan.length, date: dateForPayment(standardPlan.length), balance: 0, leftover: account.net, ...account };
}
function getInvestPlan() {
  if (state.loanType === "card" || !state.extra || standardPlan.length === 0) return [];
  const monthlyGrowth = Math.pow(1 + state.investReturn / 100, 1 / 12) - 1, taxRate = state.taxRate / 100;
  const perMonth = state.extra * periodsPerYear() / 12;
  let portfolio = 0, basis = 0;
  const rows = [];
  for (let m = 1; m <= standardPlan.length; m += 1) {
    portfolio += perMonth; basis += perMonth;
    portfolio *= 1 + monthlyGrowth;
    const taxes = taxRate * Math.max(0, portfolio - basis), netPortfolio = portfolio - taxes;
    const stdBalance = standardPlan[m - 1].balance;
    rows.push({ payment: m, date: dateForPayment(m), balance: Math.max(0, stdBalance - netPortfolio) });
    if (netPortfolio >= stdBalance) break;
  }
  return rows;
}
function sameOutlayMonthly(payment) {
  const monthly = payment * periodsPerYear() / 12;
  const growth = state.rate / 100 / 12;
  const maxMonths = 1200;
  let balance = state.amount, accrued = 0, count = 0;
  while (balance > 0.005 && count < maxMonths) {
    count += 1;
    const interest = balance * growth;
    if (monthly <= interest) return { months: count, interest: accrued, never: true };
    const principal = Math.min(balance, monthly - interest);
    accrued += interest;
    balance = Math.max(0, balance - principal);
  }
  return { months: count, interest: accrued };
}
function accrualComparison() {
  if ((state.frequency || "monthly") === "monthly") return null;
  return { perPeriodInterest: state.amount * dailyRate() * periodDays(), monthlyAccrualAtStart: state.amount * dailyRate() * 30.44, periodsPerMonth: periodsPerYear() / 12 };
}

function renderTradeoff() {
  const investLegend = document.querySelector("#investLegend");
  const show = state.extra > 0 && state.loanType !== "card";
  investBlock.hidden = tradeoffSection.hidden = !show;
  if (investLegend) investLegend.hidden = !show;
  if (!show) return;
  const paydownPeriods = currentPlan.length, paydownMonths = monthsFromPeriods(paydownPeriods);
  const paydownInterest = currentPlan.reduce((sum, row) => sum + row.interest, 0);
  const standardPeriods = standardPlan.length, standardMonths = monthsFromPeriods(standardPeriods);
  const invest = investmentTradeoff();
  const paydownSooner = standardPeriods - paydownPeriods, investSooner = standardPeriods - invest.month, difference = paydownPeriods - invest.month;
  document.querySelector("#paydownPayoff").textContent = `${periodsLabel(paydownPeriods)} to payoff`;
  document.querySelector("#paydownSooner").textContent = paydownSooner ? `${periodsLabel(paydownSooner)} sooner than standard` : "Standard schedule";
  document.querySelector("#paydownInterest").textContent = money(paydownInterest);
  document.querySelector("#paydownDate").textContent = fmtDateShort(currentPlan.at(-1).date);
  document.querySelector("#investPayoff").textContent = `${monthsLabel(invest.month)} to payoff`;
  document.querySelector("#investSooner").textContent = investSooner ? `${monthsLabel(investSooner)} sooner than standard` : "Standard schedule";
  document.querySelector("#investPortfolio").textContent = money(invest.net);
  document.querySelector("#investTax").textContent = `−${money(invest.taxes)}`;
  document.querySelector("#investLeftover").textContent = money(invest.leftover);
  document.querySelector("#tradeoffNote").textContent = `${money(state.extra)} extra per month invested at ${state.investReturn}% annual growth, ${state.taxRate}% tax on gains`;
  const balanceAtPaydown = standardPlan[paydownPeriods - 1] ? standardPlan[paydownPeriods - 1].balance : 0;
  const position = investSnapshot(paydownMonths).net - balanceAtPaydown;
  const speed = difference > 0
    ? `Investing clears the loan ${periodsLabel(difference)} sooner than extra principal, leaving ${money(invest.leftover)} after the balance is retired.`
    : difference < 0
      ? `Extra principal clears the loan ${periodsLabel(-difference)} sooner than investing, avoiding ${money(invest.taxes)} in capital gains tax.`
      : `Both paths retire the loan in the same span; investing leaves ${money(invest.leftover)} after tax.`;
  const standing = position >= 0
    ? `At ${monthsLabel(paydownMonths)} — when the extra-principal plan is done — the portfolio nets ${money(investSnapshot(paydownMonths).net)} after tax while ${money(balanceAtPaydown)} of the loan would remain, so investing is ahead by ${money(position)}.`
    : `At ${monthsLabel(paydownMonths)} — when the extra-principal plan is done — the portfolio nets ${money(investSnapshot(paydownMonths).net)} after tax against ${money(balanceAtPaydown)} of remaining balance, so the paydown is ahead by ${money(-position)}.`;
  document.querySelector("#tradeoffVerdict").textContent = `${speed} ${standing}`;
}
function periodLabel() { return (PERIODS[state.frequency] || PERIODS.monthly).label; }
function cadenceAdverb() { return state.frequency === "daily" ? "daily" : state.frequency === "weekly" ? "weekly" : "monthly"; }
function cardElapsedDays(rows) { return rows.length ? Math.max(0, daysBetween(startDateDate(), rows.at(-1).date)) : 0; }
function cardDurationLabel(rows) { const days = cardElapsedDays(rows); return days < 30 ? `${days} day${days === 1 ? "" : "s"}` : monthsLabel(Math.max(1, Math.round(days / 30.44))); }
function cardSavedLabel(days) { return days < 30 ? `${days} day${days === 1 ? "" : "s"}` : monthsLabel(Math.round(days / 30.44)); }
function monthlyCardRows(rows) { const months = new Map(); rows.forEach(row => months.set(`${row.date.getFullYear()}-${row.date.getMonth()}`, row)); return [...months.values()]; }
function rangeLabel(index, length) {
  if (state.frequency === "monthly") return `M${index}`;
  const date = dateForPayment(Math.min(Math.max(index + 1, 1), length));
  const short = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
  return state.frequency === "daily" ? `${short}` : `W${index}`;
}
function render() {
  const card = state.loanType === "card", strategy = { scheduled: card ? 0 : strategyPayment(false) };
  const withExtra = amortize(strategy, card ? state.cardExtra : state.extra), standard = amortize(strategy, 0);
  currentPlan = withExtra.rows; standardPlan = standard.rows;
  const totalInterest = currentPlan.reduce((sum, row) => sum + row.interest, 0), standardInterest = standardPlan.reduce((sum, row) => sum + row.interest, 0);
  const baseline = !card && state.frequency !== "monthly" ? sameOutlayMonthly(strategy.scheduled) : null;
  document.querySelector("#paymentMetricLabel").textContent = card ? "Est. monthly minimum" : "Monthly payment";
  document.querySelector("#monthlyPayment").textContent = card ? cents.format(minimumMonthlyPayment(state.amount)) : money(strategy.scheduled);
  document.querySelector("#monthlyPaymentNote").textContent = card ? "Interest + 1% of balance (min $25), due monthly" : `Every ${periodLabel()}, principal & interest`;
  document.querySelector("#startDateLabel").textContent = card ? "First monthly due date" : "First payment date";
  document.querySelector("#paymentFrequencyLabel").textContent = card ? "Recurring payment cadence" : "Payment frequency";
  document.querySelector("#extraNote").textContent = card
    ? state.cardPaymentMode === "total"
      ? `This is your full payment every ${periodLabel()}, including the minimum. Payments count toward the monthly minimum; any amount above it reduces principal. A minimum shortfall is added on the due date.`
      : state.cardExtra
        ? `Minimum is due monthly. ${money(state.cardExtra)} goes directly to principal every ${periodLabel()}.`
        : "Minimum is due monthly. Set an extra amount to repeat it on the selected cadence; each extra payment goes to principal."
    : "The extra amount is a monthly budget, spread across the selected payment cadence.";
  document.querySelector("#payoffDate").textContent = fmtDate(currentPlan.at(-1).date);
  document.querySelector("#payoffDuration").textContent = `${card ? cardDurationLabel(currentPlan) : periodsLabel(currentPlan.length)} to payoff`;
  document.querySelector("#totalInterest").textContent = money(totalInterest);
  document.querySelector("#interestSaved").textContent = money(Math.max(0, standardInterest - totalInterest));
  const periodsSaved = standardPlan.length - currentPlan.length, daysSaved = card ? Math.max(0, daysBetween(currentPlan.at(-1).date, standardPlan.at(-1).date)) : 0, cardSaved = cardSavedLabel(daysSaved);
  document.querySelector("#interestNote").textContent = (card ? state.cardExtra : state.extra) ? `vs. ${money(standardInterest)} minimum only` : "Over the life of the loan";
  document.querySelector("#savedNote").textContent = card ? state.cardExtra ? daysSaved ? `${cardSaved} sooner` : "Same projected date" : "Minimum-only schedule" : periodsSaved ? `${periodsLabel(periodsSaved)} sooner` : "Keep exploring";
  const totalExtraPrincipal = currentPlan.reduce((sum, row) => sum + row.extra, 0), extraPaymentCount = currentPlan.filter(row => row.extra > 0).length;
  document.querySelector("#accrualLabel").textContent = card ? "Extra principal paid" : "Extra interest avoided";
  document.querySelector("#accrualSaved").textContent = card ? money(totalExtraPrincipal) : baseline ? money(Math.max(0, baseline.interest - totalInterest)) : "—";
  document.querySelector("#accrualNote").textContent = card ? extraPaymentCount ? state.cardPaymentMode === "total" ? `Extra principal on ${extraPaymentCount} ${cadenceAdverb()} payment${extraPaymentCount === 1 ? "" : "s"}` : `${extraPaymentCount} ${cadenceAdverb()} payment${extraPaymentCount === 1 ? "" : "s"}` : "No extra payments" : baseline ? `vs. ${money(strategy.scheduled * periodsPerYear() / 12)}/mo paid monthly` : `Switch to weekly or daily to see accrual timing`;
  document.querySelector("#insightText").textContent = card
    ? state.cardExtra ? state.cardPaymentMode === "total"
      ? `Paying ${money(state.cardExtra)} total every ${periodLabel()}, including the minimum, sends ${money(totalExtraPrincipal)} above the minimum to principal and saves ${money(Math.max(0, standardInterest - totalInterest))} in interest versus minimum-only payments.`
      : `${daysSaved ? `Paying ${money(state.cardExtra)} extra toward principal every ${periodLabel()} pays off the card ${cardSaved} sooner` : `Paying ${money(state.cardExtra)} extra toward principal every ${periodLabel()} lowers the balance`}, saving ${money(Math.max(0, standardInterest - totalInterest))} in interest versus minimum-only payments.`
      : `The estimated monthly minimum is recalculated as the balance falls. Choose whether your recurring amount is extra or includes the minimum.`
    : state.extra
      ? `Paying ${money(state.extra)} extra per month clears the loan ${periodsLabel(periodsSaved)} earlier and saves ${money(Math.max(0, standardInterest - totalInterest))} in interest.`
      : baseline
        ? `${state.frequency === "daily" ? "Daily" : "Weekly"} payments shrink the balance between due dates, so the same cash outlay accrues ${money(Math.max(0, baseline.interest - totalInterest))} less interest than one monthly bill.`
        : "Add an extra payment to see how much interest and time you can save.";
  document.querySelector("#strategyLegend").textContent = state.loanType === "card" ? state.cardPaymentMode === "total" ? "Total recurring payment" : "Minimum + extra" : "With strategy";
  document.querySelector("#standardLegend").textContent = state.loanType === "card" ? "Minimum only" : "Standard payoff";
  document.querySelector("#chartEyebrow").textContent = card ? "Monthly balance" : "Balance trajectory";
  document.querySelector("#chartTitle").textContent = card ? "Credit card balance by month" : "Your remaining balance";
  document.querySelector("#scheduledHeading").textContent = card ? state.cardPaymentMode === "total" ? "Minimum portion" : "Minimum" : "Scheduled";
  document.querySelector("#scheduleTitle").textContent = card ? "Credit card payment schedule" : "Payment schedule";
  renderYearFilter(); renderTable(); drawChart(); renderTradeoff(); if (state.autoSave) saveState();
}
function renderYearFilter() { const prior = state.yearFilter; const years = [...new Set(currentPlan.map(row => row.date.getFullYear()))]; yearFilter.innerHTML = `<option value="all">All payments</option>${years.map(year => `<option value="${year}">${year}</option>`).join("")}`; state.yearFilter = years.includes(Number(prior)) ? prior : "all"; yearFilter.value = state.yearFilter; }
function renderTable() { const rows = state.yearFilter === "all" ? currentPlan : currentPlan.filter(row => row.date.getFullYear() === Number(state.yearFilter)); scheduleRows.innerHTML = rows.map(row => `<tr><td>${row.payment}</td><td>${fmtDateShort(row.date)}</td><td>${row.scheduled ? cents.format(row.scheduled) : "—"}</td><td>${cents.format(row.principal)}</td><td>${cents.format(row.interest)}</td><td>${row.extra ? cents.format(row.extra) : "—"}</td><td>${cents.format(row.balance)}</td></tr>`).join("") || `<tr><td colspan="7">No payments in this year.</td></tr>`; }
function drawChart() {
  const rect = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, width = Math.max(640, Math.floor(rect.width * dpr)) / dpr, height = Math.max(320, Math.floor(rect.height * dpr)) / dpr;
  canvas.width = width * dpr; canvas.height = height * dpr; ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,width,height); ctx.fillStyle="#0c1110"; ctx.fillRect(0,0,width,height);
  const investPlan = getInvestPlan();
  const card = state.loanType === "card", chartStart = card ? addCalendarMonths(startDateDate(), -1) : null, chartEnd = card ? (currentPlan.at(-1).date > standardPlan.at(-1).date ? currentPlan.at(-1).date : standardPlan.at(-1).date) : null;
  const planMax=[currentPlan,standardPlan].reduce((outer,rows)=>Math.max(outer,rows.reduce((inner,row)=>Math.max(inner,row.balance),0)),state.amount), pad={top:25,right:25,bottom:38,left:73}, pw=width-pad.left-pad.right, ph=height-pad.top-pad.bottom, max=Math.max(planMax,1), length=card ? Math.max(1, daysBetween(chartStart, chartEnd)) : Math.max(standardPlan.length,currentPlan.length,investPlan.length||1);
  ctx.strokeStyle="rgba(231,215,168,.14)"; ctx.lineWidth=1; ctx.fillStyle="#b8b2a2"; ctx.font="700 12px Inter, system-ui"; ctx.textAlign="right"; ctx.textBaseline="middle";
  for(let i=0;i<=4;i++){ const y=pad.top+ph*i/4, value=max*(1-i/4); ctx.beginPath();ctx.moveTo(pad.left,y);ctx.lineTo(width-pad.right,y);ctx.stroke();ctx.fillText(shortMoney(value),pad.left-12,y); }
  const points=rows=>{const plotted=card?monthlyCardRows(rows):rows;return [{x:pad.left,y:pad.top+ph*(1-state.amount/max)},...plotted.map((r,i)=>({x:pad.left+pw*(card ? daysBetween(chartStart,r.date)/length : (i+1)/length),y:pad.top+ph*(1-r.balance/max)}))];};
  const line=(rows,color,dash,fill)=>{const pts=points(rows); if(fill){const grad=ctx.createLinearGradient(0,pad.top,0,height-pad.bottom);grad.addColorStop(0,"rgba(216,180,95,.32)");grad.addColorStop(1,"rgba(216,180,95,.015)");ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.lineTo(pts.at(-1).x,height-pad.bottom);ctx.lineTo(pad.left,height-pad.bottom);ctx.closePath();ctx.fillStyle=grad;ctx.fill();}ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.strokeStyle=color;ctx.setLineDash(dash);ctx.lineWidth=2.6;ctx.stroke();ctx.setLineDash([]);};
  line(standardPlan,"rgba(45,212,191,.72)",[7,6],false);
  line(currentPlan,"#d8b45f",[],true);
  if (investPlan.length > 0) line(investPlan, "#a78bfa", [5, 4], false);
  ctx.fillStyle="#b8b2a2";ctx.textAlign="center";ctx.textBaseline="top";for(let i=0;i<=5;i++){const index=Math.min(length,Math.round(length*i/5)), label=card ? new Intl.DateTimeFormat("en-US",{month:"short",year:"2-digit"}).format(addDays(chartStart,index)) : rangeLabel(index,length);ctx.fillText(label,pad.left+pw*index/length,height-pad.bottom+13);}
}
function shortMoney(value) { return value >= 1000000 ? `$${(value/1000000).toFixed(1)}M` : value >= 1000 ? `$${Math.round(value/1000)}K` : money(value); }
function syncFrequency(value) { state.frequency = PERIODS[value] ? value : DEFAULTS.frequency; frequencySelect.value = state.frequency; }
function syncLoanTab(type) { document.querySelectorAll(".loan-type").forEach(tab=>{const active=tab.dataset.loanType===type;tab.classList.toggle("active",active);tab.setAttribute("aria-selected",String(active));}); }
function syncInputs() {
  state.cardPaymentMode = state.cardPaymentMode === "total" ? "total" : "extra";
  document.querySelector("#autoSave").checked = state.autoSave;
  document.querySelector("#startDate").value = state.startDate;
  document.querySelector("#cardPaymentMode").value = state.cardPaymentMode;
  document.querySelector("#cardPaymentModeWrap").hidden = state.loanType !== "card";
  syncFrequency(state.frequency);
  syncLoanTab(state.loanType);
  renderControls();
}
function sync(key, val) { state[key] = Math.max(0, Number(val) || 0); document.querySelectorAll(`[data-key="${key}"]`).forEach(el=>el.value=state[key]); render(); }
document.addEventListener("input", event => { const key=event.target.dataset.key; if(key) sync(key,event.target.value); });
document.querySelectorAll(".loan-type").forEach(button=>button.addEventListener("click",()=>{ const type=button.dataset.loanType; Object.assign(state,PRESETS[type],{loanType:type,yearFilter:"all"}); syncLoanTab(type); syncFrequency(state.frequency); document.querySelector("#cardPaymentMode").value = state.cardPaymentMode; document.querySelector("#cardPaymentModeWrap").hidden = type !== "card"; renderControls();render(); }));
frequencySelect.addEventListener("change", event => { syncFrequency(event.target.value); state.yearFilter = "all"; if(state.loanType === "card") renderControls(); render(); });
document.querySelector("#cardPaymentMode").addEventListener("change", event => { state.cardPaymentMode = event.target.value === "total" ? "total" : "extra"; renderControls(); render(); });
yearFilter.addEventListener("change",event=>{state.yearFilter=event.target.value;renderTable();if(state.autoSave)saveState();}); document.querySelector("#autoSave").addEventListener("change",event=>{state.autoSave=event.target.checked;if(state.autoSave)saveState();}); document.querySelector("#saveButton").addEventListener("click",saveState); document.querySelector("#resetButton").addEventListener("click",()=>{localStorage.removeItem(STORAGE_KEY);Object.assign(state,DEFAULTS);syncInputs();render();});
document.querySelector("#downloadButton").addEventListener("click",()=>{ const minimumHeading=state.cardPaymentMode === "total" ? "Minimum Portion" : "Minimum", header=`Payment,Date,${state.loanType === "card" ? minimumHeading : "Scheduled"} Payment,Total Principal,Interest Accrued,Extra Principal,Remaining Balance`; const data=currentPlan.map(r=>[r.payment,fmtDateShort(r.date),r.scheduled.toFixed(2),r.principal.toFixed(2),r.interest.toFixed(2),r.extra.toFixed(2),r.balance.toFixed(2)].join(",")); const link=document.createElement("a"), url=URL.createObjectURL(new Blob([[header,...data].join("\n")],{type:"text/csv"}));link.href=url;link.download="loan-amortization-schedule.csv";link.click();URL.revokeObjectURL(url); });
document.querySelector("#startDate").addEventListener("change", event => { state.startDate = event.target.value || DEFAULTS.startDate; state.yearFilter = "all"; render(); });
window.addEventListener("resize",drawChart); syncInputs(); render();

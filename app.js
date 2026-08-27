const STORAGE_KEY = "amortizeLoanPlan.v1";

const PRESETS = {
  home: { amount: 420000, rate: 6.5, term: 30, extra: 150, extraStart: 1 },
  auto: { amount: 34000, rate: 6.1, term: 6, extra: 50, extraStart: 1 },
  personal: { amount: 18000, rate: 10.5, term: 5, extra: 75, extraStart: 1 }
};
const DEFAULTS = { loanType: "home", amount: 420000, rate: 6.5, term: 30, extra: 150, extraStart: 1, startDate: "2026-09", autoSave: true, yearFilter: "all" };
const DEFINITIONS = {
  loan: [["amount", "Loan amount", "currency", 1000, 1500000, 1000], ["rate", "Interest rate", "percent", 0, 20, 0.05], ["term", "Loan term", "years", 1, 40, 1]],
  extra: [["extra", "Extra monthly payment", "currency", 0, 5000, 25], ["extraStart", "Start extra payment in month", "number", 1, 480, 1]]
};
const state = loadState();
let currentPlan = [], standardPlan = [];
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const cents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const loanControls = document.querySelector("#loanControls"), extraControls = document.querySelector("#extraControls"), scheduleRows = document.querySelector("#scheduleRows"), yearFilter = document.querySelector("#yearFilter"), canvas = document.querySelector("#balanceChart"), ctx = canvas.getContext("2d");

function loadState() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) }; } catch { return { ...DEFAULTS }; } }
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function money(v) { return currency.format(v); }
function fmtDate(date) { return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(date); }
function scale(v, type) { return type === "currency" ? money(v) : type === "percent" ? `${v}%` : type === "years" ? `${v} yrs` : String(v); }
function dateForPayment(payment) { const [year, month] = state.startDate.split("-").map(Number); return new Date(year, month - 2 + payment, 1); }

function paymentFor(amount, rate, months) { const monthlyRate = rate / 100 / 12; return monthlyRate === 0 ? amount / months : amount * monthlyRate * Math.pow(1 + monthlyRate, months) / (Math.pow(1 + monthlyRate, months) - 1); }
function amortize(includeExtra) {
  const months = Math.round(state.term * 12), regular = paymentFor(state.amount, state.rate, months), monthlyRate = state.rate / 100 / 12;
  let balance = state.amount, payment = 0, rows = [];
  while (balance > 0.005 && payment < 1200) {
    payment += 1;
    const interest = balance * monthlyRate;
    const plannedExtra = includeExtra && payment >= state.extraStart ? state.extra : 0;
    const principal = Math.min(balance, Math.max(0, regular - interest));
    const extra = Math.min(balance - principal, plannedExtra);
    balance = Math.max(0, balance - principal - extra);
    rows.push({ payment, date: dateForPayment(payment), principal, interest, extra, balance });
  }
  return { rows, regular };
}
function controls(target, defs) { target.innerHTML = defs.map(([key,label,type,min,max,step]) => `<div class="control"><div class="control-head"><label for="${key}">${label}</label><input id="${key}" type="number" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${state[key]}"></div><input type="range" data-key="${key}" aria-label="${label}" min="${min}" max="${max}" step="${step}" value="${state[key]}"><div class="range-labels"><span>${scale(min,type)}</span><span>${scale(max,type)}</span></div></div>`).join(""); }
function renderControls() { controls(loanControls, DEFINITIONS.loan); controls(extraControls, DEFINITIONS.extra); }
function monthsLabel(months) { const years = Math.floor(months / 12), rest = months % 12; return `${years ? `${years} yr${years === 1 ? "" : "s"}` : ""}${years && rest ? " " : ""}${rest ? `${rest} mo` : ""}`; }
function render() {
  const withStrategy = amortize(true), standard = amortize(false); currentPlan = withStrategy.rows; standardPlan = standard.rows;
  const totalInterest = currentPlan.reduce((sum, row) => sum + row.interest, 0), standardInterest = standardPlan.reduce((sum, row) => sum + row.interest, 0);
  document.querySelector("#monthlyPayment").textContent = money(withStrategy.regular + state.extra);
  document.querySelector("#payoffDate").textContent = fmtDate(currentPlan.at(-1).date);
  document.querySelector("#payoffDuration").textContent = `${monthsLabel(currentPlan.length)} to payoff`;
  document.querySelector("#totalInterest").textContent = money(totalInterest);
  document.querySelector("#interestSaved").textContent = money(Math.max(0, standardInterest - totalInterest));
  const monthsSaved = standardPlan.length - currentPlan.length;
  document.querySelector("#interestNote").textContent = state.extra ? `vs. ${money(standardInterest)} standard` : "Over the life of the loan";
  document.querySelector("#savedNote").textContent = monthsSaved ? `${monthsLabel(monthsSaved)} sooner` : "Keep exploring";
  document.querySelector("#insightText").textContent = state.extra ? `Your ${money(state.extra)} monthly extra starts in month ${state.extraStart} and could clear the loan ${monthsLabel(monthsSaved)} earlier.` : "Add an extra monthly payment to see how much interest and time you can save.";
  renderYearFilter(); renderTable(); drawChart(); if (state.autoSave) saveState();
}
function renderYearFilter() { const prior = state.yearFilter; const years = [...new Set(currentPlan.map(row => row.date.getFullYear()))]; yearFilter.innerHTML = `<option value="all">All payments</option>${years.map(year => `<option value="${year}">${year}</option>`).join("")}`; state.yearFilter = years.includes(Number(prior)) ? prior : "all"; yearFilter.value = state.yearFilter; }
function renderTable() { const rows = state.yearFilter === "all" ? currentPlan : currentPlan.filter(row => row.date.getFullYear() === Number(state.yearFilter)); scheduleRows.innerHTML = rows.map(row => `<tr><td>${row.payment}</td><td>${fmtDate(row.date)}</td><td>${cents.format(row.principal)}</td><td>${cents.format(row.interest)}</td><td>${row.extra ? cents.format(row.extra) : "—"}</td><td>${cents.format(row.balance)}</td></tr>`).join("") || `<tr><td colspan="6">No payments in this year.</td></tr>`; }
function drawChart() {
  const rect = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, width = Math.max(640, Math.floor(rect.width * dpr)) / dpr, height = Math.max(320, Math.floor(rect.height * dpr)) / dpr;
  canvas.width = width * dpr; canvas.height = height * dpr; ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,width,height); ctx.fillStyle="#0c1110"; ctx.fillRect(0,0,width,height);
  const pad={top:25,right:25,bottom:38,left:73}, pw=width-pad.left-pad.right, ph=height-pad.top-pad.bottom, max=Math.max(state.amount,1), length=Math.max(standardPlan.length,currentPlan.length);
  ctx.strokeStyle="rgba(231,215,168,.14)"; ctx.lineWidth=1; ctx.fillStyle="#b8b2a2"; ctx.font="700 12px Inter, system-ui"; ctx.textAlign="right"; ctx.textBaseline="middle";
  for(let i=0;i<=4;i++){ const y=pad.top+ph*i/4, value=max*(1-i/4); ctx.beginPath();ctx.moveTo(pad.left,y);ctx.lineTo(width-pad.right,y);ctx.stroke();ctx.fillText(shortMoney(value),pad.left-12,y); }
  const points=rows=>[{x:pad.left,y:pad.top},...rows.map((r,i)=>({x:pad.left+pw*(i+1)/length,y:pad.top+ph*(1-r.balance/max)}))];
  const line=(rows,color,dash,fill)=>{const pts=points(rows); if(fill){const grad=ctx.createLinearGradient(0,pad.top,0,height-pad.bottom);grad.addColorStop(0,"rgba(216,180,95,.32)");grad.addColorStop(1,"rgba(216,180,95,.015)");ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.lineTo(pts.at(-1).x,height-pad.bottom);ctx.lineTo(pad.left,height-pad.bottom);ctx.closePath();ctx.fillStyle=grad;ctx.fill();}ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.strokeStyle=color;ctx.setLineDash(dash);ctx.lineWidth=2.6;ctx.stroke();ctx.setLineDash([]);};
  line(standardPlan,"rgba(45,212,191,.72)",[7,6],false); line(currentPlan,"#d8b45f",[],true);
  ctx.fillStyle="#b8b2a2";ctx.textAlign="center";ctx.textBaseline="top";for(let i=0;i<=5;i++){const index=Math.min(length-1,Math.round(length*i/5));ctx.fillText(`M${index}`,pad.left+pw*index/length,height-pad.bottom+13);}
}
function shortMoney(value) { return value >= 1000000 ? `$${(value/1000000).toFixed(1)}M` : value >= 1000 ? `$${Math.round(value/1000)}K` : money(value); }
function sync(key, val) { state[key] = Math.max(0, Number(val) || 0); document.querySelectorAll(`[data-key="${key}"]`).forEach(el=>el.value=state[key]); render(); }
document.addEventListener("input", event => { const key=event.target.dataset.key; if(key) sync(key,event.target.value); });
document.querySelectorAll(".loan-type").forEach(button=>button.addEventListener("click",()=>{ const type=button.dataset.loanType; Object.assign(state,PRESETS[type],{loanType:type,yearFilter:"all"}); document.querySelectorAll(".loan-type").forEach(tab=>{const active=tab===button;tab.classList.toggle("active",active);tab.setAttribute("aria-selected",active);}); renderControls();render(); }));
yearFilter.addEventListener("change",event=>{state.yearFilter=event.target.value;renderTable();if(state.autoSave)saveState();}); document.querySelector("#autoSave").addEventListener("change",event=>{state.autoSave=event.target.checked;if(state.autoSave)saveState();}); document.querySelector("#saveButton").addEventListener("click",saveState); document.querySelector("#resetButton").addEventListener("click",()=>{localStorage.removeItem(STORAGE_KEY);Object.assign(state,DEFAULTS);document.querySelector("#autoSave").checked=state.autoSave;document.querySelector("#startDate").value=state.startDate;document.querySelectorAll(".loan-type").forEach(tab=>{const active=tab.dataset.loanType===state.loanType;tab.classList.toggle("active",active);tab.setAttribute("aria-selected",active);});renderControls();render();});
document.querySelector("#downloadButton").addEventListener("click",()=>{ const header="Payment,Date,Principal,Interest,Extra Payment,Remaining Balance"; const data=currentPlan.map(r=>[r.payment,fmtDate(r.date),r.principal.toFixed(2),r.interest.toFixed(2),r.extra.toFixed(2),r.balance.toFixed(2)].join(",")); const link=document.createElement("a"), url=URL.createObjectURL(new Blob([[header,...data].join("\n")],{type:"text/csv"}));link.href=url;link.download="loan-amortization-schedule.csv";link.click();URL.revokeObjectURL(url); });
document.querySelector("#startDate").addEventListener("change", event => { state.startDate = event.target.value || DEFAULTS.startDate; render(); });
window.addEventListener("resize",drawChart); document.querySelector("#autoSave").checked=state.autoSave; document.querySelector("#startDate").value=state.startDate; renderControls(); render();

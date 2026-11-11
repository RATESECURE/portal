/* Borrower call sheet core: math, inputs, slides, the borrower PDF and the follow-up email draft.
   Home: the Brighter Funding Tools project (portal call-sheet.html). Also used by the Call tab in Trevor's personal Pipeline CRM.
   Engine changes are made in the home copy only; bump VERSION and send the update kit to the other host.
   Host pages call CSCore.bind(getState, getSheets, opts) once, then mount inputs or the presentation.
   opts (optional): planningRate(state) → rate % used when the rate is blank; insurancePct(state) → insurance as % of value per year.
   Classes are cs-*, colors are --cs-* tokens set on .csx (or use .cs-calm for the borrower-facing theme). */
window.CSCore = (() => {
const $ = (s, r=document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const n = v => { const x = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, "")); return isFinite(x) ? x : 0; };
const money = (v, cents=false) => (v < 0 ? "-" : "") + "$" + Math.abs(v).toLocaleString("en-US", {minimumFractionDigits: cents?2:0, maximumFractionDigits: cents?2:0});
const pct = (v, d=1) => (isFinite(v) ? (v*100).toFixed(d) : "—") + "%";
const uid = () => Math.random().toString(36).slice(2, 9);
// Dollar inputs show thousands separators as you type (1,250,000). n() ignores the commas, so the math is unchanged.
const commafy = v => { const t = String(v ?? "").replace(/[^0-9.]/g, ""); if(t === "") return ""; const [i, ...d] = t.split("."); const int = (i.replace(/^0+(?=\d)/, "") || (d.length ? "0" : "")).replace(/\B(?=(\d{3})+(?!\d))/g, ","); return d.length ? int + "." + d.join("").slice(0, 2) : int; };
function liveCommas(el){
  const v = el.value, caret = el.selectionStart ?? v.length;
  const before = v.slice(0, caret).replace(/[^0-9.]/g, "").length;   // digits left of the caret
  const out = commafy(v); el.value = out;
  let i = 0, seen = 0; while(i < out.length && seen < before){ if(/[0-9.]/.test(out[i])) seen++; i++; }
  try { el.setSelectionRange(i, i); } catch(e){}
  return out;
}
// Used until the shared sheets load, or if the database isn't reachable in this view.
const FALLBACK_SHEETS = [{id:"ratesecure-standard", name:"RateSecure (standard)", asOf:"Oct 2026", order:1,
  fees:[{label:"Application",amount:595},{label:"Underwriting",amount:1595},{label:"Processing",amount:1195},{label:"Document prep",amount:249,rollup:true},{label:"Tax service",amount:85,rollup:true},{label:"Flood certification",amount:15,rollup:true},{label:"MERS",amount:24.95,rollup:true}],
  appraisal:950, credit:219, notes:"Credit report is per borrower."}];
const blank = () => ({
  example:false, first:"", last:"", coOn:false, coFirst:"", coLast:"", purpose:"purchase", qualify:"income", occ:"primary",
  score:"", price:"", downPct:"20", downAmt:"", downMode:"pct", value:"", payoff:"", curPI:"", cashOut:"",
  rate:"", noRateYet:false, term:"30", buydown:"none", docType:"", taxRate:"1.25", hoi:"", hoiPct:"", hoiMode:"amt", hoa:"", miType:"auto", miRate:"0.5",
  incomes:[{id:uid(),label:"Borrower",amt:""}], debts:[{id:uid(),label:"",amt:""}], assets:[{id:uid(),label:"Checking / savings",amt:""}],
  rent:"", emd:"", sellerCredit:"", lenderCredit:"",
  sheetId:"", feeEdits:{}, appraisal:null, credit:null, borrowers:"1",
  title:"", other:"", interestDays:"15", impounds:true,
  options:[], dtiTarget:"", dscrTarget:"", pathShow:false, pathPick:{}, appIn:false,
  preapproved:false,   // welcome slide: pre-approval wording and the 90-day note (decided per deal)
  showRate:false,      // rate and points on the slides (off by default; the LO turns it on)
  points:"",           // points as % of the loan (origination or rate buydown); a cost on the lender line
  exOn:true, exMaxDti:"", exTries:[],   // price explorer (purchases): max DTI for this program, saved what-ifs {id, kind:"price"|"pay", v}
  curPay:"",        // refis: current full house payment (mortgage, taxes, insurance, HOA) for "current vs new"
  docsIn:{},        // document checklist items marked received (clicked in the presentation)
  showProg:false, progName:"", lockStatus:"", lockDate:"", contDate:"", closeDate:"",   // optional program & key dates
  se:{months:"24", deposits:"", exp:"50", own:"100"},   // self-employed / bank statement income helper
  reo:[],           // real estate owned: {id, label, status: "rental"|"retain"|"sale", pitia, rent, who}
  reoFactor:"75",   // % of gross rent counted (standard vacancy factor)
  bureau:[]   // credit scores by bureau, one row per borrower: {id, label, eq, ex, tu}. The qualifying score is the lowest middle score.
});
const example = () => Object.assign(blank(), {
  example:true, first:"", purpose:"purchase", qualify:"income", occ:"primary", score:"735",
  price:"850000", downPct:"20", rate:"6.875", term:"30", taxRate:"1.25", hoi:"1800", hoa:"0",
  incomes:[{id:uid(),label:"Borrower (W-2)",amt:"11500"},{id:uid(),label:"Co-borrower",amt:"4200"}],
  debts:[{id:uid(),label:"Car payment",amt:"520"},{id:uid(),label:"Credit cards (minimums)",amt:"150"},{id:uid(),label:"Student loan",amt:"210"}],
  assets:[{id:uid(),label:"Checking / savings",amt:"215000"},{id:uid(),label:"401(k) (vested)",amt:"90000"}],
  emd:"25000", sellerCredit:"0", title:"4200", other:"350"
});

// bound per call to whichever host state is active
let H = {state: () => blank(), sheets: () => FALLBACK_SHEETS, opts: {}}, S = null, SHEETS = FALLBACK_SHEETS;
// Lender fees that show as one "Lender fees" line to the borrower (click it to see them). A fee sheet item can set rollup true/false.
const ROLLUP_RE = /doc(ument)?\s*prep|tax\s*service|flood|mers/i;
const rollsUp = f => f.rollup != null ? !!f.rollup : ROLLUP_RE.test(f.label || "");
// No lender picked yet: no lender fees; appraisal and credit report are typed in (or left at 0)
const NO_SHEET = {id:"", name:"No lender yet", asOf:"", order:0, fees:[], appraisal:0, credit:0, notes:""};
const BUYDOWNS = {none:[], "1-0":[1], "2-1":[2,1], "3-2-1":[3,2,1]};
// Who a line belongs to: "b" borrower, "c" co-borrower, "j" joint. Older sheets may hold a typed name instead.
const ownerName = who => who === "b" ? (String(S.first||"").trim() || "Borrower") : who === "c" ? (String(S.coFirst||"").trim() || "Co-borrower") : who === "j" ? "Joint" : String(who || "").trim();
const ownSel = (x, joint) => `<select class="cs-own" data-rk="who" aria-label="Whose">${[["b", String(S.first||"").trim() || "Borrower"], ["c", String(S.coFirst||"").trim() || "Co-borrower"], ...(joint ? [["j","Joint"]] : [])].map(([v,l]) => `<option value="${v}" ${(x.who || (joint ? "j" : "b")) === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
// Real estate owned: 75% of gross rent minus the full payment (PITIA). Positive adds to income, negative counts as a debt; a property being sold isn't counted.
const reoNet = r => r.status === "sale" ? 0 : r.status === "rental" ? n(r.rent) * (n(S.reoFactor) || 75) / 100 - n(r.pitia) : -n(r.pitia);
const reoLive = () => (S.reo || []).filter(r => r.status !== "sale" && (n(r.pitia) || (r.status === "rental" && n(r.rent))));
// Middle score: 3 scores → the middle one; 2 → the lower; 1 → that one. Qualifying score: the lowest middle across borrowers.
const BUREAUS = [["eq","Equifax"],["ex","Experian"],["tu","TransUnion"]];
const midOf = r => { const v = BUREAUS.map(([k]) => n(r[k])).filter(x => x >= 300 && x <= 900).sort((a,b) => a-b); return v.length === 3 ? v[1] : v.length ? v[0] : 0; };
const scoredRows = () => (S.bureau || []).filter(r => midOf(r));
const qualScore = () => { const m = scoredRows().map(midOf); return m.length ? Math.min(...m) : 0; };
const piFor = (amt, ratePct, years) => { const r = ratePct/100/12, N = years*12; return !amt ? 0 : r ? amt * r / (1 - Math.pow(1+r, -N)) : amt / N; };
function sync(){
  S = H.state();
  if(S.docType == null) S.docType = ""; if(S.noRateYet == null) S.noRateYet = false;
  if(!Array.isArray(S.options)) S.options = []; if(S.dtiTarget == null) S.dtiTarget = ""; if(S.dscrTarget == null) S.dscrTarget = ""; if(S.pathShow == null) S.pathShow = false; if(!S.pathPick || typeof S.pathPick !== "object") S.pathPick = {};   // states saved before 1.2
  if(S.downMode == null){ S.downMode = "pct"; S.downAmt = ""; } if(S.hoiMode == null){ S.hoiMode = "amt"; S.hoiPct = ""; } if(!Array.isArray(S.bureau)) S.bureau = []; if(S.coFirst == null) S.coFirst = ""; if(S.last == null) S.last = ""; if(S.coLast == null) S.coLast = ""; if(S.coOn == null) S.coOn = !!String(S.coFirst || "").trim(); if(S.points == null) S.points = ""; if(!Array.isArray(S.reo)) S.reo = []; if(!Array.isArray(S.exTries)) S.exTries = []; if(S.exOn == null) S.exOn = true; if(!S.docsIn || typeof S.docsIn !== "object") S.docsIn = {};
  if(!S.se || typeof S.se !== "object") S.se = {months:"24", deposits:"", exp:"50", own:"100"}; ["curPay","progName","lockStatus","lockDate","contDate","closeDate","exMaxDti"].forEach(k => { if(S[k] == null) S[k] = ""; }); S.showProg = !!S.showProg; if(S.reoFactor == null || S.reoFactor === "") S.reoFactor = "75"; S.showRate = !!S.showRate; S.preapproved = !!S.preapproved;
  if(S.buydown == null) S.buydown = "none";   // states saved by v1.0
  { const q = qualScore(); if(q) S.score = String(q); }   // bureau scores, when entered, set the score
  const list = H.sheets(); SHEETS = list && list.length ? list : FALLBACK_SHEETS;
  if(S.sheetId && !SHEETS.some(s => s.id===S.sheetId)){ S.sheetId = ""; S.feeEdits = {}; S.appraisal = null; S.credit = null; }
}

// ---------- math ----------
function calc(){
  const sheet = (S.sheetId && SHEETS.find(s => s.id===S.sheetId)) || NO_SHEET;
  const purchase = S.purpose==="purchase", dscr = S.qualify==="dscr";
  const price = n(S.price), value = purchase ? price : n(S.value);
  let loan = 0, down = 0;
  if(purchase){ down = S.downMode==="amt" ? Math.min(n(S.downAmt), price) : price * n(S.downPct)/100; loan = price - down; }
  else if(S.purpose==="cashout"){ loan = n(S.payoff) + n(S.cashOut); }
  else { loan = n(S.payoff); }
  const downPct = purchase && price ? down/price*100 : 0;
  const ltv = value ? loan/value : 0;
  // mortgage insurance
  let miType = S.miType;
  if(miType==="auto") miType = (S.occ==="primary" && ltv > .8 && !dscr) ? "pmi" : "none";
  const ufmip = miType==="fha" ? loan*0.0175 : 0;
  const base = loan, total = loan + ufmip;
  // Rate: what the LO typed, else the host's planning rate. It feeds the payment but is never shown to the borrower.
  const planRate = H.opts.planningRate ? n(H.opts.planningRate(S)) : 0;
  // "No rate yet": ignore the planning rate; the payment then shows principal only (no interest) until a rate is set
  const typed = String(S.rate ?? "").trim() !== "" && !S.noRateYet;
  const rateUsed = typed ? n(S.rate) : S.noRateYet ? 0 : planRate, ratePlanned = !typed && !S.noRateYet && !!planRate;
  const pi = piFor(total, rateUsed, n(S.term));
  const noRate = !rateUsed && total > 0;   // no rate: P&I is principal only, and it's labeled that way everywhere
  // Insurance: what the LO typed, else the host's estimate (% of value per year)
  const hoiEst = H.opts.insurancePct ? value * n(H.opts.insurancePct(S))/100 : 0;
  // Insurance can be typed as $ per year or as % of value per year (whichever the LO typed last drives the other)
  const hoiTyped = S.hoiMode === "pct" ? String(S.hoiPct ?? "").trim() !== "" : String(S.hoi ?? "").trim() !== "";
  const hoiYear = !hoiTyped ? hoiEst : S.hoiMode === "pct" ? value * n(S.hoiPct)/100 : n(S.hoi), hoiEstimated = !hoiTyped && hoiEst > 0;
  const tax = value * n(S.taxRate)/100/12, hoi = hoiYear/12, hoa = n(S.hoa);
  const mi = miType==="pmi" ? base * n(S.miRate)/100/12 : miType==="fha" ? total*0.0055/12 : 0;
  const pitia = pi + tax + hoi + mi + hoa;
  // Temporary buydown: payments in the reduced years, and the upfront cost (usually covered by a seller credit)
  const steps = BUYDOWNS[S.buydown] || [];
  const buydownYears = !rateUsed ? [] : steps.map((d, i) => { const p = piFor(total, Math.max(0, rateUsed - d), n(S.term)); return {year:i+1, pi:p, pitia: p + tax + hoi + mi + hoa}; });
  const buydownCost = rateUsed ? buydownYears.reduce((a, y) => a + (pi - y.pi)*12, 0) : 0;
  const incomeBase = S.incomes.reduce((a,x) => a + n(x.amt), 0);
  const reoIncome = S.qualify === "dscr" ? 0 : reoLive().reduce((a, r) => a + Math.max(0, reoNet(r)), 0);
  const reoDebt = S.qualify === "dscr" ? 0 : reoLive().reduce((a, r) => a + Math.max(0, -reoNet(r)), 0);
  const income = incomeBase + reoIncome;
  // Cash-out debt consolidation: debts ticked "pay off" are paid from the proceeds and drop out of the DTI
  const paidOff = S.purpose==="cashout" ? S.debts.filter(x => x.payoff && n(x.bal) > 0) : [];   // needs a balance to count
  const payoffBal = paidOff.reduce((a,x) => a + n(x.bal), 0), payoffFreed = paidOff.reduce((a,x) => a + n(x.amt), 0);
  // "Exclude from DTI" (e.g. a charge card paid in full each month) keeps the debt on the liabilities slide but out of the ratio
  const debts = S.debts.filter(x => !paidOff.includes(x) && !x.excl).reduce((a,x) => a + n(x.amt), 0) + reoDebt;
  const debtsListed = S.debts.filter(x => !paidOff.includes(x)).reduce((a,x) => a + n(x.amt), 0);
  const dtiFront = income ? pitia/income : NaN, dti = income ? (pitia+debts)/income : NaN;
  const dscrRatio = pitia ? n(S.rent)/pitia : NaN;
  // closing costs
  const lenderFees = (sheet.fees||[]).map((f,i) => ({label:f.label, rollup: rollsUp(f), amount: S.feeEdits[i]!=null && S.feeEdits[i]!=="" ? n(S.feeEdits[i]) : n(f.amount)}));
  const lenderTotal = lenderFees.reduce((a,f) => a+f.amount, 0);
  const rolled = lenderFees.filter(f => f.rollup), rolledTotal = rolled.reduce((a,f) => a+f.amount, 0);
  const pointsAmt = Math.round(total * n(S.points) / 100);   // 1.5: points are back as an LO input (shown as a % only when "Show rate" is on)
  const appraisal = S.appraisal!=null && S.appraisal!=="" ? n(S.appraisal) : n(sheet.appraisal);
  const credit = (S.credit!=null && S.credit!=="" ? n(S.credit) : n(sheet.credit)) * Math.max(1, n(S.borrowers)||1);
  const third = [{label:"Appraisal", amount:appraisal},{label:"Credit report", amount:credit},{label:"Title & escrow (estimate)", amount:n(S.title)},{label:"Recording & other", amount:n(S.other)}];
  const thirdTotal = third.reduce((a,f) => a+f.amount, 0);
  const perDiem = total * rateUsed/100/365;
  const prepaids = [{label:`Prepaid interest (${n(S.interestDays)} days)`, amount: perDiem*n(S.interestDays)},
    ...(purchase ? [{label:"Homeowners insurance, first year", amount:hoiYear}] : []),
    ...(S.impounds ? [{label:"Tax reserves (3 months)", amount:tax*3},{label:"Insurance reserves (2 months)", amount:hoi*2}] : [])];
  const prepaidTotal = prepaids.reduce((a,f) => a+f.amount, 0);
  const closing = lenderTotal + pointsAmt + thirdTotal + buydownCost;
  const sellerCr = purchase ? n(S.sellerCredit) : 0;   // a seller credit only exists on a purchase
  const credits = sellerCr + n(S.lenderCredit);
  const emd = purchase ? n(S.emd) : 0;
  let cashToClose, cashOutNet = 0;
  if(purchase) cashToClose = down + closing + prepaidTotal - credits - emd;
  else { cashOutNet = loan - n(S.payoff) - payoffBal - closing - prepaidTotal + credits; cashToClose = -cashOutNet; }
  const assets = S.assets.reduce((a,x) => a + n(x.amt), 0);
  const fundsNeeded = Math.max(0, cashToClose) + emd;
  const reserves = pitia ? (assets - fundsNeeded)/pitia : NaN;
  const savings = S.purpose==="rate" && rateUsed ? n(S.curPI) - pi : NaN;   // no rate, no savings figure
  const breakEven = savings > 0 ? (closing - credits)/savings : NaN;
  // Refi "current vs new": today's full house payment plus debts paid off at closing, against the new payment
  const curToday = !purchase && n(S.curPay) ? n(S.curPay) + payoffFreed : 0;
  const monthlyChange = curToday && !noRate ? curToday - pitia : NaN;   // positive = less each month; no claim without a rate
  const refiBreakEven = monthlyChange > 0 ? Math.max(0, closing - credits) / monthlyChange : NaN;
  return {sheet, purchase, dscr, price, value, loan, down, downPct, ltv, miType, ufmip, total, rate: rateUsed, ratePlanned, pi, tax, hoi, hoiYear, hoiEstimated, mi, hoa, pitia,
    buydownYears, buydownCost, income, debts, paidOff, payoffBal, payoffFreed, dtiFront, dti, dscrRatio,
    noRate, curToday, monthlyChange, refiBreakEven, debtsListed, incomeBase, reoIncome, reoDebt, pointsPct: n(S.points), term: n(S.term), sellerCr, lenderFees, lenderTotal, rolled, rolledTotal, pointsAmt, third, thirdTotal, prepaids, prepaidTotal, closing, credits, emd, cashToClose, cashOutNet, assets, fundsNeeded, reserves, savings, breakEven};
}
// Run the math with some fields changed (for options and "how to get there"), then put the state back
function calcWith(over){ const keep = S; S = Object.assign({}, keep, over); try { return calc(); } finally { S = keep; } }
const OPTION_KEYS = ["label","price","downPct","downAmt","downMode","sellerCredit","buydown","term","cashOut","rate","points"];
// "$12,000 to you" or "$246 to close", by sign (refis can go either way)
const cashWord = k => k.purchase ? `${money(k.cashToClose)} to close` : k.cashOutNet >= 0 ? `${money(k.cashOutNet)} to you` : `${money(-k.cashOutNet)} to close`;
// An option's own rate/points only count while "Show rate" is on (the fields are hidden otherwise)
function optionCalcs(){ return S.options.map((o, i) => { const over = {}; OPTION_KEYS.forEach(k => { if(k !== "label" && o[k] != null && o[k] !== "" && (S.showRate || !["rate","points"].includes(k))) over[k] = o[k]; }); return {o, label: o.label || `Option ${i+2}`, c: calcWith(over)}; }); }
// Largest x in [lo, hi] where ok(x) holds (ok true at lo, false at hi)
function bisect(lo, hi, ok){ if(!ok(lo)) return null; if(ok(hi)) return hi; for(let k=0; k<40; k++){ const m = (lo+hi)/2; ok(m) ? lo = m : hi = m; } return lo; }
const roundTo = (v, step) => Math.floor(v/step)*step;
// ---- Price explorer (purchases): work backward from a max DTI or a target payment, or forward from any price.
// Everything else stays as entered; the down payment is held at the same % of the price.
const exDti = () => n(S.exMaxDti) || n(S.dtiTarget) || 45;
const exDown = c0 => { const d = S.downMode === "amt" && c0.price ? c0.downPct : n(S.downPct); return isFinite(d) && d >= 0 ? d : 20; };
const exAt = (price, c0) => calcWith({price: String(Math.round(price)), downMode: "pct", downPct: String(exDown(c0))});
const exRow = (price, c0) => { const k = exAt(price, c0); return {price: Math.round(price), down: k.down, loan: k.total, pitia: k.pitia, dti: k.dti}; };
const EX_TOP = 1e8;
const exMaxPrice = c0 => { if(!c0.income) return null; const lim = exDti()/100; const p = bisect(10000, EX_TOP, x => exAt(x, c0).dti <= lim); return p == null ? null : roundTo(p, 1000); };
const exPriceForPay = (target, c0) => { if(!(target > 0)) return null; const p = bisect(10000, EX_TOP, x => exAt(x, c0).pitia <= target); return p == null ? null : roundTo(p, 1000); };
const exTryRow = (t, c0) => { const v = n(t.v); if(!(v > 0)) return null; const price = t.kind === "pay" ? exPriceForPay(v, c0) : v; return price ? Object.assign(exRow(price, c0), {t}) : {t, none:true}; };
// "Other ways to structure this": optional, LO-driven. Nothing is suggested until the LO sets a target for THIS scenario
// (the program decides it: FHA, VA and some non-QM go higher). Items are options, never "short" or "doesn't qualify".
function pathTo(c){
  const out = [];
  if(!c.dscr && c.income && isFinite(c.dti) && n(S.dtiTarget)){
    const t = n(S.dtiTarget)/100;
    if(c.dti > t){
      const over = c.pitia + c.debts - c.income*t;
      if(c.debts > 0 && over <= c.debts) out.push({k:"debts", kind:"dti", t:`Paying down about ${money(over)} a month in debts would give more room.`});
      out.push({k:"income", kind:"dti", t:`About ${money(over/t)} a month more in qualifying income (for example, a co-borrower) would get there.`});
      if(c.purchase){ const p = bisect(0, c.price, x => calcWith({price:String(x)}).dti <= t); if(p && p < c.price) out.push({k:"price", kind:"dti", t:`A price around ${money(roundTo(p, 5000))} keeps the same down payment.`}); }
      else if(S.purpose==="cashout"){ const co = bisect(c.payoffBal || 0, n(S.cashOut), x => calcWith({cashOut:String(x)}).dti <= t); if(co != null && co < n(S.cashOut)) out.push({k:"cashout", kind:"dti", t:`Taking about ${money(roundTo(co, 1000))} cash out would also work.`}); }
    }
  }
  if(c.dscr && n(S.rent) && isFinite(c.dscrRatio) && n(S.dscrTarget)){
    const t = n(S.dscrTarget);
    if(c.dscrRatio < t){
      out.push({k:"rent", kind:"dscr", t:`Rent of about ${money(c.pitia*t)} a month would get there.`});
      if(c.purchase){ const d = bisect(0, 80, x => !(calcWith({downPct:String(100-x), downMode:"pct"}).dscrRatio < t)); if(d != null && 100-d > c.downPct) out.push({k:"down", kind:"dscr", t:`A down payment around ${Math.ceil(100-d)}% (${money(c.price*(100-d)/100)}) would also work.`}); }
    }
  }
  if(c.purchase && c.assets && c.assets < c.fundsNeeded && (n(S.dtiTarget) || n(S.dscrTarget) || S.pathShow)){
    out.push({k:"cash", kind:"cash", t:`A seller credit toward closing costs, gift funds or a different down payment can help with funds to close.`});
  }
  return out;
}
// On a slide only when the LO turned it on, and only the items they ticked
const pathBox = (c, kind) => { if(!S.pathShow) return ""; const p = pathTo(c).filter(x => (kind === "cash" ? x.kind === "cash" : x.kind !== "cash") && S.pathPick[x.k]); return p.length ? `<div class="cs-path-slide"><b>Other ways to structure this</b><ul>${p.map(x => `<li>${esc(x.t)}</li>`).join("")}</ul></div>` : ""; };
// Colors on the LO's inputs page. With a target set, at or under the target reads as fine.
const dtiTone = d => !isFinite(d) ? "" : d <= .43 ? "ok" : d <= .5 ? "warn" : "bad";        // slides: general ranges
const dscrTone = d => !isFinite(d) ? "" : d >= 1.25 ? "ok" : d >= 1 ? "warn" : "bad";
const dtiToneLO = d => { const t = n(S.dtiTarget)/100; return t && isFinite(d) ? (d <= t ? "ok" : "warn") : dtiTone(d); };   // inputs page: the LO's target when set
const dscrToneLO = d => { const t = n(S.dscrTarget); return t && isFinite(d) ? (d >= t ? "ok" : "warn") : dscrTone(d); };
const TIERS = [[0,619,"Below 620"],[620,679,"620–679"],[680,719,"680–719"],[720,759,"720–759"],[760,850,"760+"]];
const tierOf = s => TIERS.findIndex(([a,b]) => s>=a && s<=b);
const PURPOSE = {purchase:"Purchase", rate:"Rate & term refinance", cashout:"Cash-out refinance"};
const OCC = {primary:"Primary home", second:"Second home", investment:"Investment property"};

// ---------- inputs ----------
const fld = (key, label, {pre, post, note, type="text", mode="decimal", ph=""}={}) =>
  `<label class="cs-f"><span>${esc(label)}</span><span class="cs-adorn ${pre?"pre":""} ${post?"post":""}">${pre?`<i>${pre}</i>`:""}<input id="cs-f-${key}" data-k="${key}" ${pre==="$"?"data-money":""} type="${type}" inputmode="${mode}" value="${esc(pre==="$" ? commafy(S[key]) : S[key])}" placeholder="${esc(ph)}" autocomplete="off">${post?`<i>${post}</i>`:""}</span>${note?`<span class="cs-note">${note}</span>`:""}</label>`;
const segs = (key, opts) => `<div class="cs-seg" role="group">${Object.entries(opts).map(([v,l]) => `<button type="button" data-seg="${key}" data-v="${v}" aria-pressed="${S[key]===v}">${esc(l)}</button>`).join("")}</div>`;
// Each debt can be excluded from the DTI (e.g. a charge card paid in full monthly): it still shows on the liabilities slide with a note
const exclBox = x => `<label class="cs-note" style="display:flex;gap:4px;align-items:center;white-space:nowrap" title="Keep it on the liabilities slide but leave it out of the DTI"><input type="checkbox" data-rk="excl" ${x.excl?"checked":""}> Exclude</label>`;
const debtRows = () => S.purpose !== "cashout" ? `<div class="cs-rows" data-list="debt">${S.debts.map(x => `<div class="cs-row cs-debt${S.coOn ? " own" : ""}" data-id="${x.id}"><input aria-label="Description" data-rk="label" value="${esc(x.label)}" placeholder="e.g. Car payment"><span class="cs-adorn pre"><i>$</i><input aria-label="Monthly payment" data-rk="amt" data-money inputmode="decimal" value="${esc(commafy(x.amt))}" placeholder="0" style="padding-left:22px;width:100%"></span>${S.coOn ? ownSel(x, true) : ""}${exclBox(x)}<button type="button" class="cs-x" data-del="debts" aria-label="Remove">×</button></div>`).join("")}</div><button type="button" class="cs-btn small cs-addrow" data-add="debts">+ Add</button>` :
  `<div class="cs-rows" data-list="debt">${S.debts.map(x => `<div class="cs-row cs-debt cs-debt-co${S.coOn ? " own" : ""}" data-id="${x.id}"><input aria-label="Description" data-rk="label" value="${esc(x.label)}" placeholder="e.g. Car payment"><span class="cs-adorn pre"><i>$</i><input aria-label="Monthly payment" data-rk="amt" data-money inputmode="decimal" value="${esc(commafy(x.amt))}" placeholder="0" style="padding-left:22px;width:100%"></span>${S.coOn ? ownSel(x, true) : ""}<label class="cs-note" style="display:flex;gap:4px;align-items:center;white-space:nowrap"><input type="checkbox" data-rk="payoff" ${x.payoff?"checked":""}> Pay off</label>${exclBox(x)}<button type="button" class="cs-x" data-del="debts" aria-label="Remove">×</button>
    ${x.payoff ? `${n(x.bal) > 0 ? "" : `<span class="cs-note" style="grid-column:1/-1;color:var(--cs-warn)">Enter the balance; until then this debt still counts in the DTI.</span>`}<span class="cs-adorn pre" style="grid-column:1/3"><i>$</i><input aria-label="Balance to pay off" data-rk="bal" data-money inputmode="decimal" value="${esc(commafy(x.bal))}" placeholder="Balance to pay off" style="padding-left:22px;width:100%"></span>` : ""}</div>`).join("")}</div><button type="button" class="cs-btn small cs-addrow" data-add="debts">+ Add</button>`;
// Income rows: label (employer · position · type), monthly amount, and on a second line the borrower and how it's figured (e.g. 9,024.33 × 2)
const incRows = () => `<div class="cs-rows" data-list="inc">${S.incomes.map(x => `<div class="cs-row${S.coOn ? " own" : ""}" data-id="${x.id}"><input aria-label="Description" data-rk="label" value="${esc(x.label)}" placeholder="e.g. Salesforce · Agile Coach · Base"><span class="cs-adorn pre"><i>$</i><input aria-label="Amount" data-rk="amt" data-money inputmode="decimal" value="${esc(commafy(x.amt))}" placeholder="0" style="padding-left:22px;width:100%"></span>${S.coOn ? ownSel(x, false) : ""}<button type="button" class="cs-x" data-del="incomes" aria-label="Remove">×</button>
  ${S.incomes.length > 1 ? `<input aria-label="How it's figured" data-rk="note" value="${esc(x.note || "")}" placeholder="How it's figured (optional, e.g. 9,024.33 × 2)" style="font-size:13px;grid-column:1/-1">` : ""}</div>`).join("")}</div><button type="button" class="cs-btn small cs-addrow" data-add="incomes">+ Add</button>`;
const rows = (list, kind, ph) => `<div class="cs-rows" data-list="${kind}">${S[list].map(x => `<div class="cs-row${S.coOn ? " own" : ""}" data-id="${x.id}"><input aria-label="Description" data-rk="label" value="${esc(x.label)}" placeholder="${esc(ph)}"><span class="cs-adorn pre"><i>$</i><input aria-label="Amount" data-rk="amt" data-money inputmode="decimal" value="${esc(commafy(x.amt))}" placeholder="0" style="padding-left:22px;width:100%"></span>${S.coOn ? ownSel(x, true) : ""}${list === "assets" ? `<label class="cs-note" style="display:flex;gap:4px;align-items:center;white-space:nowrap" title="Gift funds need a gift letter and proof of transfer"><input type="checkbox" data-rk="gift" ${x.gift?"checked":""}> Gift</label>` : ""}<button type="button" class="cs-x" data-del="${list}" aria-label="Remove">×</button></div>`).join("")}</div><button type="button" class="cs-btn small cs-addrow" data-add="${list}">+ Add</button>`;
// Price explorer card (LO side): max DTI for the program, saved what-ifs, and whether the slide shows
let exOpen = false;
const exploreCard = c => { const mx = exMaxPrice(c), mr = mx ? exRow(mx, c) : null;
  return `<details class="cs-card cs-path" id="cs-exbox" ${exOpen ? "open" : ""} style="margin-top:16px"><summary><div><h2 style="display:inline">Price explorer</h2> <span class="cs-note">· max price, “what if” price or payment</span></div><b>${mx ? "Up to " + money(mx) : ""}</b></summary>
    <div class="cs-fields" style="margin-top:10px">${fld("exMaxDti","Max DTI for this program",{post:"%", ph: String(n(S.dtiTarget) || 45), note: "Down payment held at " + (Math.round(exDown(c)*10)/10) + "%"})}
      <div class="cs-f"><span>Max price</span><div class="cs-v" style="font-size:18px;font-weight:700;padding-top:8px">${mx ? money(mx) : "—"}</div><span class="cs-note">${mr ? money(mr.pitia) + "/mo · loan " + money(mr.loan) : c.income ? "Debts and fixed housing costs (taxes, HOA) already use the full DTI" : "Add income first"}</span></div></div>
    <p class="cs-hint" style="margin:12px 0 6px">What-ifs to show (you can also try numbers live on the slide):</p>
    <div class="cs-rows" data-list="ex">${S.exTries.map(t => { const r = exTryRow(t, c);
      return `<div class="cs-row" data-id="${t.id}" style="grid-template-columns:150px 1fr auto 32px"><select data-rk="kind" aria-label="What-if type"><option value="price" ${t.kind!=="pay"?"selected":""}>At a price of</option><option value="pay" ${t.kind==="pay"?"selected":""}>For a payment of</option></select><span class="cs-adorn pre"><i>$</i><input data-rk="v" data-money inputmode="decimal" value="${esc(commafy(t.v))}" placeholder="0" style="padding-left:22px;width:100%"></span><span class="cs-note" style="align-self:center">${r && r.none ? "Not reachable with these numbers" : r && !r.none ? (t.kind === "pay" ? "price " + money(r.price) + " · " : "") + money(r.pitia) + "/mo · DTI " + pct(r.dti) : ""}</span><button type="button" class="cs-x" data-del="exTries" aria-label="Remove">×</button></div>`; }).join("")}</div>
    <button type="button" class="cs-btn small cs-addrow" data-add="exTries">+ Add a what-if</button>
    <label class="cs-chk" style="margin-top:10px"><input type="checkbox" id="cs-f-exon" ${S.exOn?"checked":""}> Show the “What you can afford” slide</label></details>`; };
// Self-employed / bank statement income helper (only for those income types)
const SE_TYPES = ["self_employed","bank_statement","pnl","1099"];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const seExp = () => String(S.se.exp ?? "").trim() === "" ? 50 : clamp(n(S.se.exp), 0, 100);     // blank = the usual 50%
const seOwn = () => String(S.se.own ?? "").trim() === "" ? 100 : clamp(n(S.se.own), 0, 100);
const seMonthly = () => { const d = n(S.se.deposits), m = n(S.se.months) || 24; const v = d ? d / m * (1 - seExp()/100) * (seOwn()/100) : 0; return v > 0 ? v : 0; };
let seOpen = false;
const seBox = () => !SE_TYPES.includes(S.docType) || S.qualify === "dscr" ? "" : `<details class="cs-path" id="cs-sebox" ${seOpen ? "open" : ""} style="margin-top:10px"><summary>Self-employed income helper <span class="cs-note">· deposits → monthly income</span></summary>
  <div class="cs-fields" style="margin-top:8px"><label class="cs-f"><span>Statements</span><select data-se="months">${["12","24"].map(v => `<option value="${v}" ${String(S.se.months)===v?"selected":""}>${v} months</option>`).join("")}</select></label>
    <label class="cs-f"><span>Total business deposits</span><span class="cs-adorn pre"><i>$</i><input data-se="deposits" data-money inputmode="decimal" value="${esc(commafy(S.se.deposits))}" placeholder="over the period" autocomplete="off"></span></label>
    <label class="cs-f"><span>Expense factor</span><span class="cs-adorn post"><input data-se="exp" inputmode="decimal" value="${esc(S.se.exp)}" autocomplete="off"><i>%</i></span></label>
    <label class="cs-f"><span>Ownership</span><span class="cs-adorn post"><input data-se="own" inputmode="decimal" value="${esc(S.se.own)}" autocomplete="off"><i>%</i></span></label></div>
  <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:6px"><span class="cs-note" id="cs-se-out">${seMonthly() ? money(seMonthly()) + "/mo" : "Enter the deposits"}</span><button type="button" class="cs-btn small" id="cs-se-use" ${seMonthly() ? "" : "disabled"}>Use as income line</button></div></details>`;
// Seller credit check at basic Fannie Mae limits (interested party contributions). LO side only; programs differ.
const ipcLimit = c => S.occ === "investment" ? 2 : S.miType === "fha" ? 6 : c.ltv > .9 ? 3 : c.ltv > .75 ? 6 : 9;
const REO_STATUS = {rental:"Renting it out", retain:"Keeping it (no rent)", sale:"Selling before closing"};
const reoRows = () => `<div class="cs-rows" data-list="reo">${(S.reo||[]).map(r => { const net = reoNet(r);
  return `<div class="cs-row cs-reo" data-id="${r.id}"><input aria-label="Property" data-rk="label" value="${esc(r.label)}" placeholder="e.g. Rental on Elm St"><select data-rk="status" aria-label="Status">${Object.entries(REO_STATUS).map(([v,l]) => `<option value="${v}" ${r.status===v?"selected":""}>${l}</option>`).join("")}</select>${S.coOn ? ownSel(r, true) : ""}<button type="button" class="cs-x" data-del="reo" aria-label="Remove">×</button>
    ${r.status === "sale" ? `<span class="cs-note" style="grid-column:1/-1">Not counted: it's sold before this loan closes.</span>` : `<div class="cs-reo2"><label class="cs-f"><span>Full payment / mo</span><span class="cs-adorn pre"><i>$</i><input aria-label="Full monthly payment" title="Mortgage + taxes + insurance + HOA" data-rk="pitia" data-money inputmode="decimal" value="${esc(commafy(r.pitia))}" placeholder="Mortgage, taxes, ins., HOA" style="padding-left:22px;width:100%"></span></label>
    ${r.status === "rental" ? `<label class="cs-f"><span>Gross rent / mo</span><span class="cs-adorn pre"><i>$</i><input aria-label="Gross monthly rent" data-rk="rent" data-money inputmode="decimal" value="${esc(commafy(r.rent))}" placeholder="0" style="padding-left:22px;width:100%"></span></label>` : `<span></span>`}
    <span class="cs-note" style="align-self:end;padding-bottom:10px;color:${net >= 0 ? "inherit" : "var(--cs-warn)"}">${n(r.pitia) || n(r.rent) ? (net >= 0 ? "+" + money(net) + " income" : money(-net) + " debt") : ""}</span></div>`}</div>`; }).join("")}</div><button type="button" class="cs-btn small cs-addrow" data-add="reo">+ Add property</button>`;
let costsOpen = false;
// Down payment as % or $: whichever the LO types drives the other
const downFields = c => `<label class="cs-f"><span>Down payment</span><span class="cs-adorn post"><input id="cs-f-downPct" data-k="downPct" inputmode="decimal" value="${esc(S.downMode==="amt" ? (c.price ? (Math.round(c.downPct*100)/100) : "") : S.downPct)}" autocomplete="off"><i>%</i></span></label>
  <label class="cs-f"><span>Down payment ($)</span><span class="cs-adorn pre"><i>$</i><input id="cs-f-downAmt" data-k="downAmt" data-money inputmode="decimal" value="${esc(commafy(S.downMode==="amt" ? S.downAmt : (c.down ? Math.round(c.down) : "")))}" autocomplete="off"></span></label>`;
// Scores by bureau (from the soft pull or the 1003 import, or typed in). Shown on the credit slide to explain the middle score.
let bureauOpen = false;
const bureauBox = () => `<details class="cs-path" id="cs-bureaubox" ${bureauOpen || (S.bureau||[]).length ? "open" : ""} style="margin-top:10px"><summary>Scores by bureau <span class="cs-note">· optional, shows how the middle score works</span></summary>
  ${(S.bureau||[]).length ? `<div class="cs-row cs-bureau-row cs-bhead" style="grid-template-columns:1fr repeat(3,70px) 64px auto"><span>Borrower</span><span>Equifax</span><span>Experian</span><span>TransUnion</span><span></span><span style="width:28px"></span></div>` : ""}
  <div class="cs-rows" data-list="bureau">${(S.bureau||[]).map(r => `<div class="cs-row cs-bureau-row" data-id="${r.id}" style="grid-template-columns:1fr repeat(3,70px) 64px auto"><input aria-label="Borrower" data-rk="label" value="${esc(r.label)}" placeholder="Borrower">${BUREAUS.map(([k,l]) => `<input aria-label="${l}" title="${l}" data-rk="${k}" inputmode="numeric" maxlength="3" value="${esc(r[k] ?? "")}" placeholder="${l.slice(0,2)}">`).join("")}<span class="cs-note cs-mid" style="align-self:center">${midOf(r) ? "Mid " + midOf(r) : ""}</span><button type="button" class="cs-x" data-del="bureau" aria-label="Remove">×</button></div>`).join("")}</div>
  <button type="button" class="cs-btn small cs-addrow" data-add="bureau">+ Add borrower</button>
  <p class="cs-note" style="margin:6px 0 0">Equifax, Experian, TransUnion. Only the scores are kept; nothing else from the credit report.</p></details>`;
// Insurance as $ per year or % of value per year: whichever the LO types drives the other
const hoiFields = c => { const pctNow = c.value && c.hoiYear ? Math.round(c.hoiYear / c.value * 10000) / 100 : "";
  const hint = c.hoiEstimated ? " · estimate" : "";
  const pctMode = S.hoiMode === "pct";
  const sw = `<span class="cs-unit" role="group" aria-label="Enter insurance as">${[["amt","$"],["pct","%"]].map(([m,l]) => `<button type="button" data-hoimode="${m}" aria-pressed="${S.hoiMode===m}">${l}</button>`).join("")}</span>`;
  const other = pctMode ? (c.hoiYear ? `${money(c.hoiYear)}/yr` : "") : (pctNow !== "" ? `${pctNow}% of value` : "");
  return `<div class="cs-f"><span class="cs-lblrow"><label for="cs-f-${pctMode ? "hoiPct" : "hoi"}">Insurance / yr</label>${sw}</span>
    ${pctMode ? `<span class="cs-adorn post"><input id="cs-f-hoiPct" data-k="hoiPct" inputmode="decimal" value="${esc(S.hoiPct)}" placeholder="${esc(c.hoiEstimated ? String(pctNow) : "")}" autocomplete="off"><i>%</i></span>`
              : `<span class="cs-adorn pre"><i>$</i><input id="cs-f-hoi" data-k="hoi" data-money inputmode="decimal" value="${esc(commafy(S.hoi))}" placeholder="${esc(c.hoiEstimated ? commafy(Math.round(c.hoiYear)) : "")}" autocomplete="off"></span>`}
    <span class="cs-note">${money(c.hoi)}/mo${other ? " · " + other : ""}${hint}</span></div>`; };
// LO-side "how to get there" note (the same ideas show on the slides)
let pathOpen = false;
const pathHint = c => { const p = pathTo(c);
  return `<details class="cs-path" id="cs-pathbox" ${pathOpen?"open":""}><summary>Other ways to structure this${p.length ? ` <span class="cs-note">· ${p.length} idea${p.length>1?"s":""}</span>` : ""}</summary>
    <p class="cs-note" style="margin:6px 0 10px">Optional. Set the target for the program you have in mind (FHA, VA and some non-QM go higher). Only you see this unless you turn on “Show on slides”, and only ticked ideas show.</p>
    <div class="cs-fields">${c.dscr ? fld("dscrTarget","Target DSCR",{ph:"e.g. 1.00"}) : fld("dtiTarget","Target DTI",{post:"%",ph:"e.g. 50"})}</div>
    ${p.length ? `<div class="cs-pathlist">${p.map(x => `<label><input type="checkbox" data-pick="${x.k}" ${S.pathPick[x.k]?"checked":""}> ${esc(x.t)}</label>`).join("")}</div>
      <label class="cs-pathshow"><input type="checkbox" id="cs-pathshow" ${S.pathShow?"checked":""}> Show ticked ideas on the slides</label>` : `<p class="cs-note">${(c.dscr ? n(S.dscrTarget) : n(S.dtiTarget)) ? "The numbers already meet that target." : "Nothing to show until a target is set."}</p>`}
  </details>`; };
// Compare options: the numbers above are option 1; each extra option changes only what's filled in
function optionsCard(c){
  const purchase = c.purchase, O = optionCalcs();
  const cell = (o, k, label, money_) => `<label class="cs-f"><span>${label}</span><span class="cs-adorn ${money_?"pre":"post"}">${money_?"<i>$</i>":""}<input data-ok="${k}" data-oid="${o.id}" ${money_?"data-money":""} inputmode="decimal" value="${esc(money_ ? commafy(o[k]) : (o[k] ?? ""))}" placeholder="${esc(money_ ? commafy(k==="price"?S.price:k==="cashOut"?S.cashOut:S.sellerCredit) : (k==="downPct" ? (S.downMode==="amt" ? "same $" : String(Math.round(c.downPct*10)/10)) : k==="rate" ? (c.rate ? String(c.rate) : "") : k==="points" ? (S.points || "0") : ""))}">${money_?"":"<i>%</i>"}</span></label>`;
  return `<section class="cs-card"><h2>Compare options</h2><p class="cs-hint">The numbers above are option 1. Add up to 2 more; blanks use option 1's numbers.</p>
    ${O.map(({o, c:k}, i) => `<div class="cs-opt" data-oid="${o.id}"><div class="cs-opthead"><input data-ok="label" data-oid="${o.id}" value="${esc(o.label || "")}" placeholder="Option ${i+2}" aria-label="Option name"><b>${money(k.pitia)}/mo · ${cashWord(k)}</b><button type="button" class="cs-x" data-odel="${o.id}" aria-label="Remove option">×</button></div>
      <div class="cs-fields">${purchase ? cell(o,"price","Price",true) + cell(o,"downPct","Down payment") + cell(o,"sellerCredit","Seller credit",true) : (S.purpose==="cashout" ? cell(o,"cashOut","Cash out",true) : "")}
        <label class="cs-f"><span>Buydown</span><select data-ok="buydown" data-oid="${o.id}">${Object.entries({"":"Same as option 1",none:"None","1-0":"1-0","2-1":"2-1","3-2-1":"3-2-1"}).map(([v,l]) => `<option value="${v}" ${(o.buydown||"")===v?"selected":""}>${l}</option>`).join("")}</select></label>
        ${S.showRate ? cell(o,"rate","Rate") + cell(o,"points","Points") : ""}
        <label class="cs-f"><span>Term</span><select data-ok="term" data-oid="${o.id}">${[["","Same"],["30","30 years"],["40","40 years"],["25","25 years"],["20","20 years"],["15","15 years"]].map(([v,l]) => `<option value="${v}" ${(o.term||"")===v?"selected":""}>${l}</option>`).join("")}</select></label></div></div>`).join("")}
    ${S.options.length < 2 ? `<button type="button" class="cs-btn small cs-addrow" id="cs-optadd">+ Add an option</button>` : ""}</section>`;
}
function inputsHtml(opts={}){
  const c = calc(), purchase = c.purchase;
  const sheetOpts = `<option value="" ${!S.sheetId?"selected":""}>No lender yet</option>` + [...SHEETS].sort((a,b) => (a.order||99) - (b.order||99)).map(s => `<option value="${esc(s.id)}" ${s.id===S.sheetId?"selected":""}>${esc(s.name)}</option>`).join("");
  return `    <div class="cs-grid">
      <div class="cs-col">
        <section class="cs-card"><h2>Your goal</h2><p class="cs-hint"></p>
          <div class="cs-segrow"><span class="cs-lbl">Loan</span>${segs("purpose", PURPOSE)}</div>
          <div class="cs-segrow"><span class="cs-lbl">Property</span>${segs("occ", {primary:"Primary", second:"Second home", investment:"Investment"})}</div>
          <div class="cs-segrow"><span class="cs-lbl">Qualify by</span>${segs("qualify", {income:"Income (DTI)", dscr:"Rent (DSCR)"})}</div>
          ${c.dscr ? "" : `<div class="cs-fields"><label class="cs-f" style="grid-column:span 2"><span>Income documents (sets their checklist)</span><select id="cs-f-docType" data-k="docType">${Object.entries(DOC_TYPES).filter(([k]) => k !== "dscr").map(([v,l]) => `<option value="${v}" ${S.docType===v?"selected":""}>${esc(l)}</option>`).join("")}</select></label></div>`}
          ${opts.hideFirst ? "" : `<div class="cs-fields">${fld("first","Borrower first name",{mode:"text"})}${fld("last","Borrower last name",{mode:"text"})}${S.coOn ? "" : `<div class="cs-f"><span>&nbsp;</span><button type="button" class="cs-btn small cs-addrow" id="cs-coadd" style="height:38px;margin:0">+ Add co-borrower</button></div>`}</div>
          ${S.coOn ? `<div class="cs-fields" style="margin-top:10px">${fld("coFirst","Co-borrower first name",{mode:"text"})}${fld("coLast","Co-borrower last name",{mode:"text"})}<div class="cs-f"><span>&nbsp;</span><button type="button" class="cs-btn small ghost" id="cs-codel" style="height:38px;margin:0">Remove co-borrower</button></div></div>` : ""}`}
          <div class="cs-fields" style="margin-top:10px">${scoredRows().length ? `<label class="cs-f"><span>Qualifying credit score</span><input id="cs-f-score" value="${esc(S.score)}" disabled><span class="cs-note">Lowest middle score, from the bureau scores below</span></label>` : fld("score","Estimated credit score",{mode:"numeric"})}</div>
          ${bureauBox()}
          <div class="cs-switches"><label><input type="checkbox" id="cs-f-preapproved" ${S.preapproved?"checked":""}> Pre-approved <span class="cs-note">(welcome slide says so, with the 90-day note)</span></label>
            <label><input type="checkbox" id="cs-f-showrate" ${S.showRate?"checked":""}> Show rate and points on the slides</label></div>
        </section>
        <section class="cs-card"><h2>Property & loan</h2><p class="cs-hint"></p>
          <div class="cs-fields">
            ${purchase ? fld("price","Purchase price",{pre:"$"}) + downFields(c) :
              fld("value","Estimated value",{pre:"$"}) + fld("payoff","Current loan payoff",{pre:"$"}) + (S.purpose==="cashout" ? fld("cashOut","Cash out wanted",{pre:"$"}) : "") + fld("curPay","Current house payment",{pre:"$", note:"Mortgage, taxes, insurance, HOA. For “current vs new”."})}
            <div class="cs-f"><label for="cs-f-rate">Rate (not shown to them)</label><span class="cs-adorn post"><input id="cs-f-rate" data-k="rate" type="text" inputmode="decimal" value="${esc(S.rate)}" placeholder="${esc(c.ratePlanned ? String(c.rate) : "")}" autocomplete="off"><i>%</i></span>
              <span class="cs-note"><label class="cs-chk"><input type="checkbox" id="cs-f-norate" ${S.noRateYet?"checked":""}> No rate yet</label>${c.ratePlanned ? "Planning rate" : c.noRate ? "Payment shows principal only" : ""}</span></div>
            ${fld("points","Points",{post:"%",ph:"0",note: c.pointsAmt ? money(c.pointsAmt) : ""})}
            <label class="cs-f"><span>Term</span><select id="cs-f-term" data-k="term">${["30","40","25","20","15"].map(t => `<option ${S.term===t?"selected":""} value="${t}">${t} years</option>`).join("")}</select></label>
            <label class="cs-f"><span>Temporary buydown</span><select id="cs-f-buydown" data-k="buydown">${Object.entries({none:"None","1-0":"1-0","2-1":"2-1","3-2-1":"3-2-1"}).map(([v,l]) => `<option value="${v}" ${S.buydown===v?"selected":""}>${l}</option>`).join("")}</select>${c.buydownCost ? `<span class="cs-note">Costs ${money(c.buydownCost)} · yr 1 ${money(c.buydownYears[0].pitia)}/mo</span>` : ""}</label>
          </div>
          <div class="cs-tot"><span>Loan amount${c.ufmip?" (incl. FHA upfront MI)":""} · LTV ${pct(c.ltv,1)}</span><b>${money(c.total)}</b></div>
          <label class="cs-chk" style="margin-top:10px"><input type="checkbox" id="cs-f-showprog" ${S.showProg?"checked":""}> Show program & key dates <span class="cs-note">(optional, only what you fill in)</span></label>
          ${S.showProg ? `<div class="cs-fields" style="margin-top:8px">
            <label class="cs-f"><span>Program</span><input id="cs-f-progName" data-k="progName" list="cs-progs" value="${esc(S.progName)}" placeholder="e.g. 30-year fixed" autocomplete="off"><datalist id="cs-progs">${["30-year fixed","15-year fixed","20-year fixed","5/6 ARM","7/6 ARM","30-year fixed, interest-only first 10 years"].map(x => `<option value="${x}">`).join("")}</datalist></label>
            <label class="cs-f"><span>Rate lock</span><select id="cs-f-lockStatus" data-k="lockStatus">${[["","Not locked yet"],["locked","Locked"]].map(([v,l]) => `<option value="${v}" ${S.lockStatus===v?"selected":""}>${l}</option>`).join("")}</select></label>
            ${S.lockStatus === "locked" ? fld("lockDate","Lock expires",{type:"date",mode:"text"}) : ""}
            ${purchase ? fld("contDate","Contingency removal",{type:"date",mode:"text"}) : ""}
            ${fld("closeDate","Target closing",{type:"date",mode:"text"})}</div>` : ""}
        </section>
        ${purchase && !c.dscr ? exploreCard(c) : ""}
        ${optionsCard(c)}
        <section class="cs-card"><h2>Housing costs</h2><p class="cs-hint"></p>
          <div class="cs-fields">
            ${fld("taxRate","Property tax rate",{post:"%",note:`${money(c.tax)}/mo`})}
            ${hoiFields(c)}
            ${fld("hoa","HOA / mo",{pre:"$"})}
            <label class="cs-f"><span>Mortgage insurance</span><select id="cs-f-miType" data-k="miType">${Object.entries({auto:"Auto",none:"None",pmi:"PMI",fha:"FHA"}).map(([v,l]) => `<option value="${v}" ${S.miType===v?"selected":""}>${l}</option>`).join("")}</select><span class="cs-note">${c.miType==="none" ? "None on this loan" : c.miType==="fha" ? "1.75% upfront, 0.55%/yr" : "PMI"}</span></label>
            ${c.miType==="pmi" ? fld("miRate","PMI rate / yr",{post:"%",note:`${money(c.mi)}/mo`}) : ""}
          </div>
          <div class="cs-tot"><span>Total monthly payment</span><b>${money(c.pitia)}</b></div>
        </section>
      </div>
      <div class="cs-col">
        ${c.dscr ? `<section class="cs-card"><h2>Rent</h2><p class="cs-hint">We qualify on the property's rent compared to the full monthly payment.</p>
          <div class="cs-fields">${fld("rent","Monthly rent (lease or market)",{pre:"$"})}</div>
          <div class="cs-tot"><span>DSCR</span><b><span class="cs-chip ${dscrToneLO(c.dscrRatio)}">${isFinite(c.dscrRatio)?c.dscrRatio.toFixed(2):"—"}</span></b></div></section>` :
        `<section class="cs-card"><h2>Monthly income</h2><p class="cs-hint">Gross monthly, before taxes.${S.coOn ? " Pick whose each line is." : ""}${S.incomes.length > 1 ? ` "How it's figured" is optional and shows on the income slide.` : ""}</p>${incRows()}${seBox()}
          <div class="cs-tot"><span>Total income${c.reoIncome ? " (with net rental)" : ""}</span><b>${money(c.income)}</b></div></section>
        <section class="cs-card"><h2>Monthly debts</h2><p class="cs-hint">Minimum monthly payments: car, cards, student loans, other mortgages.${S.purpose==="cashout" ? " Tick “Pay off” for debts paid from the cash out." : ""}</p>${debtRows()}
          ${c.payoffBal ? `<div class="cs-note" style="margin-top:8px">Paying off ${money(c.payoffBal)} at closing removes ${money(c.payoffFreed)}/mo in payments.</div>` : ""}
          <div class="cs-tot"><span>Total debts · DTI</span><b>${money(c.debts)} · <span class="cs-chip ${dtiToneLO(c.dti)}">${pct(c.dti)}</span></b></div></section>`}

        ${c.dscr ? "" : `<section class="cs-card"><h2>Real estate owned</h2><p class="cs-hint">Other properties the borrower${S.coOn ? "s own" : " owns"}. Put each one's full monthly payment (mortgage, taxes, insurance, HOA) here, not under debts. Rent counts at ${n(S.reoFactor) || 75}%.</p>${reoRows()}
          ${(S.reo||[]).length ? `<div class="cs-tot"><span>Net from these properties</span><b>${c.reoIncome ? "+" + money(c.reoIncome) + " income" : ""}${c.reoIncome && c.reoDebt ? " · " : ""}${c.reoDebt ? money(c.reoDebt) + " debt" : ""}${!c.reoIncome && !c.reoDebt ? "—" : ""}</b></div>` : ""}</section>`}
        <section class="cs-card"><h2>Assets</h2><p class="cs-hint">Money available for closing and reserves.</p>${rows("assets","asset","e.g. Checking")}
          <div class="cs-fields" style="margin-top:12px">${purchase ? fld("emd","Earnest money deposit",{pre:"$"}) + fld("sellerCredit","Seller credit",{pre:"$"}) : ""}${fld("lenderCredit","Lender credit",{pre:"$"})}</div>
          ${purchase && c.sellerCr && c.price && c.sellerCr > c.price * ipcLimit(c) / 100 ? `<div class="cs-note" style="color:var(--cs-warn);margin-top:8px">Seller credit is ${pct(c.sellerCr / c.price, 1)} of the price. Fannie Mae's usual limit here is ${ipcLimit(c)}%. Check the program's limit.</div>` : ""}
          <div class="cs-tot"><span>Total assets · reserves after closing</span><b>${money(c.assets)} · ${isFinite(c.reserves)?Math.max(0,c.reserves).toFixed(1)+" mo":"—"}</b></div></section>
        ${pathHint(c)}
      </div>
    </div>
    ${opts.collapseCosts ? `<details class="cs-card" style="margin-top:16px" ${costsOpen?"open":""} id="cs-costs"><summary><div><h2>Closing costs</h2><p class="cs-hint">${esc(c.sheet.name)} fees, title, prepaids</p></div><b>${money(c.closing + c.prepaidTotal)}</b></summary>` : `<section class="cs-card" style="margin-top:16px"><h2>Closing costs</h2><p class="cs-hint">Estimated costs to close your loan.</p>`}
      <div class="cs-segrow"><label class="cs-f" style="min-width:240px"><span>Lender</span><select id="cs-f-sheet">${sheetOpts}</select>${H.opts.onManageSheets ? `<button type="button" class="cs-linkbtn" id="cs-managesheets">Add or edit lender fees</button>` : ""}</label>
        <label class="cs-f" style="width:110px"><span>Borrowers</span><select id="cs-f-borrowers" data-k="borrowers">${["1","2","3","4"].map(b => `<option ${S.borrowers===b?"selected":""}>${b}</option>`).join("")}</select></label>
</div>
      <div class="cs-fees">
        <div><h3>Lender</h3>${c.lenderFees.map((f,i) => `<div class="cs-feeline"><label for="cs-fe-${i}">${esc(f.label)}${f.rollup ? ` <span class="cs-note" title="Shown to the borrower inside one Lender fees line">· in Lender fees</span>` : ""}</label><input id="cs-fe-${i}" data-fee="${i}" data-money inputmode="decimal" value="${esc(commafy(S.feeEdits[i] ?? c.sheet.fees[i].amount))}"></div>`).join("")}
          ${c.pointsAmt ? `<div class="cs-feeline"><label>Points (${n(S.points)}%)</label><div class="cs-calc">${money(c.pointsAmt)}</div></div>` : ""}
          ${c.buydownCost ? `<div class="cs-feeline"><label>Temporary buydown (${esc(S.buydown)})</label><div class="cs-calc">${money(c.buydownCost)}</div></div>` : ""}
          <div class="cs-tot"><span>Lender</span><b>${money(c.lenderTotal + c.pointsAmt + c.buydownCost)}</b></div></div>
        <div><h3>Third party</h3>
          <div class="cs-feeline"><label for="cs-f-appraisal">Appraisal</label><input id="cs-f-appraisal" data-k="appraisal" data-money inputmode="decimal" value="${esc(commafy(S.appraisal ?? c.sheet.appraisal ?? ""))}"></div>
          <div class="cs-feeline"><label for="cs-f-credit">Credit report (per borrower)</label><input id="cs-f-credit" data-k="credit" data-money inputmode="decimal" value="${esc(commafy(S.credit ?? c.sheet.credit ?? ""))}"></div>
          <div class="cs-feeline"><label for="cs-f-title">Title & escrow (estimate)</label><input id="cs-f-title" data-k="title" data-money inputmode="decimal" value="${esc(commafy(S.title))}" placeholder="0"></div>
          <div class="cs-feeline"><label for="cs-f-other">Recording & other</label><input id="cs-f-other" data-k="other" data-money inputmode="decimal" value="${esc(commafy(S.other))}" placeholder="0"></div>
          <div class="cs-tot"><span>Third party</span><b>${money(c.thirdTotal)}</b></div></div>
        <div><h3>Prepaids & reserves</h3>
          <div class="cs-feeline"><label for="cs-f-interestDays">Days of prepaid interest</label><input id="cs-f-interestDays" data-k="interestDays" inputmode="numeric" value="${esc(S.interestDays)}"></div>
          <div class="cs-feeline"><label for="cs-f-impounds">Escrow taxes & insurance</label><select id="cs-f-impounds" style="border:1px solid var(--cs-line);background:var(--cs-field);border-radius:8px;padding:6px 8px"><option value="1" ${S.impounds?"selected":""}>Yes</option><option value="0" ${!S.impounds?"selected":""}>No</option></select></div>
          ${c.prepaids.map(p => `<div class="cs-feeline"><label>${esc(p.label)}</label><div class="cs-calc">${money(p.amount)}</div></div>`).join("")}
          <div class="cs-tot"><span>Prepaids</span><b>${money(c.prepaidTotal)}</b></div></div>
      </div>
    ${opts.collapseCosts ? "</details>" : "</section>"}`;
}
// Renders the numbers into root and keeps them live. onChange(calc) fires after every redraw.
function mountInputs(root, opts={}){
  let t = null;
  const render = () => { sync(); root.innerHTML = inputsHtml(opts); wire(); if(opts.onChange) opts.onChange(calc()); };
  const rerender = () => {
    const a = document.activeElement, inside = a && root.contains(a);
    const id = inside && a.id, sel = inside ? a.selectionStart : null, rowEl = inside && a.closest && a.closest(".cs-row"), rowId = rowEl && rowEl.dataset.id, rk = inside && a.dataset && a.dataset.rk, ok = inside && a.dataset && a.dataset.ok, oid = inside && a.dataset && a.dataset.oid;
    render();
    let el = id ? root.querySelector("#"+CSS.escape(id)) : null;
    if(!el && rowId) el = root.querySelector(`.cs-row[data-id="${rowId}"] [data-rk="${rk}"]`);
    if(!el && ok && oid) el = root.querySelector(`[data-oid="${oid}"][data-ok="${ok}"]`);
    if(el){ el.focus({preventScroll:true}); try{ if(sel!=null) el.setSelectionRange(sel, sel); }catch(e){} }
  };
  const soon = () => { clearTimeout(t); t = setTimeout(rerender, 350); };
  function wire(){
    const app = root;
    const renderInputs = render;
  app.querySelectorAll("[data-k]").forEach(el => {
    const ev = el.tagName==="SELECT" ? "change" : "input";
    el.addEventListener(ev, () => { if(el.hasAttribute("data-money") && ev==="input") liveCommas(el); S[el.dataset.k] = el.value; if(el.dataset.k==="downPct") S.downMode = "pct"; if(el.dataset.k==="downAmt") S.downMode = "amt"; if(el.dataset.k==="hoiPct") S.hoiMode = "pct"; if(el.dataset.k==="hoi") S.hoiMode = "amt"; ev==="change" ? rerender() : soon(); });
  });
  app.querySelectorAll("[data-seg]").forEach(b => b.addEventListener("click", () => { S[b.dataset.seg] = b.dataset.v; rerender(); }));
  app.querySelectorAll("[data-fee]").forEach(el => el.addEventListener("input", () => { liveCommas(el); S.feeEdits[el.dataset.fee] = el.value; soon(); }));
  app.querySelectorAll(".cs-rows").forEach(box => {
    const list = {inc:"incomes", debt:"debts", asset:"assets", bureau:"bureau", reo:"reo", ex:"exTries"}[box.dataset.list];
    box.querySelectorAll(".cs-row").forEach(r => r.querySelectorAll("[data-rk]").forEach(inp => inp.addEventListener(inp.type==="checkbox" ? "change" : "input", () => {
      const it = S[list].find(x => x.id===r.dataset.id); if(!it) return;
      if(inp.type==="checkbox"){ it[inp.dataset.rk] = inp.checked; rerender(); return; }
      if(inp.hasAttribute("data-money")) liveCommas(inp);
      it[inp.dataset.rk] = inp.value;
      if(inp.dataset.rk === "status" || inp.dataset.rk === "kind"){ rerender(); return; }
      if(["amt","bal","eq","ex","tu","pitia","rent","who","v"].includes(inp.dataset.rk)) soon();
    })));
  });
  const pb = app.querySelector("#cs-pathbox"); if(pb) pb.addEventListener("toggle", () => { pathOpen = pb.open; });
  app.querySelectorAll("[data-pick]").forEach(el => el.addEventListener("change", () => { S.pathPick[el.dataset.pick] = el.checked; rerender(); }));
  const ps = app.querySelector("#cs-pathshow"); if(ps) ps.addEventListener("change", () => { S.pathShow = ps.checked; rerender(); });
  const oa = app.querySelector("#cs-optadd"); if(oa) oa.addEventListener("click", () => { if(S.options.length >= 2) return; S.options.push({id:uid(), label:"", price:"", downPct:"", downMode:"", sellerCredit:"", buydown:"", term:"", cashOut:"", rate:"", points:""}); rerender(); });
  app.querySelectorAll("[data-odel]").forEach(b => b.addEventListener("click", () => { S.options = S.options.filter(o => o.id !== b.dataset.odel); rerender(); }));
  app.querySelectorAll("[data-ok]").forEach(el => { const sel = el.tagName === "SELECT"; el.addEventListener(sel ? "change" : "input", () => {
    const o = S.options.find(x => x.id === el.dataset.oid); if(!o) return;
    if(el.hasAttribute("data-money")) liveCommas(el);
    o[el.dataset.ok] = el.value; if(el.dataset.ok === "downPct") o.downMode = el.value ? "pct" : "";
    if(el.dataset.ok === "label") return; sel ? rerender() : soon(); }); });
  app.querySelectorAll("[data-add]").forEach(b => b.addEventListener("click", () => { const id = uid(); S[b.dataset.add].push(b.dataset.add === "bureau" ? {id, label:"", eq:"", ex:"", tu:""} : b.dataset.add === "reo" ? {id, label:"", status:"rental", pitia:"", rent:""} : b.dataset.add === "exTries" ? {id, kind:"price", v:""} : {id, label:"", amt:""}); renderInputs(); const el = document.querySelector(`.cs-row[data-id="${id}"] [data-rk="label"]`); if(el) el.focus(); }));
  app.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => { const list = b.dataset.del, id = b.closest(".cs-row").dataset.id; S[list] = S[list].filter(x => x.id!==id); if(!S[list].length && !["bureau","reo","exTries"].includes(list)) S[list].push({id:uid(),label:"",amt:""}); rerender(); }));
  const bb = app.querySelector("#cs-bureaubox"); if(bb) bb.addEventListener("toggle", () => { bureauOpen = bb.open; });
  app.querySelectorAll('[data-del="bureau"]').forEach(b => b.addEventListener("click", () => { bureauOpen = true; }, true));
  root.querySelectorAll("[data-hoimode]").forEach(b => b.addEventListener("click", () => {
    const m = b.dataset.hoimode; if(m === S.hoiMode) return; const c = calc();
    const typed = S.hoiMode === "pct" ? String(S.hoiPct ?? "").trim() !== "" : String(S.hoi ?? "").trim() !== "";
    if(m === "pct"){ S.hoiPct = typed && c.value ? String(Math.round(c.hoiYear / c.value * 10000) / 100) : ""; }
    else { S.hoi = typed ? String(Math.round(c.hoiYear)) : ""; }
    S.hoiMode = m; rerender(); const f = root.querySelector(m === "pct" ? "#cs-f-hoiPct" : "#cs-f-hoi"); if(f) f.focus(); }));
  [["#cs-f-showprog","showProg"],["#cs-f-exon","exOn"]].forEach(([sel, k]) => { const el = root.querySelector(sel); if(el) el.addEventListener("change", () => { S[k] = el.checked; rerender(); }); });
  [["#cs-exbox", v => exOpen = v], ["#cs-sebox", v => seOpen = v]].forEach(([sel, set]) => { const d = root.querySelector(sel); if(d) d.addEventListener("toggle", () => set(d.open)); });
  root.querySelectorAll("[data-se]").forEach(el => el.addEventListener(el.tagName === "SELECT" ? "change" : "input", () => {
    if(el.hasAttribute("data-money")) liveCommas(el); S.se[el.dataset.se] = el.value;
    const o = root.querySelector("#cs-se-out"), u = root.querySelector("#cs-se-use"); const v = seMonthly(); if(o) o.textContent = v ? money(v) + "/mo" : "Enter the deposits"; if(u) u.disabled = !v; }));
  const su = root.querySelector("#cs-se-use"); if(su) su.addEventListener("click", () => { const v = seMonthly(); if(!v) return; const m = n(S.se.months) || 24;
    const row = {id:"se-inc", label:`${S.docType === "bank_statement" ? "Bank statement" : "Self-employed"} income (${m} months)`, amt:String(Math.round(v)), who:"b",
      note:`${money(n(S.se.deposits))} deposits ÷ ${m} × ${100 - seExp()}%${seOwn() !== 100 ? " × " + seOwn() + "% owned" : ""}`};
    const at = S.incomes.findIndex(x => x.id === "se-inc"); if(at >= 0) S.incomes[at] = Object.assign({}, S.incomes[at], row, {who: S.incomes[at].who || "b"});
    else { const blankAt = S.incomes.findIndex(x => !n(x.amt)); if(blankAt >= 0) S.incomes[blankAt] = row; else S.incomes.push(row); }
    rerender(); });
  const ca = root.querySelector("#cs-coadd"); if(ca) ca.addEventListener("click", () => { S.coOn = true; rerender(); const f = root.querySelector("#cs-f-coFirst"); if(f) f.focus(); });
  const cdel = root.querySelector("#cs-codel"); if(cdel) cdel.addEventListener("click", () => { S.coOn = false; S.coFirst = ""; S.coLast = ""; rerender(); });
  const nr = root.querySelector("#cs-f-norate"); if(nr) nr.addEventListener("change", () => { S.noRateYet = nr.checked; rerender(); });
  [["#cs-f-preapproved","preapproved"],["#cs-f-showrate","showRate"]].forEach(([sel, k]) => { const el = root.querySelector(sel); if(el) el.addEventListener("change", () => { S[k] = el.checked; rerender(); }); });
  const ms = root.querySelector("#cs-managesheets"); if(ms) ms.addEventListener("click", () => H.opts.onManageSheets());
  $("#cs-f-sheet", root).addEventListener("change", e => { S.sheetId = e.target.value; S.feeEdits = {}; S.appraisal = null; S.credit = null; rerender(); });
  $("#cs-f-impounds", root).addEventListener("change", e => { S.impounds = e.target.value==="1"; rerender(); });
    const cd = root.querySelector("#cs-costs"); if(cd) cd.addEventListener("toggle", () => { costsOpen = cd.open; });
  }
  render();
  return {refresh: rerender, render};
}

// ---------- presentation ----------
// 1.5 order (modeled on the pre-approval review deck): welcome → things to keep in mind → review (credit, liabilities, income, assets)
// → payment and options → DTI → costs → cash → next steps → summary → thank you. Slides without data are skipped.
function slidesFor(c){
  const list = [], who = whoNames();
  if(who || S.appIn || S.preapproved) list.push(["welcome","Welcome"]);
  if(S.appIn || S.preapproved) list.push(["keep","Keep in mind"]);
  if(S.appIn) list.push(["review","Let's review"]);
  if(n(S.score)) list.push(["credit","Credit"]);
  if(!c.dscr && (S.debts.some(x => n(x.amt)) || c.reoDebt)) list.push(["liab","Liabilities"]);
  if(!c.dscr && reoLive().length) list.push(["reo","Real estate owned"]);
  if(!c.dscr && c.income) list.push(["income","Income"]);
  if(c.assets) list.push(["assets","Assets"]);
  if(c.purchase && !c.dscr && S.exOn && c.income) list.push(["explore","What you can afford"]);
  list.push(["payment","Monthly payment"]);
  if(!c.purchase && c.curToday) list.push(["refi","Current vs new"]);
  if(S.options.length) list.push(["compare","Your options"]);
  list.push(c.dscr ? ["dscr","Rent coverage"] : ["dti","Debt-to-income"]);
  list.push(["costs","Closing costs"]);
  list.push(["cash", c.purchase ? "Cash to close" : "Your refinance"]);
  list.push(["next","Next steps"]);
  list.push(["summary","Summary"]);
  if(ME.name) list.push(["thanks","Thank you"]);
  return list;
}
// "Oliver and Kristina"
const whoNames = () => [S.first, S.coOn ? S.coFirst : ""].map(x => String(x || "").trim()).filter(Boolean).join(" and ");
let ME = {};   // the preparer (name, phone, email) for the thank-you slide; set by mountPresent(opts.me)
// Renders the slides into root. Arrow keys move, Escape exits.
function mountPresent(root, opts={}){
  let slide = opts.start || 0; ME = opts.me || {};
  const exitLabel = opts.exitLabel || "Edit numbers";
  function draw(){
    sync();
    const c = calc(), list = slidesFor(c); slide = Math.max(0, Math.min(slide, list.length-1));
    const [key] = list[slide], who = whoNames();
    root.innerHTML = `<div class="cs-stage">
    <div class="cs-bar"><div class="cs-dots" role="tablist">${list.map(([k,l],i) => `<button role="tab" data-go="${i}" aria-current="${i===slide}">${esc(l)}</button>`).join("")}</div>
      <div class="cs-navbtns"><button class="cs-btn" id="cs-p-prev" ${slide===0?"disabled":""}>← Back</button>${key === "summary" || slide === list.length-1 ? `<button class="cs-btn accent" id="cs-p-pdf">Download a copy</button>` : ""}${slide<list.length-1 ? `<button class="cs-btn primary" id="cs-p-next">Next →</button>` : ""}${document.fullscreenEnabled ? `<button class="cs-btn ghost" id="cs-p-full" title="Full screen">${document.fullscreenElement ? "Exit full screen" : "Full screen"}</button>` : ""}<button class="cs-btn ghost" id="cs-p-edit">${esc(exitLabel)}</button></div></div>
    <section class="cs-slide" aria-live="polite">${SLIDES[key](c, who)}</section></div>`;
    if(WIRE[key]) WIRE[key](root, c, draw);
    root.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => { slide = +b.dataset.go; draw(); }));
    // "Lender fees" opens its breakdown when clicked; no visible control
    root.querySelectorAll("[data-roll]").forEach(r => r.addEventListener("click", () => { const t = r.closest("table"); t.classList.toggle("cs-rollopen"); }));
    const pv = $("#cs-p-prev", root); if(pv) pv.addEventListener("click", () => { slide--; draw(); });
    const nx = $("#cs-p-next", root); if(nx) nx.addEventListener("click", () => { slide++; draw(); });
    const pd = $("#cs-p-pdf", root); if(pd) pd.addEventListener("click", () => opts.onPdf && opts.onPdf());
    $("#cs-p-edit", root).addEventListener("click", exit);
    // Full screen only when the LO asks for it (Esc or the button leaves it)
    const fs = $("#cs-p-full", root); if(fs) fs.addEventListener("click", () => { const p = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); if(p && p.catch) p.catch(() => {}); });
  }
  const onFs = () => { if(!root.isConnected){ document.removeEventListener("fullscreenchange", onFs); return; } const b = $("#cs-p-full", root); if(b) b.textContent = document.fullscreenElement ? "Exit full screen" : "Full screen"; };
  document.addEventListener("fullscreenchange", onFs);
  const key = e => {
    if(!root.isConnected){ document.removeEventListener("keydown", key); return; }
    if((opts.paused && opts.paused()) || /INPUT|SELECT|TEXTAREA/.test((e.target||{}).tagName||"")) return;
    sync(); const total = slidesFor(calc()).length;
    if(e.key==="ArrowRight" && slide<total-1){ slide++; draw(); }
    if(e.key==="ArrowLeft" && slide>0){ slide--; draw(); }
    if(e.key==="Escape") exit();
  };
  function exit(){ document.removeEventListener("keydown", key); document.removeEventListener("fullscreenchange", onFs); if(document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {}); if(opts.onExit) opts.onExit(); }
  document.addEventListener("keydown", key);
  draw();
  return {redraw: draw, exit, get slide(){ return slide; }};
}
const ticks = (vals, lo, hi, fmt=v=>v) => `<div class="cs-ticks">${vals.map(v => `<span style="left:${(v-lo)/(hi-lo)*100}%">${fmt(v)}</span>`).join("")}</div>`;
// The middle-score explainer on the credit slide (only when bureau scores are entered)
const bureauPane = () => { const rows = scoredRows(); if(!rows.length) return "";
  const q = qualScore(), many = rows.length > 1;
  // one column per borrower: three bureau tiles, the middle score ringed (the deck's "credit analysis" slide)
  const tile = (r, k, l) => { const v = n(r[k]); const mid = v && v === midOf(r) && BUREAUS.findIndex(([kk]) => n(r[kk]) === v) === BUREAUS.findIndex(([kk]) => kk === k);
    return `<div class="cs-btile${mid ? " mid" : ""}"><b>${v || "—"}</b><span>${l}</span></div>`; };
  return `<div class="cs-pane" style="margin-top:14px"><div class="cs-bgrid">${rows.map(r => `<div><h3>${esc(r.label || "Borrower")}${many && midOf(r) === q ? ` <span class="cs-note">· score used</span>` : ""}</h3>${BUREAUS.map(([k,l]) => tile(r, k, l)).join("")}<div class="cs-note" style="margin-top:6px">Middle score: <b>${midOf(r)}</b></div></div>`).join("")}</div>
    <p class="cs-fine" style="margin-top:10px">Lenders use the <b>middle</b> of your three scores${many ? `, and with more than one borrower, the <b>lower</b> of the middle scores. That makes ${q} the score your loan is priced and qualified on.` : `, so ${q} is the score your loan is priced and qualified on.`}</p></div>`; };
const tierLabels = ["Below 620","620–679","680–719","720–759","760+"];
// Program & key dates (only when "Show program & key dates" is on, and only what's filled in)
const fmtDate = d => { if(!d) return ""; const t = new Date(d + "T12:00:00"); return isNaN(t) ? String(d) : t.toLocaleDateString("en-US", {month:"short", day:"numeric", year:"numeric"}); };
const progDates = () => !S.showProg ? [] : [
  S.progName && ["Program", S.progName],
  S.lockStatus === "locked" && ["Rate lock", S.lockDate ? "Locked through " + fmtDate(S.lockDate) : "Locked"],
  S.purpose === "purchase" && S.contDate && ["Contingency removal", fmtDate(S.contDate)],
  S.closeDate && ["Target closing", fmtDate(S.closeDate)]].filter(Boolean);
// Interactive bits on some slides (wired after each draw)
const WIRE = {
  explore(root, c){
    const live = $("#cs-ex-live", root), pi = $("#cs-ex-price", root), py = $("#cs-ex-pay", root); if(!live) return;
    const show = (lbl, r) => { if(!r){ live.style.display = "none"; return; } live.style.display = ""; live.className = "cs-exlive";
      live.innerHTML = r.none ? `<td>${esc(lbl)}</td><td colspan="5" style="color:var(--cs-muted)">Not reachable with these numbers</td>` : `<td>${esc(lbl)}</td><td>${money(r.price)}</td><td>${money(r.down)}</td><td>${money(r.loan)}</td><td><b>${money(r.pitia)}</b></td><td${r.dti > exDti()/100 + 1e-9 ? ' style="color:var(--cs-warn)" title="Above the usual limit for this kind of loan"' : ""}>${pct(r.dti)}${r.dti > exDti()/100 + 1e-9 ? " *" : ""}</td>`; };
    pi.addEventListener("input", () => { liveCommas(pi); py.value = ""; const v = n(pi.value); show(`At ${money(v)}`, v >= 10000 ? exRow(v, c) : null); });
    py.addEventListener("input", () => { liveCommas(py); pi.value = ""; const v = n(py.value); if(!v){ show("", null); return; } const p = exPriceForPay(v, c); show(`For ${money(v)}/mo`, p ? exRow(p, c) : {none:true}); });
  },
  next(root, c, redraw){
    root.querySelectorAll("[data-doc]").forEach(li => li.addEventListener("click", () => { const d = li.dataset.doc; if(S.docsIn[d]) delete S.docsIn[d]; else S.docsIn[d] = true; redraw(); }));
  }
};
const QUOTE_DATE = () => new Date().toLocaleDateString("en-US", {month:"long", day:"numeric", year:"numeric"});
// Only a rate the LO typed is ever shown (the planning rate from Settings is never shown to the borrower)
const shownRate = k => S.showRate && k.rate && !k.ratePlanned;
const rateLine = k => shownRate(k) ? `${Math.round(k.rate*1000)/1000}%${n(k.pointsPct ?? S.points) ? ` · ${n(k.pointsPct ?? S.points)} pts` : ""}` : "";
const numbered = items => `<div class="cs-numlist">${items.map((t,i) => `<div class="cs-num"><b>${String(i+1).padStart(2,"0")}</b><span>${esc(t)}</span></div>`).join("")}</div>`;
const SLIDES = {
  welcome(c, who){
    const shop = c.purchase ? " While you shop for a home, you can show your letter to sellers and agents as proof that you're a serious buyer." : "";
    const body = S.preapproved
      ? `Congratulations! Based on the information you've provided, you're pre-approved for a loan, subject to the conditions we'll go over together. We'll send your pre-approval letter shortly.${shop}`
      : S.appIn ? "Thanks for sending your application. Based on the information and documents you've provided, here's a full look at your loan: your credit, income and assets, the payment, closing costs and what happens next."
      : "Here's a look at your loan: the payment, closing costs, cash to close and what happens next.";
    return `<div class="cs-hello"><h2 class="cs-hi">Hi ${esc(who || "there")}!</h2>
      <p class="cs-lede">${esc(body)}</p>
      <p class="cs-lede">Thank you for letting us be your partner on this. Let us know if you need help in any way.</p></div>`;
  },
  keep(c){
    const items = [
      S.showRate ? "Until your loan is locked on a property, the interest rate and loan terms shown here can change." : "Until your loan is locked on a property, the payment and loan terms shown here can change.",
      "This isn't an offer or commitment to lend. Final approval is subject to underwriting.",
      ...(S.preapproved && c.purchase ? ["If you haven't found a home within 90 days of your pre-approval letter, just ask us for an updated review."] : [])];
    return `<p class="cs-eyebrow">Before we start</p><h2>Things to keep in mind</h2>
      <p class="cs-lede">We're all about being upfront. Here are a few things to know about the numbers in this review.</p>${numbered(items)}`;
  },
  review(c){
    const parts = [n(S.score) && "Credit", !c.dscr && (S.debts.some(x => n(x.amt)) || c.reoDebt) && "Liabilities", !c.dscr && reoLive().length && "Real estate owned", !c.dscr && c.income && "Income", c.assets && "Assets"].filter(Boolean);
    return `<p class="cs-eyebrow">Let's review</p><h2>Here's what we've gathered so far</h2>
      <p class="cs-lede">Based on the information and documents you've provided.</p>${numbered(parts)}`;
  },
  liab(c){
    const list = S.debts.filter(x => n(x.amt));
    const mark = x => c.paidOff.includes(x) ? " (paid off at closing)" : x.excl ? " *" : "";
    const anyExcl = list.some(x => x.excl && !c.paidOff.includes(x)), anyPaid = list.some(x => c.paidOff.includes(x));
    const reported = list.reduce((a,x) => a + n(x.amt), 0);
    const oc = S.coOn, own = x => oc ? `<td style="color:var(--cs-muted)">${esc(ownerName(x.who || "j"))}</td>` : "", blankTd = oc ? "<td></td>" : "";
    return `<p class="cs-eyebrow">Credit</p><h2>Liabilities</h2>
      <p class="cs-lede">The monthly payments on your credit report, and the ones we count.</p>
      <div class="cs-pane"><table class="cs-ltab"><tr class="cs-sub"><td>Account reported</td>${oc ? "<td>Whose</td>" : ""}<td>Monthly payment</td></tr>
        ${list.map(x => `<tr${c.paidOff.includes(x) || x.excl ? ' style="color:var(--cs-muted)"' : ""}><td>${esc(x.label || "Debt")}${esc(mark(x))}</td>${own(x)}<td>${money(n(x.amt))}</td></tr>`).join("")}
        ${c.reoDebt ? `<tr><td>Real estate owned (net, see next slide)</td>${blankTd}<td>${money(c.reoDebt)}</td></tr>` : ""}
        <tr class="cs-sum"><td>Total monthly payments</td>${blankTd}<td>${money(reported + c.reoDebt)}</td></tr>
        ${anyPaid ? `<tr><td>Paid off at closing</td>${blankTd}<td>−${money(c.payoffFreed)}</td></tr>` : ""}
        ${anyExcl || anyPaid ? `<tr class="cs-sum"><td>Counted in your debt-to-income</td>${blankTd}<td>${money(c.debts)}</td></tr>` : ""}</table>
        ${anyExcl ? `<p class="cs-fine">* Not counted in your debt-to-income (for example, a charge card paid in full each month).</p>` : ""}</div>`;
  },
  explore(c){
    const mx = exMaxPrice(c), mr = mx ? exRow(mx, c) : null, cur = c.price ? exRow(c.price, c) : null;
    const rows = [...(cur ? [Object.assign(cur, {lbl:"Your plan"})] : []), ...S.exTries.map(t => exTryRow(t, c)).filter(Boolean).map(r => Object.assign(r, {lbl: r.t.kind === "pay" ? `For ${money(n(r.t.v))}/mo` : `At ${money(n(r.t.v))}`}))];
    const over = r => !r.none && r.dti > exDti()/100 + 1e-9;
    const tr = r => r.none ? `<tr><td>${esc(r.lbl)}</td><td colspan="5" style="color:var(--cs-muted)">Not reachable with these numbers</td></tr>` : `<tr><td>${esc(r.lbl)}</td><td>${money(r.price)}</td><td>${money(r.down)}</td><td>${money(r.loan)}</td><td><b>${money(r.pitia)}</b></td><td${over(r) ? ' style="color:var(--cs-warn)"' : ""}>${pct(r.dti)}${over(r) ? " *" : ""}</td></tr>`;
    return `<p class="cs-eyebrow">What you can afford</p><h2>${mx ? `Up to about ${money(mx)}` : "Let's find your price range"}</h2>
      <p class="cs-lede">${mr ? `With ${Math.round(exDown(c)*10)/10}% down, that's a payment of about ${money(mr.pitia)} a month. Everything else stays as we've planned it.` : "Your current debts use most of the room. Let's look at options together."}</p>
      <div class="cs-pane"><table class="cs-ltab cs-cmp" id="cs-ex-table"><tr class="cs-sub"><td></td><td>Price</td><td>Down</td><td>Loan</td><td>Payment</td><td>DTI</td></tr>
        ${rows.map(tr).join("")}<tr id="cs-ex-live" style="display:none"></tr></table>
        <div class="cs-extry"><label>Try a price <span class="cs-adorn pre"><i>$</i><input id="cs-ex-price" data-money inputmode="decimal" placeholder="e.g. 1,300,000" autocomplete="off"></span></label>
          <label>Try a monthly payment <span class="cs-adorn pre"><i>$</i><input id="cs-ex-pay" data-money inputmode="decimal" placeholder="e.g. 12,000" autocomplete="off"></span></label></div>
        <p class="cs-fine">${rows.some(over) ? `* Above the ${exDti()}% debt-to-income this kind of loan usually allows. Some programs go higher; we can look at options. ` : ""}Estimates at today's planning numbers. Your final price range depends on the program, the appraisal and underwriting. ${RATE_NOTE}</p></div>`;
  },
  refi(c){
    const ch = c.monthlyChange, less = ch > 0, net = Math.max(0, c.closing - c.credits);
    return `<p class="cs-eyebrow">Current vs new</p><h2>${c.noRate ? "Your payment today and the new one" : less ? `About ${money(ch)} less each month` : `About ${money(-ch)} more each month`}</h2>
      <p class="cs-lede">${S.purpose === "cashout" ? `With ${cashWord(c)}${c.payoffFreed ? " and your debts paid off at closing" : ""}.` : "Your current payment next to the new one."}</p>
      <div class="cs-panes"><div class="cs-pane"><table class="cs-ltab">
        <tr><td>Current house payment</td><td>${money(n(S.curPay))}</td></tr>
        ${c.payoffFreed ? `<tr><td>Debt payments paid off at closing</td><td>${money(c.payoffFreed)}</td></tr><tr class="cs-sum"><td>What you pay today</td><td>${money(c.curToday)}</td></tr>` : ""}
        <tr><td>New house payment${c.noRate ? " (before interest)" : ""}</td><td>${money(c.pitia)}</td></tr>
        ${c.noRate ? `<tr><td colspan="2" class="cs-fine">The monthly difference shows once your rate is set.</td></tr>` : `<tr class="cs-sum"><td>Monthly ${less ? "savings" : "change"}</td><td>${less ? money(ch) : "+" + money(-ch)}</td></tr>`}</table></div>
      <div class="cs-pane"><div class="cs-k">Closing costs${c.credits ? " after credits" : ""}</div><div class="cs-v">${money(net)}</div>
        ${c.noRate ? "" : less && !c.closing ? `<p class="cs-fine" style="margin-top:14px">Closing costs aren't entered yet. Once they are, this shows how soon the savings pay them back.</p>` : less && !net ? `<p class="cs-fine" style="margin-top:14px">Credits cover the closing costs, so the savings start right away.</p>` : less ? `<div class="cs-k" style="margin-top:14px">Paid back in about</div><div class="cs-big" style="margin:0">${Math.ceil(c.refiBreakEven)}<small> months</small></div><p class="cs-fine">Closing costs divided by the monthly savings${c.payoffFreed ? ", including the debt payments that go away" : ""}.</p>`
              : `<p class="cs-fine" style="margin-top:14px">${S.purpose === "cashout" ? "The payment goes up, and you get the cash out." : "The payment goes up with this option."}</p>`}</div></div>
      ${c.noRate ? `<p class="cs-fine">The new payment is shown before interest until your rate is set.</p>` : ""}`;
  },
  reo(c){
    const list = reoLive(), f = n(S.reoFactor) || 75;
    return `<p class="cs-eyebrow">Real estate owned</p><h2>Your other properties</h2>
      <p class="cs-lede">Lenders count ${f}% of the rent to allow for vacancy and upkeep, then subtract each property's full monthly payment.</p>
      <div class="cs-pane"><table class="cs-ltab"><tr class="cs-sub"><td>Property</td>${S.coOn ? "<td>Whose</td>" : ""}<td>Payment</td><td>Rent × ${f}%</td><td>Net / month</td></tr>
        ${list.map(r => { const net = reoNet(r); return `<tr><td>${esc(r.label || "Property")}<div class="cs-fine" style="margin:2px 0 0">${esc(REO_STATUS[r.status] || "")}</div></td>${S.coOn ? `<td style="color:var(--cs-muted)">${esc(ownerName(r.who || "j"))}</td>` : ""}<td>${money(n(r.pitia))}</td><td>${r.status === "rental" ? money(n(r.rent) * f / 100) : "—"}</td><td><b>${net >= 0 ? "+" + money(net) : "−" + money(-net)}</b></td></tr>`; }).join("")}
        ${c.reoIncome ? `<tr class="cs-sum"><td>Added to your income</td>${S.coOn ? "<td></td>" : ""}<td></td><td></td><td>+${money(c.reoIncome)}</td></tr>` : ""}
        ${c.reoDebt ? `<tr class="cs-sum"><td>Counted with your debts</td>${S.coOn ? "<td></td>" : ""}<td></td><td></td><td>${money(c.reoDebt)}</td></tr>` : ""}</table>
        ${(S.reo||[]).some(r => r.status === "sale") ? `<p class="cs-fine">A property sold before this loan closes isn't counted.</p>` : ""}</div>`;
  },
  income(c){
    const groups = {}; S.incomes.filter(x => n(x.amt)).forEach(x => { const k = S.coOn || (x.who && !["b","c","j"].includes(x.who)) ? ownerName(x.who || "b") : (String(S.first||"").trim() || "Income"); (groups[k] = groups[k] || []).push(x); });
    const G = Object.entries(groups);
    if(c.reoIncome) G.push(["Rental properties", [{label:`Net rental income (${n(S.reoFactor)||75}% of rent, less payments)`, amt:c.reoIncome}]]);
    return `<p class="cs-eyebrow">Income</p><h2>Total income used: ${money(c.income)}<small style="font-size:.5em;color:var(--cs-muted)"> /month</small></h2>
      <p class="cs-lede">Gross monthly income, before taxes, as we figure it for your loan.</p>
      <div class="cs-panes">${G.map(([who, xs]) => `<div class="cs-pane"><h3 style="margin-top:0">${esc(who)}</h3><table class="cs-ltab">
        ${xs.map(x => `<tr><td>${esc(x.label || "Income")}${x.note ? `<div class="cs-fine" style="margin:2px 0 0">${esc(x.note)}</div>` : ""}</td><td>${money(n(x.amt))}</td></tr>`).join("")}
        <tr class="cs-sum"><td>Total income used</td><td>${money(xs.reduce((a,x) => a + n(x.amt), 0))}</td></tr></table></div>`).join("")}</div>`;
  },
  assets(c){
    const list = S.assets.filter(x => n(x.amt));
    return `<p class="cs-eyebrow">Assets</p><h2>Total savings: ${money(c.assets)}</h2>
      <p class="cs-lede">Money available for closing and reserves.</p>
      <div class="cs-panes"><div class="cs-pane"><table class="cs-ltab">${list.map(x => `<tr><td>${esc(x.label || "Account")}${x.gift ? " (gift)" : ""}</td>${S.coOn ? `<td style="color:var(--cs-muted)">${esc(ownerName(x.who || "j"))}</td>` : ""}<td>${money(n(x.amt))}</td></tr>`).join("")}
        <tr class="cs-sum"><td>Total</td>${S.coOn ? "<td></td>" : ""}<td>${money(c.assets)}</td></tr></table></div>
      <div class="cs-pane"><div class="cs-k">After closing</div><div class="cs-big">${isFinite(c.reserves) ? Math.max(0, c.reserves).toFixed(1) : "—"}<small> months</small></div>
        <p class="cs-fine">of your full monthly payment left in reserve. Lenders like to see some left over after closing.</p>${list.some(x => x.gift) ? `<p class="cs-fine">Gift funds need a signed gift letter and proof of the transfer.</p>` : ""}</div></div>`;
  },
  thanks(){
    return `<div class="cs-hello"><h2 class="cs-hi">Thank you!</h2>
      <p class="cs-lede">Questions anytime. We're here to help through closing.</p>
      <div class="cs-pane" style="max-width:520px"><div style="font-size:1.6em;font-weight:700">${esc(ME.name || "")}</div>
        ${ME.nmls ? `<div class="cs-note" style="margin-top:2px">NMLS #${esc(ME.nmls)}</div>` : ""}
        ${[ME.phone, ME.email].filter(Boolean).map(x => `<div style="margin-top:6px;font-size:1.15em">${esc(x)}</div>`).join("")}
        ${ME.company ? `<div class="cs-note" style="margin-top:10px">${esc(ME.company)}</div>` : ""}</div></div>`;   // company and NMLS only when the host passes them (the Brighter portal doesn't)
  },
  credit(c, who){
    const s = n(S.score), x = Math.max(500, Math.min(850, s)), pos = (x-500)/350*100, ti = tierOf(s);
    const segCol = ["var(--cs-bad-soft)","var(--cs-warn-soft)","var(--cs-side)","var(--cs-acc-soft)","var(--cs-ok-soft)"];
    const widths = [120,60,40,40,90]; // 500-619, 620-679, 680-719, 720-759, 760-850
    return `<p class="cs-eyebrow">Credit</p><h2>${who ? esc(who)+", your" : "Your"} ${S.appIn || scoredRows().length ? "credit" : "estimated"} score: ${s}</h2>
      <p class="cs-lede">${S.appIn || scoredRows().length ? "From your application and credit. Your final score at closing can still change your options." : "Based on what you shared with us. We'll confirm it with a credit report, and the final score can change your options."}</p>
      <div class="cs-pane"><div class="cs-scale"><div class="cs-pin" style="left:${pos}%"><b>${s}</b></div>
        <div class="cs-track">${widths.map((w,i) => `<div style="width:${w/350*100}%;background:${segCol[i]}"></div>`).join("")}</div>
        ${ticks([500,620,680,720,760,850],500,850)}</div>
        <div class="cs-tiers">${tierLabels.map((l,i) => `<div class="${i===ti?"on":""}"><b>${l}</b>${["Limited options","Some programs","Good","Very good","Best pricing tiers"][i]}</div>`).join("")}</div></div>
      ${bureauPane()}
      <div class="cs-callout">Tip while we work on your loan: keep card balances low and avoid opening new credit until closing.</div>`;
  },
  dti(c, who){
    const tone = dtiTone(c.dti), msg = {ok:"Comfortably within common limits.", warn:"Within range for many programs. We'll match you to one that fits.", bad:"We'll match this to a program that fits."}[tone] || "Add income to see your ratio.";
    const max = .6, w = v => Math.max(0, Math.min(1, v/max))*100;
    return `<p class="cs-eyebrow">Income & debts</p><h2>Debt-to-income: ${pct(c.dti)}</h2>
      <p class="cs-lede">Lenders compare your monthly debts, including the new house payment, to your gross monthly income.</p>
      ${S.appIn ? `<div class="cs-pane cs-formula"><div><div class="cs-frac"><span>Monthly debts + housing</span><span>Monthly gross income</span></div></div><b>=</b>
        <div><div class="cs-frac"><span>(${money(c.debts)} + ${money(c.pitia)})</span><span>${money(c.income)}</span></div></div><b>=</b><div class="cs-big" style="margin:0">${pct(c.dti,2)}</div></div>` : ""}
      <div class="cs-panes"${S.appIn ? ' style="display:none"' : ""}><div class="cs-pane"><table class="cs-ltab">
        <tr class="cs-sub"><td>Monthly income</td><td></td></tr>
        ${S.incomes.filter(x => n(x.amt)).map(x => `<tr><td>${esc(x.label||"Income")}</td><td>${money(n(x.amt))}</td></tr>`).join("")}
        ${c.reoIncome ? `<tr><td>Net rental income</td><td>${money(c.reoIncome)}</td></tr>` : ""}
        <tr class="cs-sum"><td>Total income</td><td>${money(c.income)}</td></tr>
        <tr class="cs-sub"><td style="padding-top:18px">Monthly debts</td><td></td></tr>
        <tr><td>New house payment${c.noRate ? " (before interest)" : ""}</td><td>${money(c.pitia)}</td></tr>
        ${S.debts.filter(x => n(x.amt) && !c.paidOff.includes(x) && !x.excl).map(x => `<tr><td>${esc(x.label||"Debt")}</td><td>${money(n(x.amt))}</td></tr>`).join("")}
        ${c.reoDebt ? `<tr><td>Other properties (net)</td><td>${money(c.reoDebt)}</td></tr>` : ""}
        <tr class="cs-sum"><td>Total debts</td><td>${money(c.pitia + c.debts)}</td></tr></table></div>
      <div class="cs-pane"><div class="cs-big">${pct(c.dti,0)}</div><div style="color:var(--cs-muted);margin-top:6px">${money(c.pitia + c.debts)} of ${money(c.income)} each month</div>
        <div class="cs-scale" style="margin-top:44px"><div class="cs-pin" style="left:${w(c.dti)}%"><b>${pct(c.dti,0)}</b></div>
          <div class="cs-track"><div style="width:${.43/max*100}%;background:var(--cs-acc-soft)"></div><div style="width:${.07/max*100}%;background:var(--cs-side)"></div><div style="flex:1;background:var(--cs-side)"></div></div>
          ${ticks([0,43,50,60],0,60,v=>v+"%")}</div>
        <div class="cs-callout ${tone==="ok"?"ok":""}">${msg}</div>
        ${pathBox(c, "dti")}
        <p class="cs-fine">Housing payment alone is ${pct(c.dtiFront)} of income.${c.payoffBal ? ` Debts paid off at closing aren't counted.` : ""}</p></div></div>`;
  },
  dscr(c){
    const tone = dscrTone(c.dscrRatio);
    return `<p class="cs-eyebrow">Rent coverage</p><h2>DSCR: ${isFinite(c.dscrRatio)?c.dscrRatio.toFixed(2):"—"}</h2>
      <p class="cs-lede">For an investment loan we qualify on the property: monthly rent divided by the full monthly payment. No personal income needed.</p>
      <div class="cs-panes"><div class="cs-pane"><table class="cs-ltab"><tr><td>Monthly rent</td><td>${money(n(S.rent))}</td></tr><tr><td>Full monthly payment${c.noRate ? " (before interest)" : " (PITIA)"}</td><td>${money(c.pitia)}</td></tr>
        <tr class="cs-sum"><td>Rent ÷ payment</td><td>${isFinite(c.dscrRatio)?c.dscrRatio.toFixed(2):"—"}</td></tr></table></div>
      <div class="cs-pane"><div class="cs-big">${isFinite(c.dscrRatio)?c.dscrRatio.toFixed(2):"—"}</div>
        <div class="cs-callout ${tone==="ok"?"ok":""}">${tone==="ok" ? "Rent covers the payment with room to spare. That opens the most options." : tone==="warn" ? "Rent covers the payment. Many programs work at this level." : "Some programs work at this level too. We'll match this to one that fits."}</div>${pathBox(c, "dscr")}</div></div>`;
  },
  payment(c, who){
    const parts = [[c.noRate ? "Principal (before interest)" : "Principal & interest", c.pi, "var(--cs-seg1)"],["Property taxes (est.)", c.tax, "var(--cs-seg2)"],["Homeowners insurance (est.)", c.hoi, "var(--cs-seg3)"],["Mortgage insurance", c.mi, "var(--cs-seg4)"],["HOA", c.hoa, "var(--cs-seg5)"]].filter(p => p[1] > 0);
    return `<p class="cs-eyebrow">Monthly payment</p><h2>${who ? esc(who)+", your" : "Your"} estimated payment</h2>
      <p class="cs-lede">${S.showProg && S.progName ? esc(S.progName) + ": " : ""}${money(c.total)} loan over ${esc(S.term)} years${rateLine(c) ? ` at ${rateLine(c)}` : ""}${c.ltv ? `, ${pct(c.ltv,0)} of the ${c.purchase?"price":"value"}` : ""}.</p>
      <div class="cs-panes"><div class="cs-pane"><div class="cs-big">${money(c.pitia)}<small> /month</small></div>
        <div class="cs-stack">${parts.map(p => `<div style="width:${p[1]/c.pitia*100}%;background:${p[2]}" title="${esc(p[0])}"></div>`).join("")}</div></div>
      <div class="cs-pane"><table class="cs-ltab">${parts.map(p => `<tr><td><span class="cs-sw" style="background:${p[2]}"></span>${esc(p[0])}</td><td>${money(p[1])}</td></tr>`).join("")}
        <tr class="cs-sum"><td>Total</td><td>${money(c.pitia)}</td></tr></table>
        ${c.buydownYears.length ? `<div class="cs-callout ok">With the ${esc(S.buydown)} buydown: ${c.buydownYears.map(y => `year ${y.year} ${money(y.pitia)}`).join(", ")}, then ${money(c.pitia)}.</div>` : ""}
        <p class="cs-fine">${c.noRate ? "This shows principal, taxes and insurance. Interest is added once your rate is set. " : ""}${RATE_NOTE} Taxes and insurance are estimates until we have the tax bill and your insurance quote.</p>
        <p class="cs-fine">${c.purchase ? "If the appraisal comes in below the price, the loan is based on the lower value, which can change your down payment." : "Your loan amount depends on the appraised value."}</p>
        ${c.mi ? `<p class="cs-fine">${c.miType==="fha" ? "FHA mortgage insurance includes a 1.75% upfront premium added to the loan." : "Mortgage insurance applies with less than 20% down and can usually be removed later."}</p>` : ""}</div></div>`;
  },
  costs(c){
    const sec = (title, items, total) => `<tr class="cs-sub"><td style="padding-top:16px">${title}</td><td></td></tr>${items.filter(i => i.amount).map(i => `<tr><td>${esc(i.label)}</td><td>${money(i.amount)}</td></tr>`).join("")}<tr><td><b>${title} total</b></td><td><b>${money(total)}</b></td></tr>`;
    // Lender section: the small fees sit inside one "Lender fees" line that opens when clicked
    const lenderRows = [...c.lenderFees.filter(f => !f.rollup && f.amount).map(f => `<tr><td>${esc(f.label)}</td><td>${money(f.amount)}</td></tr>`),
      c.rolledTotal ? `<tr class="cs-roll" data-roll><td>Lender fees</td><td>${money(c.rolledTotal)}</td></tr>` + c.rolled.filter(f => f.amount).map(f => `<tr class="cs-rolled"><td>${esc(f.label)}</td><td>${money(f.amount)}</td></tr>`).join("") : "",
      c.pointsAmt ? `<tr><td>${`Points${S.showRate && n(S.points) ? ` (${n(S.points)}%)` : ""}`}</td><td>${money(c.pointsAmt)}</td></tr>` : "",
      c.buydownCost ? `<tr><td>Temporary buydown (${esc(S.buydown)})</td><td>${money(c.buydownCost)}</td></tr>` : ""].join("");
    return `<p class="cs-eyebrow">Closing costs</p><h2>Estimated closing costs: ${money(c.closing + c.prepaidTotal)}</h2>
      <p class="cs-lede">Lender costs come from the lender's fee sheet. Title, escrow and prepaids are estimates until we have the title quote and your closing date.</p>
      <div class="cs-panes"><div class="cs-pane"><table class="cs-ltab">
        <tr class="cs-sub"><td>Lender</td><td></td></tr>${lenderRows}<tr><td><b>Lender total</b></td><td><b>${money(c.lenderTotal + c.pointsAmt + c.buydownCost)}</b></td></tr>
        ${sec("Third party", c.third, c.thirdTotal)}</table></div>
      <div class="cs-pane"><table class="cs-ltab">${sec("Prepaids & reserves", c.prepaids, c.prepaidTotal)}
        ${c.credits ? `<tr class="cs-sub"><td style="padding-top:16px">Credits</td><td></td></tr>${c.sellerCr?`<tr><td>Seller credit</td><td>−${money(c.sellerCr)}</td></tr>`:""}${n(S.lenderCredit)?`<tr><td>Lender credit</td><td>−${money(n(S.lenderCredit))}</td></tr>`:""}` : ""}
        <tr class="cs-sum"><td>Total, after credits</td><td>${money(c.closing + c.prepaidTotal - c.credits)}</td></tr></table>
        <p class="cs-fine">Prepaids are not fees. They fund your first interest, insurance and the escrow account for taxes and insurance.</p></div></div>`;
  },
  cash(c){
    if(c.purchase){
      const ok = c.assets >= c.fundsNeeded;
      return `<p class="cs-eyebrow">Cash to close</p><h2>Bring about ${money(c.cashToClose)} to closing</h2>
        <p class="cs-lede">On top of the ${money(c.emd)} earnest money already deposited.</p>
        <div class="cs-panes"><div class="cs-pane"><table class="cs-ltab">
          <tr><td>Down payment (${Math.round(c.downPct*10)/10}%)</td><td>${money(c.down)}</td></tr>
          <tr><td>Closing costs</td><td>${money(c.closing)}</td></tr>
          <tr><td>Prepaids & reserves</td><td>${money(c.prepaidTotal)}</td></tr>
          ${c.credits ? `<tr><td>Credits</td><td>−${money(c.credits)}</td></tr>` : ""}
          ${c.emd ? `<tr><td>Earnest money already paid</td><td>−${money(c.emd)}</td></tr>` : ""}
          <tr class="cs-sum"><td>Cash to close</td><td>${money(c.cashToClose)}</td></tr></table></div>
        <div class="cs-pane"><div class="cs-big">${money(c.cashToClose)}</div>
          <table class="cs-ltab" style="margin-top:18px"><tr><td>Assets you shared</td><td>${money(c.assets)}</td></tr><tr><td>Needed in total (incl. deposit)</td><td>${money(c.fundsNeeded)}</td></tr>
          <tr class="cs-sum"><td>Left after closing</td><td>${money(c.assets - c.fundsNeeded)}</td></tr></table>
          <div class="cs-callout ${ok?"ok":""}">${ok ? `That leaves about ${Math.max(0,c.reserves).toFixed(1)} months of payments in reserve.` : "We'll go over the options for funds to close."}</div>${ok ? "" : pathBox(c, "cash")}</div></div>`;
    }
    const toYou = c.cashOutNet >= 0;
    return `<p class="cs-eyebrow">${PURPOSE[S.purpose]}</p><h2>${toYou ? `About ${money(c.cashOutNet)} to you at closing` : `Bring about ${money(-c.cashOutNet)} to closing`}</h2>
      <p class="cs-lede">Your new loan pays off the current one and covers closing costs.</p>
      <div class="cs-panes"><div class="cs-pane"><table class="cs-ltab">
        <tr><td>New loan</td><td>${money(c.loan)}</td></tr><tr><td>Pay off current loan</td><td>−${money(n(S.payoff))}</td></tr>
        ${c.payoffBal ? `<tr><td>Pay off debts (${c.paidOff.map(x => esc(x.label || "debt")).join(", ")})</td><td>−${money(c.payoffBal)}</td></tr>` : ""}
        <tr><td>Closing costs</td><td>−${money(c.closing)}</td></tr><tr><td>Prepaids & reserves</td><td>−${money(c.prepaidTotal)}</td></tr>
        ${c.credits ? `<tr><td>Credits</td><td>${money(c.credits)}</td></tr>` : ""}
        <tr class="cs-sum"><td>${toYou ? "Cash to you" : "Cash to close"}</td><td>${money(Math.abs(c.cashOutNet))}</td></tr></table></div>
      <div class="cs-pane"><div class="cs-big">${money(Math.abs(c.cashOutNet))}</div>
        ${c.payoffBal ? `<div class="cs-callout ok">Paying off ${money(c.payoffBal)} in debts removes ${money(c.payoffFreed)} a month in payments. Your new housing payment is ${money(c.pitia)}${c.noRate ? " before interest" : ""}.</div>` : ""}
        <p class="cs-fine">Escrow refunds from your current loan come back to you separately, usually within 30 days of payoff.</p></div></div>`;
  },
  compare(c, who){
    const O = [{label: "Option 1", c}, ...optionCalcs()];
    const row = (label, f) => `<tr><td>${label}</td>${O.map(o => `<td>${f(o.c)}</td>`).join("")}</tr>`;
    return `<p class="cs-eyebrow">Your options</p><h2>${who ? esc(who)+", here's" : "Here's"} how your options compare</h2>
      <p class="cs-lede">Same estimates as the rest of this review, side by side. Quote date: ${QUOTE_DATE()}.</p>
      <div class="cs-pane"><table class="cs-ltab cs-cmp"><tr class="cs-sub"><td></td>${O.map(o => `<td>${esc(o.label)}</td>`).join("")}</tr>
        ${c.purchase ? row("Purchase price", k => money(k.price)) + row("Down payment", k => `${money(k.down)} (${Math.round(k.downPct*10)/10}%)`) : S.purpose==="cashout" ? row("Cash out", k => money(k.loan - n(S.payoff))) : ""}
        ${row("Loan amount", k => money(k.total))}
        ${S.showRate ? row("Rate", k => shownRate(k) ? Math.round(k.rate*1000)/1000 + "%" : "—") + row("Points", k => k.pointsAmt ? `${n(k.pointsPct)}% (${money(k.pointsAmt)})` : "—") + row("Term", k => k.term + " years") : ""}
        <tr class="cs-sum"><td>Monthly payment${c.noRate ? " (before interest)" : ""}</td>${O.map(o => `<td>${money(o.c.pitia)}</td>`).join("")}</tr>
        ${O.some(o => o.c.buydownYears.length) ? row("First-year payment", k => k.buydownYears.length ? money(k.buydownYears[0].pitia) : "—") : ""}
        ${row("Closing costs & prepaids", k => money(k.closing + k.prepaidTotal))}
        ${O.some(o => o.c.credits) ? row("Credits", k => k.credits ? "−" + money(k.credits) : "—") : ""}
        ${c.purchase ? `<tr class="cs-sum"><td>Cash to close</td>${O.map(o => `<td>${money(o.c.cashToClose)}</td>`).join("")}</tr>`
          : `<tr class="cs-sum"><td>Cash at closing</td>${O.map(o => `<td>${cashWord(o.c)}</td>`).join("")}</tr>`}
        ${c.dscr ? row("DSCR", k => isFinite(k.dscrRatio) ? k.dscrRatio.toFixed(2) : "—") : row("Debt-to-income", k => pct(k.dti))}
      </table></div><p class="cs-fine">${RATE_NOTE}</p>`;
  },
  next(c, who){
    const N = nextSteps(c);
    return `<p class="cs-eyebrow">Next steps</p><h2>${who ? esc(who)+", here's" : "Here's"} what happens next</h2>
      <p class="cs-lede">The sooner we have your documents, the faster everything moves. You'll get this list in your copy.</p>
      <div class="cs-next">
        <div class="cs-pane"><h3>What we'll need from you</h3><ul class="cs-check cs-docs">${N.docs.map(d => `<li data-doc="${esc(d)}" class="${S.docsIn[d] ? "in" : ""}" title="Click to mark received">${esc(d)}${S.docsIn[d] ? ` <span class="cs-got">Received</span>` : ""}</li>`).join("")}</ul><p class="cs-fine">${N.docs.some(d => S.docsIn[d]) ? `${N.docs.filter(d => S.docsIn[d]).length} of ${N.docs.length} received. ` : ""}We'll confirm the exact list for your program.</p></div>
        <div class="cs-pane"><h3>How it goes</h3><ol class="cs-steps">${N.steps.map(([t,d]) => `<li><b>${esc(t)}</b><span>${esc(d)}</span></li>`).join("")}</ol></div>
        <div class="cs-pane"><h3>Until closing</h3><p class="cs-dolbl ok">Do</p><ul class="cs-dos">${N.dos.map(d => `<li>${esc(d)}</li>`).join("")}</ul><p class="cs-dolbl bad">Please don't</p><ul class="cs-donts">${N.donts.map(d => `<li>${esc(d)}</li>`).join("")}</ul></div>
      </div>`;
  },
  summary(c, who){
    const progLines = progDates();
    const ratio = c.dscr ? (isFinite(c.dscrRatio)?c.dscrRatio.toFixed(2):"—") : pct(c.dti);
    const N = nextSteps(c);
    return `<p class="cs-eyebrow">Summary</p><h2>${who ? esc(who)+"'s" : "Your"} ${PURPOSE[S.purpose].toLowerCase()} at a glance</h2>
      <p class="cs-lede">${OCC[S.occ]}${n(S.score) ? ` · ${S.appIn ? "credit" : "estimated credit"} ${n(S.score)}` : ""} · ${esc(S.term)}-year loan</p>
      <div class="cs-sumgrid">
        <div class="cs-pane"><div class="cs-k">Loan amount</div><div class="cs-v">${money(c.total)}</div>${rateLine(c) ? `<div class="cs-note">${rateLine(c)}</div>` : ""}</div>
        <div class="cs-pane"><div class="cs-k">Monthly payment${c.noRate ? " (before interest)" : ""}</div><div class="cs-v">${money(c.pitia)}</div></div>
        <div class="cs-pane"><div class="cs-k">${c.dscr?"DSCR":"Debt-to-income"}</div><div class="cs-v">${ratio}</div></div>
        <div class="cs-pane"><div class="cs-k">${c.purchase ? "Cash to close" : c.cashOutNet>=0 ? "Cash to you" : "Cash to close"}</div><div class="cs-v">${money(c.purchase ? c.cashToClose : Math.abs(c.cashOutNet))}</div></div>
      </div>
      <div class="cs-pane"><table class="cs-ltab">
        <tr><td>${c.purchase?"Purchase price":"Estimated value"}</td><td>${money(c.value)}</td></tr>
        ${c.purchase ? `<tr><td>Down payment</td><td>${money(c.down)} (${Math.round(c.downPct*10)/10}%)</td></tr>` : ""}
        <tr><td>Estimated closing costs</td><td>${money(c.closing + c.prepaidTotal)}</td></tr>
        ${c.sellerCr ? `<tr><td>Seller credit</td><td>−${money(c.sellerCr)}</td></tr>` : ""}
        ${progLines.map(([k,v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table></div>
      <div class="cs-previews">
        <div class="cs-preview"><span class="cs-tag">In your copy</span><b>Your document checklist</b><ul>${N.docs.slice(0,3).map(d => `<li>${esc(d)}</li>`).join("")}<li class="more">+ ${Math.max(0, N.docs.length-3)} more</li></ul></div>
        <div class="cs-preview"><span class="cs-tag">In your copy</span><b>Next steps and tips</b><ul>${N.steps.slice(0,3).map(([t]) => `<li>${esc(t)}</li>`).join("")}<li class="more">+ do's and don'ts until closing</li></ul></div>
      </div>
      <p class="cs-fine">${RATE_NOTE} ${DISCLAIMER}</p>`;
  }
};
// Shown with every payment figure (slides, PDF, email)
const RATE_NOTE = "Rates are for illustration purposes and subject to change based on daily rates and qualifications.";
const DISCLAIMER = "Estimate for discussion only, based on information you provided. This is not a Loan Estimate, approval or commitment to lend. Payment, fees and terms depend on credit, property, program, market conditions and final underwriting.";
// Borrower next steps: documents (by how they qualify and the loan purpose), the process in order, and do's and don'ts. No timeframes.
// Document checklist templates by how the borrower documents income. Edit these to change what borrowers are asked for.
const DOC_TYPES = {"":"Not sure yet", full_doc:"W-2 / salaried (full doc)", self_employed:"Self-employed (tax returns)", bank_statement:"Bank statements (12–24 mo)", pnl:"P&L only", "1099":"1099 income", wvoe:"Written VOE", asset_depletion:"Asset depletion", dscr:"DSCR (rent)"};
const DOC_TEMPLATES = {
  "": ["Pay stubs for the last 30 days, or your most recent income records", "2 months of bank statements (all pages)", "We'll send the full list once we pick your program"],
  full_doc: ["Pay stubs for the last 30 days", "W-2s for the last 2 years", "2 months of bank statements (all pages)", "Details of any other income (bonus, rental, retirement)"],
  self_employed: ["Personal tax returns for the last 2 years (all pages)", "Business tax returns for the last 2 years, if you file them", "Year-to-date profit & loss statement", "2 months of personal and business bank statements (all pages)", "Business license or CPA letter showing 2 years in business"],
  bank_statement: ["12 or 24 months of business or personal bank statements (all pages)", "CPA letter, business license or other proof of 2 years in business", "Your ownership percentage of the business", "2 months of statements for the account funding closing"],
  pnl: ["A 12- or 24-month profit & loss statement (prepared or signed by your CPA or tax preparer)", "Proof of 2 years in business (CPA letter or business license)", "2 months of bank statements (all pages)"],
  "1099": ["1099s for the last 1–2 years", "Year-to-date proof of 1099 income (statements or invoices)", "2 months of bank statements (all pages)"],
  wvoe: ["Your employer's HR or payroll contact, so we can send the written verification", "2 months of bank statements (all pages)"],
  asset_depletion: ["Recent statements for every account we're counting (all pages, usually 2–3 months)", "Retirement account terms showing what you can withdraw"],
  dscr: ["Leases, or expected rent for the property", "2 months of bank statements (all pages)", "LLC documents, if buying or holding in an entity", "Mortgage statements for other properties you own"]
};
function nextSteps(c){
  const docs = ["Photo ID for each borrower", ...(DOC_TEMPLATES[c.dscr ? "dscr" : (S.docType || "")] || DOC_TEMPLATES[""])];
  if(c.purchase) docs.push("Your purchase contract, once you're in contract", "Who's holding your earnest money deposit");
  else docs.push("Your current mortgage statement", "Your homeowners insurance declarations page");
  if(S.assets.some(x => x.gift && n(x.amt))) docs.push("A signed gift letter, and proof of the gift transfer");
  return {docs,
    steps:[S.appIn ? ["Application","Done. We have your application and credit, and these numbers are built from them."] : ["Application","A short application and your OK for us to pull credit."],["Documents","You send us the items on the list; we review them and let you know if anything's missing."],["Appraisal","We order the appraisal and confirm the property's value."],["Underwriting","The file is reviewed and any final conditions come back to you."],["Closing","You review your final numbers, sign, and the loan funds."]],
    dos:["Answer our document requests quickly","Keep deposits and pay going in the way they normally do","Tell us before any large deposit or transfer","Line up a homeowners insurance quote"],
    donts:["Open new credit cards or loans","Finance a car, furniture or other big purchase","Change jobs without talking to us first","Move money between accounts without a paper trail","Miss or pay late on any bill"]};
}

// ---------- borrower copy (PDF) ----------
async function downloadPdf({dl, me={}, toast=()=>{}}={}){
  if(!dl){ toast("Downloads aren't available in this view."); return; }
  if(!window.jspdf){ toast("The PDF maker didn't load. Check your connection and try again."); return; }
  const c = calc(), doc = new window.jspdf.jsPDF({unit:"pt", format:"letter"}), W = 612, L = 54, R = W-54;
  let y = 64;
  const line = (label, val, opts={}) => { if(y > 720){ doc.addPage(); y = 64; } doc.setFont("helvetica", opts.bold?"bold":"normal"); doc.setFontSize(opts.size||11); doc.setTextColor(opts.muted?110:22); doc.text(label, L, y); if(val!=null) doc.text(String(val), R, y, {align:"right"}); y += opts.gap || 18; };
  const head = t => { y += 8; doc.setDrawColor(210); doc.line(L, y-12, R, y-12); line(t, null, {bold:true, size:12, gap:20}); };
  doc.setFont("helvetica","bold"); doc.setFontSize(20); doc.setTextColor(22); doc.text(`${whoNames() ? whoNames()+"'s " : ""}Loan Snapshot`, L, y); y += 20;
  line(`${PURPOSE[S.purpose]} · ${OCC[S.occ]} · ${new Date().toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}`, null, {muted:true, size:10, gap:26});
  head("At a glance");
  line("Loan amount", money(c.total)); line("Term", `${S.term} years`); if(rateLine(c)) line("Rate", rateLine(c)); line(c.noRate ? "Monthly payment (before interest)" : "Monthly payment", money(c.pitia), {bold:true});
  line(c.dscr ? "DSCR (rent ÷ payment)" : "Debt-to-income", c.dscr ? (isFinite(c.dscrRatio)?c.dscrRatio.toFixed(2):"—") : pct(c.dti));
  if(!c.dscr && (c.reoIncome || c.reoDebt)) line("Other properties (net per month)", [c.reoIncome ? "+" + money(c.reoIncome) + " income" : "", c.reoDebt ? money(c.reoDebt) + " debt" : ""].filter(Boolean).join(", "), {size:10, muted:true});
  if(n(S.score)) line(scoredRows().length ? "Qualifying credit score (lowest middle score)" : S.appIn ? "Credit score (from your credit check)" : "Estimated credit score (self-reported)", n(S.score));
  scoredRows().forEach(r => line(`  ${r.label || "Borrower"}: ${BUREAUS.map(([k,l]) => `${l} ${n(r[k]) || "—"}`).join(", ")}`, `middle ${midOf(r)}`, {size:10, muted:true}));
  line(c.purchase ? "Cash to close" : c.cashOutNet>=0 ? "Cash to you" : "Cash to close", money(c.purchase ? c.cashToClose : Math.abs(c.cashOutNet)), {bold:true});
  progDates().forEach(([k,v]) => line(k, v));
  if(!c.purchase && c.curToday && !c.noRate){ head("Current vs new");
    line("What you pay today" + (c.payoffFreed ? " (house + debts paid off)" : ""), money(c.curToday)); line("New house payment", money(c.pitia));
    line(c.monthlyChange > 0 ? "Monthly savings" : "Monthly change", c.monthlyChange > 0 ? money(c.monthlyChange) : "+" + money(-c.monthlyChange), {bold:true});
    if(c.monthlyChange > 0 && c.closing - c.credits > 0 && isFinite(c.refiBreakEven)) line("Closing costs paid back in about", Math.ceil(c.refiBreakEven) + " months"); }
  if(c.purchase && !c.dscr && S.exOn && c.income){ const mx = exMaxPrice(c); if(mx){ const mr = exRow(mx, c); head("What you can afford");
    line(`Up to about ${money(mx)} with ${Math.round(exDown(c)*10)/10}% down`, money(mr.pitia) + "/mo", {bold:true});
    S.exTries.map(t => exTryRow(t, c)).filter(r => r && !r.none).forEach(r => line(r.t.kind === "pay" ? `For ${money(n(r.t.v))}/mo: price ${money(r.price)}` : `At ${money(r.price)}`, money(r.pitia) + "/mo")); } }
  head("Monthly payment");
  [[c.noRate ? "Principal (before interest)" : "Principal & interest",c.pi],["Property taxes (estimate)",c.tax],["Homeowners insurance (estimate)",c.hoi],["Mortgage insurance",c.mi],["HOA",c.hoa]].filter(p => p[1]>0).forEach(p => line(p[0], money(p[1])));
  line("Total", money(c.pitia), {bold:true});
  line(RATE_NOTE, null, {size:9, muted:true});
  if(c.payoffBal) line(`Paying off ${money(c.payoffBal)} in debts removes ${money(c.payoffFreed)}/mo in payments`, null, {size:10, muted:true});
  if(c.buydownYears.length) line(`With the ${S.buydown} buydown: ` + c.buydownYears.map(y => `year ${y.year} ${money(y.pitia)}`).join(", ") + `, then ${money(c.pitia)}`, null, {size:10, muted:true});
  head("Estimated closing costs");
  [...c.lenderFees.filter(f => !f.rollup), ...(c.rolledTotal ? [{label:"Lender fees", amount:c.rolledTotal}] : []), ...(c.pointsAmt ? [{label:`Points${S.showRate && n(S.points) ? ` (${n(S.points)}%)` : ""}`, amount:c.pointsAmt}] : []), ...(c.buydownCost ? [{label:`Temporary buydown (${S.buydown})`, amount:c.buydownCost}] : []), ...c.third, ...c.prepaids].filter(f => f.amount).forEach(f => line(f.label, money(f.amount)));
  if(c.credits) line("Credits", "-" + money(c.credits));
  line("Total after credits", money(c.closing + c.prepaidTotal - c.credits), {bold:true});
  if(c.purchase){ head("Cash to close"); line("Down payment", money(c.down)); line("Closing costs and prepaids", money(c.closing + c.prepaidTotal)); if(c.credits) line("Credits", "-"+money(c.credits)); if(c.emd) line("Earnest money already paid", "-"+money(c.emd)); line("Cash to close", money(c.cashToClose), {bold:true}); }
  else { head("Your refinance"); line("New loan", money(c.loan)); line("Payoff of current loan", "-"+money(n(S.payoff))); if(c.payoffBal) line("Debts paid off at closing", "-"+money(c.payoffBal)); line("Closing costs and prepaids", "-"+money(c.closing + c.prepaidTotal)); if(c.credits) line("Credits", money(c.credits)); line(c.cashOutNet>=0?"Cash to you":"Cash to close", money(Math.abs(c.cashOutNet)), {bold:true}); if(c.savings>0) line("Monthly P&I savings", money(c.savings)); }
  y += 10;
  if(me.name){ line(`Prepared by ${me.name}${me.nmls ? " · NMLS #" + me.nmls : ""}`, null, {size:10}); const contact = [me.phone, me.email].filter(Boolean).join(" · "); if(contact) line(contact, null, {size:10, muted:true}); if(me.company) line(me.company, null, {size:10, muted:true}); }
  doc.setFontSize(8.5); doc.setTextColor(110); doc.setFont("helvetica","normal");
  const lines = doc.splitTextToSize(DISCLAIMER, R-L); if(y > 700){ doc.addPage(); y = 64; } doc.text(lines, L, Math.max(y+10, 730));
  // options side by side
  if(S.options.length){ const O = [{label:"Option 1", c}, ...optionCalcs()]; if(y > 600){ doc.addPage(); y = 64; } head("Your options");
    O.forEach(o => line(`${o.label}: ${o.c.purchase ? money(o.c.price) + " price, " + money(o.c.down) + " down" : money(o.c.loan) + " loan"}`, `${money(o.c.pitia)}/mo · ${cashWord(o.c)}`)); }
  // page 2: next steps
  const N = nextSteps(c); doc.addPage(); y = 64;
  doc.setFont("helvetica","bold"); doc.setFontSize(18); doc.setTextColor(22); doc.text("Next steps", L, y); y += 26;
  const wrap = (t, x, size=11, gap=16) => { doc.setFont("helvetica","normal"); doc.setFontSize(size); doc.setTextColor(22); const ls = doc.splitTextToSize(t, R-x); ls.forEach(l => { if(y > 740){ doc.addPage(); y = 64; } doc.text(l, x, y); y += gap; }); };
  const still = N.docs.filter(d => !S.docsIn[d]), got = N.docs.filter(d => S.docsIn[d]);
  head(got.length ? "Still needed from you" : "What we'll need from you"); still.forEach(d => wrap("[  ]  " + d, L)); if(!still.length) wrap("Nothing else right now. Thank you!", L);
  if(got.length){ y += 4; wrap("Received: " + got.join("; "), L, 9.5); } if(still.length) wrap("We'll confirm the exact list for your program.", L, 9.5, 18);
  head("How it goes"); N.steps.forEach(([t, d], i) => { doc.setFont("helvetica","bold"); doc.setFontSize(11); doc.text(`${i+1}. ${t}`, L, y); y += 15; wrap(d, L+14, 10, 15); y += 3; });
  head("Until closing, please do"); N.dos.forEach(d => wrap("•  " + d, L));
  head("Please don't"); N.donts.forEach(d => wrap("•  " + d, L));
  const name = `loan-snapshot${S.first.trim() ? "-" + S.first.trim().toLowerCase().replace(/[^a-z0-9]+/g,"-") : ""}.pdf`;
  try{ await dl.save({filename:name, data:doc.output("arraybuffer")}); toast("Saved."); }
  catch(e){ if(e && e.code==="declined") return; toast(e && e.code==="rate_limited" ? "A save is already waiting for your answer." : "Couldn't save the file here."); }
}

// Numbers for the LO's own notes: program-fit terms only, no exact income, balances or debts.
// Follow-up email draft for the LO to copy and send themselves. No rates. Never sent automatically.
function emailDraft(me = {}){
  const c = calc(), N = nextSteps(c), first = (S.first || "").trim();
  const L = [];
  L.push(`Hi ${first || "there"},`, "", S.appIn ? "Thanks for taking the time to go over your loan today. Here's a recap. These numbers are built from your application and credit, and they're still estimates until the loan is approved." : "Thanks for taking the time to talk today. Here's a quick recap of what we went over. These are estimates based on what you shared, and we'll firm them up as we go.", "");
  if(c.purchase && c.price) L.push(`- Purchase price: ${money(c.price)} with ${money(c.down)} down (${Math.round(c.downPct*10)/10}%)`);
  if(!c.purchase && c.value) L.push(`- Estimated value: ${money(c.value)}`);
  if(c.total) L.push(`- Loan amount: about ${money(c.total)}`);
  if(c.pitia) L.push(c.noRate ? `- Monthly principal, taxes and insurance: about ${money(c.pitia)} (interest is added once your rate is set)` : `- Estimated monthly payment: about ${money(c.pitia)} (including taxes and insurance)`);
  if(c.pitia) L.push(`  (${RATE_NOTE})`);
  if(c.buydownYears.length) L.push(`- With the ${S.buydown} buydown: ${c.buydownYears.map(y => `year ${y.year} about ${money(y.pitia)}`).join(", ")}`);
  if(c.purchase && c.cashToClose) L.push(`- Estimated cash to close: about ${money(c.cashToClose)}`);
  if(!c.purchase && c.cashOutNet > 0) L.push(`- Estimated cash to you at closing: about ${money(c.cashOutNet)}`);
  if(c.payoffBal) L.push(`- Debts paid off at closing: ${money(c.payoffBal)}, removing about ${money(c.payoffFreed)} a month in payments`);
  if(S.options.length){ L.push("", "Your options side by side:"); [{label:"Option 1", c}, ...optionCalcs()].forEach(o => L.push(`- ${o.label}: about ${money(o.c.pitia)}/mo, ${cashWord(o.c)}`)); }
  { const still = N.docs.filter(d => !S.docsIn[d]); if(still.length){ L.push("", N.docs.some(d => S.docsIn[d]) ? "Here's what we still need from you:" : "To get started, here's what we'll need from you:"); still.forEach(d => L.push(`- ${d}`)); } }
  if(N.docs.some(d => !S.docsIn[d])) L.push("We'll confirm the exact list for your program."); L.push("", "A few tips until closing:"); N.donts.slice(0,3).forEach(d => L.push(`- Please don't ${d.charAt(0).toLowerCase() + d.slice(1)}`)); L.push("- Tell us before any large deposit or transfer");
  L.push("", "You can send documents over whenever you're ready, and reply here with any questions.", "", "Thanks,", me.name || "", [me.phone, me.email].filter(Boolean).join(" · "));
  return {subject: `${first ? first + ", your" : "Your"} loan snapshot and next steps`, body: L.join("\n").replace(/\n+$/,"")};
}
function brief(){
  sync(); const c = calc(), out = [];
  if(!c.loan && !c.value) return "";
  out.push(`${PURPOSE[S.purpose]}, ${OCC[S.occ].toLowerCase()}${c.dscr ? ", qualifying on rent (DSCR)" : ""}.`);
  if(n(S.score)) out.push(scoredRows().length ? `Credit ${n(S.score)} (lowest middle score).` : S.appIn ? `Credit ${n(S.score)}.` : `Est. credit ${n(S.score)} (self-reported).`);
  if(c.value) out.push(`${c.purchase ? "Price" : "Value"} ${money(c.value)}, loan ${money(c.total)} (${pct(c.ltv,0)} LTV)${c.rate ? ` at ${c.rate}%${c.ratePlanned ? " (planning)" : ""} / ${S.term} yr` : ""}.`);
  if(c.buydownCost) out.push(`${S.buydown} buydown, about ${money(c.buydownCost)}.`);
  if(c.sellerCr) out.push(`Seller credit ${money(c.sellerCr)}.`);
  if(c.payoffBal) out.push(`Paying off ${money(c.payoffBal)} of debts (${money(c.payoffFreed)}/mo).`);
  if(S.options.length) out.push(`${S.options.length + 1} options compared.`);
  if(c.pitia) out.push(`Est. payment ${money(c.pitia)}/mo.`);
  if(c.dscr && isFinite(c.dscrRatio)) out.push(`DSCR ${c.dscrRatio.toFixed(2)}.`);
  if(!c.dscr && isFinite(c.dti)) out.push(`DTI about ${pct(c.dti,0)}.`);
  if(isFinite(c.reserves) && c.assets) out.push(`Reserves after closing about ${Math.max(0,c.reserves).toFixed(0)} months.`);
  if(c.purchase && c.cashToClose) out.push(`Est. cash to close ${money(c.cashToClose)} on ${c.sheet.name} fees.`);
  if(!c.purchase && c.cashOutNet) out.push(c.cashOutNet>=0 ? `About ${money(c.cashOutNet)} cash out.` : `Needs about ${money(-c.cashOutNet)} to close.`);
  return out.join(" ");
}

const STYLE = `.cs-calm{
  --cs-bg:#F2F6F5; --cs-side:#E6EEEC; --cs-card:#FFFFFF; --cs-field:#FBFDFC; --cs-line:#DAE4E1; --cs-ink:#2B3C42; --cs-muted:#6D7F84;
  --cs-acc:#4F8F8B; --cs-acc-ink:#2E6562; --cs-acc-soft:#E2F0EE; --cs-on-acc:#FFFFFF;
  --cs-ok:#3D7A5A; --cs-ok-soft:#E4F1E9; --cs-warn:#946A2F; --cs-warn-soft:#F6EEDF; --cs-bad:#A0564C; --cs-bad-soft:#F6E7E3;
  --cs-seg1:#4F8F8B; --cs-seg2:#84B7B2; --cs-seg3:#BCD9D5; --cs-seg4:#D2C29A; --cs-seg5:#AEBBBE;
  --cs-btn:#35575C; --cs-btn-ink:#FFFFFF;
  --cs-shadow:0 1px 2px rgba(40,70,70,.04), 0 12px 30px -20px rgba(40,70,70,.25);
  --cs-f-body:"Inter",system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif; --cs-f-head:"Inter Tight","Inter",system-ui,sans-serif;
  color-scheme:light; background:var(--cs-bg); color:var(--cs-ink);
}
/* collapsible closing costs (used inside Pipeline) */
details.cs-card>summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:10px}
details.cs-card>summary::-webkit-details-marker{display:none}
details.cs-card>summary h2{margin:0}
details.cs-card>summary .cs-hint{margin:2px 0 0}
details.cs-card>summary b{font-variant-numeric:tabular-nums;white-space:nowrap}
details.cs-card>summary b:after{content:" ▾";color:var(--cs-muted);font-weight:400}
details.cs-card[open]>summary b:after{content:" ▴"}
details.cs-card[open]>summary{margin-bottom:12px}
.csx{color:var(--cs-ink);font-family:var(--cs-f-body);font-size:15px;line-height:1.45;-webkit-font-smoothing:antialiased;container:cs / inline-size}
.csx,.csx *{box-sizing:border-box}
.csx button,.csx input,.csx select{font:inherit;color:inherit}
.csx button{cursor:pointer}
.csx button:disabled{opacity:.45;cursor:default}
.csx :focus-visible{outline:2px solid var(--cs-acc);outline-offset:2px}
.csx h2{color:inherit}
.cs-wrap{max-width:1180px;margin:0 auto;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:24px 120px}
.cs-num{font-variant-numeric:tabular-nums}

/* header */
.cs-top{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin-bottom:16px}
.cs-top h1{font-family:var(--cs-f-head);font-weight:600;font-size:26px;letter-spacing:-.01em;margin:0}
.cs-top .cs-sub{color:var(--cs-muted);font-size:14px}
.cs-actions{display:flex;gap:8px;flex-wrap:wrap}
.cs-btn{border:1px solid var(--cs-line);background:var(--cs-card);border-radius:999px;padding:8px 14px;font-size:14px;font-weight:500;transition:background .15s,border-color .15s}
.cs-btn:hover{border-color:var(--cs-muted)}
.cs-btn.primary{background:var(--cs-btn);color:var(--cs-btn-ink);border-color:var(--cs-btn)}
.cs-btn.accent{background:var(--cs-acc);color:var(--cs-on-acc);border-color:var(--cs-acc)}
.cs-btn.small{padding:5px 11px;font-size:13px}
.cs-btn.ghost{background:none;border-color:transparent;color:var(--cs-muted)}
.cs-btn.ghost:hover{color:var(--cs-ink)}
.cs-banner{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;background:var(--cs-warn-soft);color:var(--cs-warn);border-radius:12px;padding:10px 14px;font-size:14px;margin-bottom:16px}

/* input cards */
.cs-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}
.cs-col{display:grid;gap:16px;min-width:0}
.cs-card{background:var(--cs-card);border:1px solid var(--cs-line);border-radius:16px;padding:18px;box-shadow:var(--cs-shadow);min-width:0}
.cs-card h2{font-family:var(--cs-f-head);font-size:16px;font-weight:600;margin:0 0 4px}
.cs-card .cs-hint{color:var(--cs-muted);font-size:13px;margin:0 0 12px}
.cs-card .cs-hint:empty{margin:0 0 8px}
.cs-fields{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px 12px;align-items:start}
.cs-f{display:grid;gap:4px;min-width:0;align-content:start}
.cs-f>label,.cs-f>span{font-size:12px;color:var(--cs-muted);font-weight:500}
.cs-f input:not([type=checkbox]),.cs-f select{width:100%;height:38px;border:1px solid var(--cs-line);background:var(--cs-field);border-radius:10px;padding:8px 10px;font-size:15px;min-height:38px}
.cs-f input{font-variant-numeric:tabular-nums}
.cs-f .cs-note{font-size:12px;color:var(--cs-muted)}
.cs-adorn{position:relative;display:block}
.cs-f input[type=checkbox],.cs-switches input[type=checkbox],.cs-row input[type=checkbox]{width:16px;height:16px;min-height:0;margin:0;padding:0;flex:none;accent-color:var(--cs-acc)}
.cs-bhead{margin:6px 0 -2px;font-size:11px;color:var(--cs-muted);font-weight:600;min-height:0}.cs-bhead span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@supports (grid-template-rows:subgrid){
  .cs-fields{row-gap:0}
  .cs-fields>.cs-f{grid-row:span 3;grid-template-rows:subgrid;row-gap:4px;padding-bottom:10px}
  .cs-fields>.cs-f>:first-child{align-self:end}
}
.cs-lblrow{display:flex;align-items:center;justify-content:space-between;gap:6px}
.cs-unit{display:inline-flex;border:1px solid var(--cs-line);border-radius:999px;overflow:hidden;flex:none}
.cs-unit button{border:0;background:transparent;font:inherit;font-size:11px;font-weight:700;padding:2px 9px;color:var(--cs-muted);cursor:pointer;min-height:0}
.cs-unit button[aria-pressed="true"]{background:var(--cs-acc);color:#fff}
.cs-f .cs-note .cs-chk{margin:0 0 2px}
.csx input[type=checkbox]{width:16px;height:16px;min-height:0;margin:0;padding:0;flex:none;accent-color:var(--cs-acc)}
.cs-chk{display:flex;gap:8px;align-items:center;font-size:13px;color:var(--cs-muted)}
.cs-f .cs-chk{display:flex;gap:6px;align-items:center;font-size:12px;color:var(--cs-muted);margin-top:2px}
.cs-adorn i{position:absolute;top:50%;transform:translateY(-50%);font-style:normal;color:var(--cs-muted);font-size:14px;pointer-events:none}
.cs-adorn.pre i{left:10px} .cs-adorn.pre input{padding-left:22px}
.cs-adorn.post i{right:10px} .cs-adorn.post input{padding-right:26px}
.cs-seg{display:inline-flex;background:var(--cs-side);border-radius:999px;padding:3px;gap:2px;flex-wrap:wrap}
.cs-seg button{border:0;background:none;border-radius:999px;padding:6px 12px;font-size:13px;font-weight:500;color:var(--cs-muted)}
.cs-seg button[aria-pressed="true"]{background:var(--cs-card);color:var(--cs-ink);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.cs-segrow{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;margin-bottom:12px}
.cs-segrow .cs-lbl{font-size:12px;color:var(--cs-muted);font-weight:500;min-width:72px}
.cs-rows{display:grid;gap:8px}
.cs-row{display:grid;grid-template-columns:1fr 130px 32px;gap:8px;align-items:center}
.cs-row.cs-debt{grid-template-columns:1fr 110px auto auto}.cs-row.cs-debt-co{grid-template-columns:1fr 110px auto auto auto}
.cs-row.own{grid-template-columns:1fr 110px 108px 32px}
[data-list="asset"] .cs-row{grid-template-columns:1fr 110px auto 32px}[data-list="asset"] .cs-row.own{grid-template-columns:1fr 100px 100px auto 32px}.cs-row.cs-debt.own{grid-template-columns:1fr 100px 104px auto auto}.cs-row.cs-debt-co.own{grid-template-columns:1fr 100px 104px auto auto auto}
.cs-row.cs-reo{grid-template-columns:1fr 170px 32px}.cs-row.cs-reo:has(.cs-own){grid-template-columns:1fr 160px 104px 32px}
.cs-reo2{grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
.cs-own,.cs-row select{height:38px;border:1px solid var(--cs-line);background:var(--cs-field);border-radius:10px;padding:0 8px;font:inherit;font-size:13px;min-width:0;width:100%}
.cs-row input{width:100%;border:1px solid var(--cs-line);background:var(--cs-field);border-radius:10px;padding:7px 10px;min-height:36px}
.cs-row .cs-x{border:0;background:none;color:var(--cs-muted);font-size:18px;line-height:1;border-radius:8px;height:32px}
.cs-row .cs-x:hover{background:var(--cs-side);color:var(--cs-ink)}
.cs-addrow{margin-top:8px}
.cs-tot{display:flex;justify-content:space-between;border-top:1px solid var(--cs-line);margin-top:10px;padding-top:10px;font-size:14px}
.cs-tot b{font-variant-numeric:tabular-nums}
.cs-chip{display:inline-block;font-size:12px;font-weight:500;padding:3px 9px;border-radius:999px;background:var(--cs-side);color:var(--cs-muted)}
.cs-chip.ok{background:var(--cs-ok-soft);color:var(--cs-ok)} .cs-chip.warn{background:var(--cs-warn-soft);color:var(--cs-warn)} .cs-chip.bad{background:var(--cs-bad-soft);color:var(--cs-bad)} .cs-chip.acc{background:var(--cs-acc-soft);color:var(--cs-acc-ink)}
.cs-fees{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px}
.cs-fees h3{font-size:13px;font-weight:600;margin:0 0 8px;color:var(--cs-muted);text-transform:uppercase;letter-spacing:.06em}
.cs-feeline{display:grid;grid-template-columns:1fr 120px;gap:8px;align-items:center;margin-bottom:6px}
.cs-feeline label{font-size:14px;min-width:0}
.cs-feeline input{border:1px solid var(--cs-line);background:var(--cs-field);border-radius:8px;padding:6px 8px;text-align:right;font-variant-numeric:tabular-nums;width:100%}
.cs-feeline .cs-calc{text-align:right;font-variant-numeric:tabular-nums;padding:6px 8px;color:var(--cs-muted)}
.cs-hide{display:none!important}

/* live totals bar */
.cs-live{position:fixed;left:0;right:0;bottom:0;background:var(--cs-card);border-top:1px solid var(--cs-line);box-shadow:0 -8px 24px -18px rgba(0,0,0,.3);padding-bottom:env(safe-area-inset-bottom,0px);z-index:5}
.cs-live .cs-in{max-width:1180px;margin:0 auto;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:10px;display:flex;gap:10px 22px;align-items:center;flex-wrap:wrap}
.cs-kpi{display:grid;line-height:1.2}
.cs-kpi span{font-size:11px;color:var(--cs-muted);text-transform:uppercase;letter-spacing:.06em}
.cs-kpi b{font-family:var(--cs-f-head);font-size:19px;font-weight:600;font-variant-numeric:tabular-nums}
.cs-live .cs-go{margin-left:auto}

/* fee sheet manager / dialogs */
.cs-modal{position:fixed;inset:0;background:rgba(10,10,12,.45);display:flex;align-items:flex-start;justify-content:center;padding:max(24px,env(safe-area-inset-top,0px)) 16px 24px;z-index:20;overflow:auto}
.cs-sheet{background:var(--cs-card);border:1px solid var(--cs-line);border-radius:18px;max-width:760px;width:100%;padding:20px;box-shadow:var(--cs-shadow)}
.cs-sheet h2{font-family:var(--cs-f-head);margin:0 0 4px;font-size:20px}
.cs-sheetlist{display:flex;gap:6px;flex-wrap:wrap;margin:12px 0}
.cs-sheetlist button{border:1px solid var(--cs-line);background:var(--cs-field);border-radius:999px;padding:6px 12px;font-size:13px}
.cs-sheetlist button[aria-pressed="true"]{background:var(--cs-btn);color:var(--cs-btn-ink);border-color:var(--cs-btn)}
.cs-toast{position:fixed;left:50%;bottom:calc(84px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);background:var(--cs-btn);color:var(--cs-btn-ink);padding:9px 16px;border-radius:999px;font-size:14px;z-index:40;box-shadow:var(--cs-shadow)}

/* presentation */
.cs-stage{min-height:100%;display:flex;flex-direction:column}
.cs-stage .cs-bar{display:flex;align-items:center;gap:12px;justify-content:space-between;flex-wrap:wrap;max-width:1100px;width:100%;margin:0 auto;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:16px}
.cs-dots{display:flex;gap:6px;flex-wrap:wrap}
.cs-dots button{border:0;background:var(--cs-side);color:var(--cs-muted);border-radius:999px;padding:6px 12px;font-size:13px;font-weight:500}
.cs-dots button[aria-current="true"]{background:var(--cs-acc);color:var(--cs-on-acc)}
.cs-slide{flex:1;max-width:1100px;width:100%;margin:0 auto;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:8px 32px;animation:rise .35s ease both}
@keyframes rise{from{opacity:.0001;transform:translateY(8px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.cs-slide{animation:none}}
.cs-eyebrow{font-size:13px;font-weight:600;color:var(--cs-acc-ink);text-transform:uppercase;letter-spacing:.08em;margin:0 0 6px}
.cs-slide h2{font-family:var(--cs-f-head);font-weight:600;font-size:clamp(28px,4vw,44px);letter-spacing:-.02em;line-height:1.1;margin:0 0 8px;text-wrap:balance}
.cs-slide .cs-lede{color:var(--cs-muted);font-size:17px;max-width:60ch;margin:0 0 24px}
.cs-panes{display:grid;grid-template-columns:1.1fr .9fr;gap:20px;align-items:start}
.cs-pane{background:var(--cs-card);border:1px solid var(--cs-line);border-radius:20px;padding:22px;box-shadow:var(--cs-shadow);min-width:0}
.cs-big{font-family:var(--cs-f-head);font-weight:600;font-size:clamp(44px,7vw,76px);letter-spacing:-.03em;line-height:1;font-variant-numeric:tabular-nums}
.cs-big small{font-size:.4em;color:var(--cs-muted);font-weight:500;letter-spacing:0}
.cs-ltab{width:100%;border-collapse:collapse;font-size:16px}
.cs-ltab td{padding:9px 0;border-bottom:1px solid var(--cs-line);vertical-align:top}
.cs-ltab td:last-child{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;padding-left:16px}
.cs-ltab tr.sum td{border-bottom:0;border-top:2px solid var(--cs-ink);font-weight:600;padding-top:12px}
.cs-ltab tr.sub td{color:var(--cs-muted);font-size:14px}
.cs-ltab .cs-sw{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:8px;vertical-align:baseline}
.cs-stack{display:flex;height:22px;border-radius:999px;overflow:hidden;background:var(--cs-side);margin:18px 0 6px}
.cs-stack div{height:100%}
.cs-scale{position:relative;margin:28px 0 10px}
.cs-scale .cs-track{display:flex;height:14px;border-radius:999px;overflow:hidden}
.cs-scale .cs-track div{height:100%}
.cs-scale .cs-ticks{position:relative;height:16px;font-size:12px;color:var(--cs-muted);margin-top:6px;font-variant-numeric:tabular-nums}
.cs-scale .cs-ticks span{position:absolute;top:0;transform:translateX(-50%);white-space:nowrap}
.cs-scale .cs-ticks span:first-child{transform:none}
.cs-scale .cs-ticks span:last-child{transform:translateX(-100%)}
.cs-scale .cs-pin{position:absolute;top:-30px;transform:translateX(-50%);text-align:center}
.cs-scale .cs-pin b{display:block;background:var(--cs-ink);color:var(--cs-bg);border-radius:8px;padding:2px 8px;font-size:13px;font-variant-numeric:tabular-nums}
.cs-scale .cs-pin:after{content:"";display:block;width:2px;height:16px;background:var(--cs-ink);margin:0 auto}
.cs-tiers{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-top:18px}
.cs-tiers div{border-radius:12px;padding:10px;background:var(--cs-side);font-size:13px;color:var(--cs-muted)}
.cs-tiers div b{display:block;color:var(--cs-ink);font-size:14px;font-variant-numeric:tabular-nums}
.cs-tiers div.on{background:var(--cs-acc-soft);color:var(--cs-acc-ink);outline:2px solid var(--cs-acc)}
.cs-tiers div.on b{color:var(--cs-acc-ink)}
.cs-fine{font-size:12px;color:var(--cs-muted);margin-top:18px;max-width:80ch}
.cs-callout{border-radius:14px;padding:14px 16px;background:var(--cs-acc-soft);color:var(--cs-acc-ink);font-size:15px;margin-top:16px}
.cs-callout.ok{background:var(--cs-ok-soft);color:var(--cs-ok)} .cs-callout.warn{background:var(--cs-warn-soft);color:var(--cs-warn)}
/* 1.1: lender fees roll-up (click the line to open it), next steps, summary previews */
.cs-ltab tr.cs-roll{cursor:pointer} .cs-ltab tr.cs-rolled{display:none} .cs-ltab.cs-rollopen tr.cs-rolled{display:table-row}
.cs-ltab tr.cs-rolled td{color:var(--cs-muted);font-size:.92em;padding-left:14px}
.cs-next{display:grid;grid-template-columns:1.15fr 1fr 1fr;gap:16px;margin-top:8px}
.cs-next h3{font-family:var(--cs-f-head);font-size:16px;margin:0 0 10px}
.cs-check,.cs-dos,.cs-donts{list-style:none;margin:0;padding:0;display:grid;gap:8px;font-size:15px}
.cs-check li,.cs-dos li,.cs-donts li{position:relative;padding-left:26px}
.cs-check li:before{content:"";position:absolute;left:0;top:3px;width:15px;height:15px;border:1.5px solid var(--cs-acc);border-radius:4px}
.cs-dos li:before{content:"✓";position:absolute;left:2px;color:var(--cs-ok);font-weight:700}
.cs-donts li:before{content:"×";position:absolute;left:3px;color:var(--cs-bad);font-weight:700}
.cs-dolbl{margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase} .cs-dolbl.ok{color:var(--cs-ok)} .cs-dolbl.bad{color:var(--cs-bad);margin-top:14px}
.cs-steps{margin:0;padding:0;list-style:none;counter-reset:st;display:grid;gap:12px}
.cs-steps li{counter-increment:st;position:relative;padding-left:36px;display:grid;gap:2px;font-size:14.5px}
.cs-steps li:before{content:counter(st);position:absolute;left:0;top:0;width:24px;height:24px;border-radius:50%;background:var(--cs-acc-soft);color:var(--cs-acc-ink);font-weight:700;font-size:13px;display:grid;place-items:center}
.cs-steps li span{color:var(--cs-muted)}
.cs-previews{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}
.cs-preview{background:var(--cs-card);border:1px solid var(--cs-line);border-radius:16px;padding:16px 18px;box-shadow:var(--cs-shadow);position:relative}
.cs-preview b{display:block;font-family:var(--cs-f-head);font-size:16px;margin:2px 0 8px}
.cs-preview ul{margin:0;padding-left:18px;color:var(--cs-muted);font-size:14px;display:grid;gap:3px} .cs-preview li.more{list-style:none;margin-left:-18px;color:var(--cs-acc-ink);font-weight:500}
.cs-tag{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--cs-acc-ink);background:var(--cs-acc-soft);border-radius:999px;padding:2px 8px}
@container cs (max-width:820px){ .cs-next,.cs-previews{grid-template-columns:1fr} }
.cs-linkbtn{border:0;background:none;padding:4px 0 0;color:var(--cs-acc-ink);font-size:12.5px;text-decoration:underline;cursor:pointer;text-align:left}
/* 1.2: options, how to get there */
.cs-opt{border:1px solid var(--cs-line);border-radius:14px;padding:10px 12px;margin-bottom:10px;background:var(--cs-field)}
.cs-opthead{display:flex;gap:10px;align-items:center;margin-bottom:8px} .cs-opthead input{flex:1;border:0;background:transparent;font-weight:600;font-size:15px;color:var(--cs-ink);min-width:0} .cs-opthead b{font-size:13px;color:var(--cs-muted);font-weight:500;white-space:nowrap}
details.cs-path{margin-top:14px;padding:8px 2px;color:var(--cs-muted);font-size:14px} details.cs-path summary{cursor:pointer;font-size:13px;color:var(--cs-muted);list-style:none} details.cs-path summary::-webkit-details-marker{display:none} details.cs-path summary:before{content:"▸ ";} details.cs-path[open] summary:before{content:"▾ ";}
.cs-pathlist{display:grid;gap:6px;margin:4px 0 10px;color:var(--cs-ink)} .cs-pathlist label,.cs-pathshow{display:flex;gap:8px;align-items:flex-start;font-size:14px} .cs-pathshow{color:var(--cs-ink);font-weight:500}
.cs-path ul,.cs-path-slide ul{margin:6px 0 0;padding-left:18px;display:grid;gap:4px;font-size:14.5px}
.cs-path-slide{margin-top:14px;padding:12px 14px;border-radius:12px;background:var(--cs-card);border:1px solid var(--cs-line);font-size:15px} .cs-path-slide b{font-family:var(--cs-f-head)}
.cs-cmp td{text-align:right} .cs-cmp td:first-child{text-align:left} .cs-cmp tr.cs-sub td{font-weight:600;color:var(--cs-ink)}
.cs-sumgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}
.cs-sumgrid .cs-pane{padding:16px}
.cs-slide .cs-pane{overflow-x:auto}.cs-navbtns{flex-wrap:wrap}
.cs-extry{display:flex;gap:16px;flex-wrap:wrap;margin-top:16px}.cs-extry label{display:grid;gap:4px;font-size:13px;color:var(--cs-muted);flex:1 1 220px}
.cs-extry input{width:100%;height:42px;border:1px solid var(--cs-line);background:var(--cs-field);border-radius:10px;padding:0 10px 0 24px;font:inherit;font-size:16px}
tr.cs-exlive td{background:var(--cs-acc-soft)}
.cs-docs li{cursor:pointer}.cs-docs li.in{color:var(--cs-muted);text-decoration:line-through}.cs-got{text-decoration:none;display:inline-block;font-size:11px;font-weight:700;color:var(--cs-acc);margin-left:6px}
.cs-hello{max-width:880px;padding-top:4vh}.cs-hi{font-size:clamp(40px,6vw,76px);line-height:1.02;margin:0 0 22px;letter-spacing:-.02em}
.cs-hello .cs-lede{font-size:1.15em;max-width:720px}
.cs-numlist{display:grid;gap:10px;max-width:760px;margin-top:18px}.cs-num{display:grid;grid-template-columns:72px 1fr;gap:16px;align-items:center;background:var(--cs-card);border:1px solid var(--cs-line);border-radius:16px;padding:18px 22px;box-shadow:var(--cs-shadow)}
.cs-num b{font-size:34px;font-weight:300;color:var(--cs-acc);letter-spacing:-.03em}.cs-num span{font-size:1.05em;line-height:1.45}
.cs-bgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:22px}.cs-bgrid h3{margin:0 0 10px}
.cs-btile{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:12px 16px;margin-bottom:8px;border-radius:12px;background:var(--cs-side);border:2px solid transparent}
.cs-btile b{font-size:30px;letter-spacing:-.02em}.cs-btile span{color:var(--cs-muted);font-weight:600}
.cs-btile.mid{border-color:var(--cs-acc);background:var(--cs-acc-soft)}
.cs-formula{display:flex;align-items:center;justify-content:space-around;gap:16px;flex-wrap:wrap;margin-top:8px}.cs-formula>b{font-size:28px;color:var(--cs-muted)}
.cs-frac{display:inline-flex;flex-direction:column;align-items:center;font-size:1.15em}.cs-frac span{padding:6px 10px}.cs-frac span:first-child{border-bottom:2px solid var(--cs-ink)}
.cs-switches{display:flex;flex-direction:column;gap:6px;margin-top:12px;font-size:14px}.cs-switches label{display:flex;gap:8px;align-items:center}
.cs-sumgrid .cs-k{font-size:12px;color:var(--cs-muted);text-transform:uppercase;letter-spacing:.06em}
.cs-sumgrid .cs-v{font-family:var(--cs-f-head);font-size:28px;font-weight:600;font-variant-numeric:tabular-nums;margin-top:4px}
.cs-navbtns{display:flex;gap:8px}

@container cs (max-width:700px){
  .cs-grid,.cs-panes{grid-template-columns:1fr}
  .cs-sumgrid{grid-template-columns:1fr 1fr}
  .cs-tiers{grid-template-columns:repeat(3,1fr)}
}
@container cs (max-width:480px){
  .cs-row{grid-template-columns:1fr 100px 28px}
  .cs-row.cs-debt,.cs-row.cs-debt-co{grid-template-columns:1fr 100px 28px}
  .cs-row.own,.cs-row.cs-debt.own,.cs-row.cs-debt-co.own,.cs-row.cs-reo,.cs-row.cs-reo:has(.cs-own){grid-template-columns:1fr 100px 28px}
  .cs-row .cs-own{grid-column:1/3}.cs-row.cs-reo select[data-rk="status"]{grid-column:1/3}.cs-reo2{grid-template-columns:1fr 1fr}
  .cs-row.cs-debt>label,.cs-row.cs-debt-co>label{grid-column:span 1}
  .cs-row.cs-debt>.cs-x,.cs-row.cs-debt-co>.cs-x{grid-row:1;grid-column:3}
  .cs-row [data-rk="who"],.cs-row [data-rk="note"]{grid-column:1/-1 !important}
  .cs-bureau-row{grid-template-columns:1fr repeat(3,52px) 28px !important}.cs-bureau-row .cs-mid{display:none}
  .cs-live .cs-go{margin-left:0;width:100%}
  .cs-kpi b{font-size:16px}
}
`;
function injectCSS(){ if(document.getElementById("cs-core-css")) return; const st = document.createElement("style"); st.id = "cs-core-css"; st.textContent = STYLE; document.head.appendChild(st); }
const VERSION = "1.7"; // bump when math, slides or the PDF change, then update every copy (portal file, standalone artifact, Pipeline)
const api = {
  version: VERSION, DOC_TYPES,
  // opts (optional): planningRate(state) → rate %, insurancePct(state) → insurance as % of value per year
  bind(getState, getSheets, opts){ H = {state:getState, sheets:getSheets, opts: opts || {}}; },
  blank, example, uid, esc, n, money, pct, PURPOSE, OCC, DISCLAIMER, FALLBACK_SHEETS, injectCSS,
  calc(){ sync(); return calc(); }, slidesFor(c){ sync(); return slidesFor(c || calc()); },
  mountInputs, mountPresent, brief,
  pdf(o){ sync(); return downloadPdf(o); },
  email(me){ sync(); return emailDraft(me); }
};
return api;
})();

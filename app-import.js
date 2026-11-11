/* Application import: reads a 1003 exported as MISMO 3.4 XML (Fannie/Freddie ULAD, what Encompass, Arive, LendingPad
   and most LOSs export) and turns it into call sheet (presentation) numbers.
   Privacy: the file is read in the browser and never uploaded or saved. Only an allowlist of fields is read:
   names (first name for the slides), property and loan terms, monthly income totals, monthly debt payments and balances,
   asset totals, housing expenses and credit scores. It never reads SSNs/taxpayer ids, dates of birth, account numbers,
   addresses other than the subject property, or employer details beyond the self-employed flag.
   Use: AppImport.parse(xmlText) → {patch, summary:[...lines], skipped:[...], warnings:[...]} or throws Error(message). */
window.AppImport = (() => {
  const loc = el => el.localName || el.nodeName.replace(/^.*:/, "");
  const kids = (el, name) => el ? [...el.children].filter(c => loc(c) === name) : [];
  const all = (el, name) => el ? [...el.getElementsByTagNameNS("*", name)].concat(el.getElementsByTagNameNS ? [] : []) : [];
  // path walk by local names, e.g. path(deal, "LOANS/LOAN/TERMS_OF_LOAN")
  const path = (el, p) => p.split("/").reduce((acc, name) => acc.flatMap(e => kids(e, name)), el ? [el] : []);
  const txt = (el, name) => { const f = el && all(el, name)[0]; return f ? f.textContent.trim() : ""; };
  const num = v => { const x = parseFloat(String(v || "").replace(/[^0-9.\-]/g, "")); return isFinite(x) ? x : 0; };
  const r0 = v => String(Math.round(v));
  const truthy = v => /^(true|y|yes|1)$/i.test(String(v || "").trim());
  const median = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2) + (s.length % 2 ? 0 : 0)] : 0; };
  const mid3 = a => { const s = a.slice().sort((x, y) => x - y); return s.length === 3 ? s[1] : s.length === 2 ? s[0] : median(s); };   // tri-merge middle; two scores → lower
  const pretty = t => String(t || "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, c => c.toUpperCase());
  const uid = () => Math.random().toString(36).slice(2, 9);

  // Credit scores in a scope: MISMO 3.x (CREDIT_SCORE/CREDIT_SCORE_DETAIL elements) or 2.3.1 credit reports (attributes).
  // Returns one bureau row {eq, ex, tu}. Only score values and the bureau name are read.
  const BUR = [[/equifax|efx/i, "eq"], [/experian|xpn/i, "ex"], [/trans\s*union|tuc/i, "tu"]];
  function scoresIn(els){
    const row = {eq: "", ex: "", tu: ""}, loose = [];
    els.forEach(el => {
      const v = num(el.getAttribute("_Value") || txt(el, "CreditScoreValue")); if(v < 300 || v > 900) return;
      const b = el.getAttribute("CreditRepositorySourceType") || txt(el, "CreditRepositorySourceType");
      const hit = BUR.find(([re]) => re.test(b || ""));
      if(hit){ if(!row[hit[1]]) row[hit[1]] = String(v); } else loose.push(v);
    });
    // scores without a bureau name fill the empty slots in order
    loose.forEach(v => { const k = ["eq","ex","tu"].find(k => !row[k]); if(k) row[k] = String(v); });
    return row;
  }
  const midRow = r => { const v = [r.eq, r.ex, r.tu].map(num).filter(x => x >= 300).sort((a, b) => a - b); return v.length === 3 ? v[1] : v.length ? v[0] : 0; };
  const scoreEls = scope => { const cs = all(scope, "CREDIT_SCORE"); return cs.length ? cs : all(scope, "CreditScoreValue").map(e => e.parentNode); };

  // A credit report (soft pull) exported as XML: only the scores per borrower are read.
  function parseCredit(doc){
    const bureau = [];
    const borrowers = all(doc, "BORROWER").filter(b => b.getAttribute("BorrowerID"));
    if(borrowers.length && all(doc, "CREDIT_SCORE").some(e => e.getAttribute("BorrowerID"))){   // MISMO 2.3.1
      borrowers.forEach((b, i) => {
        const id = b.getAttribute("BorrowerID");
        const row = scoresIn(all(doc, "CREDIT_SCORE").filter(e => (e.getAttribute("BorrowerID") || "").split(/\s+/).includes(id)));
        if(midRow(row)) bureau.push(Object.assign({id: uid(), label: b.getAttribute("_FirstName") || `Borrower ${i + 1}`}, row));
      });
    } else {
      const parties = all(doc, "PARTY").filter(p => all(p, "BORROWER").length && all(p, "CREDIT_SCORE").length);
      (parties.length ? parties : [doc.documentElement]).forEach((p, i) => {
        const row = scoresIn(scoreEls(p));
        if(midRow(row)) bureau.push(Object.assign({id: uid(), label: txt(all(p, "INDIVIDUAL")[0], "FirstName") || `Borrower ${i + 1}`}, row));
      });
    }
    if(!bureau.length) throw new Error("No credit scores found in this file.");
    const q = Math.min(...bureau.map(midRow));
    return {kind: "credit", patch: {bureau, score: String(q)},
      summary: bureau.map(r => `${r.label}: Equifax ${r.eq || "—"}, Experian ${r.ex || "—"}, TransUnion ${r.tu || "—"} → middle ${midRow(r)}`).concat([`Qualifying score ${q} (lowest middle score)`]),
      warnings: [], skipped: ["SSNs", "dates of birth", "addresses", "account numbers and tradelines", "everything else on the report"], name: null, loanType: ""};
  }

  function parse(xmlText){
    if(!xmlText || !/</.test(xmlText)) throw new Error("That file isn't an XML application export.");
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    if(doc.getElementsByTagName("parsererror").length) throw new Error("The file didn't read as XML. Export the 1003 as MISMO 3.4 (ULAD) XML and try again.");
    const deal = all(doc, "DEAL")[0];
    const hasLoan = deal && all(deal, "TERMS_OF_LOAN").length;
    if(!hasLoan && all(doc, "CREDIT_SCORE").concat(all(doc, "CreditScoreValue")).length) return parseCredit(doc);
    if(!deal) throw new Error("No loan found in this file. It needs to be a MISMO 3.4 (ULAD) 1003 export or a credit report XML.");
    const patch = {}, summary = [], warnings = [], skipped = ["SSNs and taxpayer ids", "dates of birth", "account numbers", "employer addresses and phone numbers", "other addresses"];

    // ---- loan terms ----
    const loan = path(deal, "LOANS/LOAN")[0] || all(deal, "LOAN")[0];
    const terms = loan && all(loan, "TERMS_OF_LOAN")[0];
    const baseLoan = num(txt(terms, "BaseLoanAmount")) || num(txt(terms, "NoteAmount"));
    const purposeT = txt(terms, "LoanPurposeType");
    const mortType = txt(terms, "MortgageType");
    const noteRate = num(txt(terms, "NoteRatePercent"));
    const cashOutT = txt(loan, "RefinanceCashOutDeterminationType");
    const amortMonths = num(txt(loan, "LoanAmortizationPeriodCount"));
    const amortUnit = txt(loan, "LoanAmortizationPeriodType");
    const purchase = /purchase/i.test(purposeT);
    patch.purpose = purchase ? "purchase" : /cashout/i.test(cashOutT) ? "cashout" : "rate";
    if(amortMonths){ const yrs = /year/i.test(amortUnit) ? amortMonths : amortMonths / 12; if([10,15,20,25,30,40].includes(Math.round(yrs))) patch.term = String(Math.round(yrs)); }
    if(noteRate > 0 && noteRate < 20){ patch.rate = String(noteRate); patch.noRateYet = false; }
    if(/fha/i.test(mortType)) patch.miType = "fha";

    // ---- subject property ----
    const subj = all(deal, "SUBJECT_PROPERTY")[0];
    const usage = txt(subj, "PropertyUsageType");
    patch.occ = /second/i.test(usage) ? "second" : /invest/i.test(usage) ? "investment" : "primary";
    const contract = num(txt(deal, "SalesContractAmount"));
    const estValue = num(txt(subj, "PropertyEstimatedValueAmount")) || num(txt(subj, "PropertyValuationAmount"));
    const units = num(txt(subj, "FinancedUnitCount"));
    const state = txt(subj && all(subj, "ADDRESS")[0], "StateCode");
    const city = txt(subj && all(subj, "ADDRESS")[0], "CityName");

    // ---- borrowers (names, income, scores) ----
    const parties = all(deal, "PARTY").filter(p => all(p, "BORROWER").length);
    if(!parties.length) warnings.push("No borrowers found in the file.");
    const incomes = [], scoresByB = [], bureau = [];
    let selfEmployed = false, firstName = "", lastName = "";
    parties.forEach((p, i) => {
      const name = all(p, "INDIVIDUAL")[0], first = txt(name, "FirstName"), last = txt(name, "LastName");
      if(i === 0){ firstName = first; lastName = last; }
      const who = first || `Borrower ${i + 1}`;
      if(i === 1) patch.coFirst = first;
      // employer and position (current job) label the income lines: "Salesforce · Agile Coach"
      const emp = all(p, "EMPLOYER").find(e => !/prior/i.test(txt(e, "EmploymentStatusType"))) || all(p, "EMPLOYER")[0];
      const job = emp ? [txt(all(emp, "LEGAL_ENTITY")[0], "FullName"), txt(emp, "EmploymentPositionDescription")].filter(Boolean).join(" · ") : "";
      if(all(p, "EmploymentBorrowerSelfEmployedIndicator").some(e => truthy(e.textContent))) selfEmployed = true;
      // monthly income by type
      const byType = {};
      all(p, "CURRENT_INCOME_ITEM").forEach(it => {
        const amt = num(txt(it, "CurrentIncomeMonthlyTotalAmount")); if(!amt) return;
        const t = pretty(txt(it, "IncomeType")) || "Income"; byType[t] = (byType[t] || 0) + amt;
      });
      Object.entries(byType).forEach(([t, amt]) => incomes.push({id: uid(), label: [/^(Base|Bonus|Overtime|Commissions)$/.test(t) ? job : "", t === "Base" ? "Base income" : t].filter(Boolean).join(" · "), who: i === 0 ? "b" : "c", note: "", amt: r0(amt)}));
      const row = scoresIn(scoreEls(p));
      if(midRow(row)){ scoresByB.push(midRow(row)); bureau.push(Object.assign({id: uid(), label: first || `Borrower ${i + 1}`}, row)); }
    });
    // some exports keep scores outside the party
    if(!scoresByB.length){ const row = scoresIn(scoreEls(deal)); if(midRow(row)){ scoresByB.push(midRow(row)); bureau.push(Object.assign({id: uid(), label: firstName || "Borrower"}, row)); } }
    patch.bureau = bureau;   // a 1003 without scores clears old bureau rows (they'd otherwise keep forcing the score)
    const co = parties[1] && all(parties[1], "INDIVIDUAL")[0];
    patch.coFirst = co ? txt(co, "FirstName") : ""; patch.coLast = co ? txt(co, "LastName") : ""; patch.coOn = !!co;
    if(firstName){ patch.first = firstName; patch.last = lastName; }
    patch.borrowers = String(Math.max(1, parties.length));
    if(incomes.length) patch.incomes = incomes;
    if(scoresByB.length) patch.score = r0(Math.min(...scoresByB));   // lowest middle score across borrowers
    patch.qualify = "income";
    patch.docType = selfEmployed ? "self_employed" : incomes.length ? "full_doc" : "";

    // ---- who owns what: MISMO links assets and liabilities to borrower roles (and REO to its mortgages) with xlink RELATIONSHIPs ----
    const XL = "http://www.w3.org/1999/xlink";
    const xl = (el, k) => (el.getAttributeNS && el.getAttributeNS(XL, k)) || el.getAttribute("xlink:" + k) || "";
    const links = {}; all(deal, "RELATIONSHIP").forEach(r => { const f = xl(r, "from"), t = xl(r, "to"); if(!f || !t) return; (links[f] = links[f] || new Set()).add(t); (links[t] = links[t] || new Set()).add(f); });
    const roleParty = {}; parties.forEach((p, i) => all(p, "ROLE").forEach(r => { const lb = xl(r, "label"); if(lb) roleParty[lb] = i; }));
    const ownerOf = el => { const lb = xl(el, "label"); const idx = new Set([...(links[lb] || [])].map(x => roleParty[x]).filter(x => x != null));
      return idx.size > 1 ? "j" : idx.has(0) ? "b" : idx.has(1) ? "c" : ""; };
    const linkedTo = el => [...(links[xl(el, "label")] || [])];

    // ---- real estate owned (other properties): status, gross rent, taxes/insurance/HOA and the linked mortgage payments ----
    const reo = [], reoLiab = new Set();
    all(deal, "ASSET").forEach(a => {
      const op = all(a, "OWNED_PROPERTY")[0]; if(!op) return;
      if(truthy(txt(op, "OwnedPropertySubjectIndicator"))) return;   // the property this loan is on
      const disp = txt(op, "OwnedPropertyDispositionStatusType"); if(/^sold$/i.test(disp)) return;
      const rent = num(txt(op, "OwnedPropertyRentalIncomeGrossAmount")), upkeep = num(txt(op, "OwnedPropertyMaintenanceExpenseAmount"));
      let mort = 0; linkedTo(a).forEach(lb => { const l = all(deal, "LIABILITY").find(x => xl(x, "label") === lb); if(l){ mort += num(txt(l, "LiabilityMonthlyPaymentAmount")); reoLiab.add(l); } });
      const ad = all(op, "ADDRESS")[0], place = [txt(ad, "CityName"), txt(ad, "StateCode")].filter(Boolean).join(", ");
      const status = /pending/i.test(disp) ? "sale" : rent > 0 ? "rental" : "retain";
      reo.push({id: uid(), label: place ? `${status === "rental" ? "Rental" : "Property"} · ${place}` : `Property ${reo.length + 1}`, status, pitia: r0(mort + upkeep), rent: rent ? r0(rent) : "", who: ownerOf(a)});
    });
    patch.reo = reo;   // a 1003 without REO clears old rows

    // ---- assets ----
    const assets = [];
    all(deal, "ASSET").forEach(a => {
      if(all(a, "OWNED_PROPERTY").length) return;   // REO is handled above, not liquid
      const amt = num(txt(a, "AssetCashOrMarketValueAmount")); if(!amt) return;
      const t = pretty(txt(a, "AssetType")) || "Asset";
      if(/ownedProperty|realEstate/i.test(txt(a, "AssetType"))) return;   // REO is not liquid
      const holder = txt(all(a, "ASSET_HOLDER")[0], "FullName");
      assets.push({id: uid(), label: holder ? `${t} (${holder})` : t, amt: r0(amt), who: ownerOf(a)});
    });
    if(assets.length) patch.assets = assets;

    // ---- liabilities (monthly payment and balance only) ----
    const debts = []; let subjectPayoff = 0;
    all(deal, "LIABILITY").forEach(l => {
      if(reoLiab.has(l)) return;   // counted in that property's payment (REO), not twice
      const excluded = truthy(txt(l, "LiabilityExclusionIndicator"));   // kept on the liabilities slide, left out of the DTI
      const type = txt(l, "LiabilityType"), pay = num(txt(l, "LiabilityMonthlyPaymentAmount")), bal = num(txt(l, "LiabilityUnpaidBalanceAmount"));
      const payoff = truthy(txt(l, "LiabilityPayoffStatusIndicator"));
      if(/mortgage|heloc/i.test(type) && !purchase && payoff){ subjectPayoff += bal; return; }   // the loan(s) this refinance pays off
      if(!pay && !bal) return;
      const holder = txt(all(l, "LIABILITY_HOLDER")[0], "FullName");
      const label = [holder, pretty(type)].filter(Boolean).join(" · ") || "Debt";
      const row = {id: uid(), label, amt: pay ? r0(pay) : "", who: ownerOf(l)}; if(excluded) row.excl = true;
      if(patch.purpose === "cashout" && payoff && bal){ row.payoff = true; row.bal = r0(bal); }
      else if(bal) row.bal = r0(bal);
      debts.push(row);
    });
    if(debts.length) patch.debts = debts;

    // ---- price / value / loan ----
    if(purchase){
      const price = contract || estValue;
      if(price){ patch.price = r0(price); if(baseLoan && baseLoan <= price){ patch.downMode = "amt"; patch.downAmt = r0(price - baseLoan); } }
    } else {
      if(estValue) patch.value = r0(estValue);
      const payoff = subjectPayoff || (patch.purpose === "rate" ? baseLoan : 0);
      if(payoff) patch.payoff = r0(payoff);
      if(patch.purpose === "cashout" && baseLoan){
        const cash = baseLoan - (payoff || 0);   // debts paid at closing come out of this in the call sheet math
        if(cash > 0) patch.cashOut = r0(cash);
        if(!payoff) warnings.push("The current mortgage payoff wasn't marked in the file. Check the payoff and cash out.");
      }
    }

    // ---- proposed housing expenses ----
    let tax = 0, hoi = 0, hoa = 0;
    all(deal, "HOUSING_EXPENSE").forEach(h => {
      if(/present/i.test(txt(h, "HousingExpenseTimingType"))) return;   // current housing, not the new loan
      const t = txt(h, "HousingExpenseType"), amt = num(txt(h, "HousingExpensePaymentAmount"));
      if(/RealEstateTax/i.test(t)) tax += amt; else if(/HomeownersInsurance|HazardInsurance/i.test(t)) hoi += amt; else if(/Association|Condominium/i.test(t)) hoa += amt;
    });
    const valueForTax = purchase ? num(patch.price) : num(patch.value);
    if(tax && valueForTax) patch.taxRate = String(Math.round(tax * 12 / valueForTax * 10000) / 100);
    if(hoi){ patch.hoi = r0(hoi * 12); patch.hoiMode = "amt"; }
    if(hoa) patch.hoa = r0(hoa);
    patch.appIn = true;

    // ---- summary for the review box ----
    const $ = v => "$" + Math.round(num(v)).toLocaleString("en-US");
    summary.push(`${parties.length || 0} borrower${parties.length === 1 ? "" : "s"}${firstName ? ` (${firstName}${parties.length > 1 ? " +" + (parties.length - 1) : ""})` : ""}`);
    summary.push(`${{purchase:"Purchase", rate:"Rate / term refinance", cashout:"Cash-out refinance"}[patch.purpose]} · ${{primary:"Primary", second:"Second home", investment:"Investment"}[patch.occ]}${units > 1 ? ` · ${units} units` : ""}${city || state ? ` · ${[city, state].filter(Boolean).join(", ")}` : ""}`);
    if(patch.price) summary.push(`Price ${$(patch.price)}${patch.downAmt ? `, ${$(patch.downAmt)} down` : ""}`);
    if(patch.value) summary.push(`Value ${$(patch.value)}${patch.payoff ? `, payoff ${$(patch.payoff)}` : ""}${patch.cashOut ? `, cash out ${$(patch.cashOut)}` : ""}`);
    if(baseLoan) summary.push(`Loan ${$(baseLoan)}${patch.term ? `, ${patch.term} years` : ""}${patch.rate ? `, rate ${patch.rate}% (LO only)` : ""}${/fha/i.test(mortType) ? ", FHA" : mortType ? `, ${pretty(mortType)}` : ""}`);
    if(patch.score) summary.push(`Credit score ${patch.score} (lowest middle score)`);
    if(incomes.length) summary.push(`Income: ${incomes.length} item${incomes.length > 1 ? "s" : ""}, ${$(incomes.reduce((a, x) => a + num(x.amt), 0))}/mo${selfEmployed ? " · self-employed" : ""}`);
    if(debts.length) summary.push(`Debts: ${debts.length}, ${$(debts.filter(d => !d.excl).reduce((a, x) => a + num(x.amt), 0))}/mo counted${debts.some(d => d.excl) ? ` · ${debts.filter(d => d.excl).length} excluded` : ""}${debts.some(d => d.payoff) ? ` · ${debts.filter(d => d.payoff).length} paid off at closing` : ""}`);
    if(reo.length) summary.push(`Real estate owned: ${reo.length} propert${reo.length === 1 ? "y" : "ies"}${reo.some(r => r.status === "sale") ? ` (${reo.filter(r => r.status === "sale").length} being sold)` : ""}`);
    if(assets.length) summary.push(`Assets: ${assets.length}, ${$(assets.reduce((a, x) => a + num(x.amt), 0))}`);
    if(tax || hoi || hoa) summary.push(`Housing: ${[tax ? `taxes ${$(tax)}/mo` : "", hoi ? `insurance ${$(hoi)}/mo` : "", hoa ? `HOA ${$(hoa)}/mo` : ""].filter(Boolean).join(", ")}`);
    if(!patch.score) warnings.push("No credit scores in the file. Enter the score from your soft pull.");
    if(!incomes.length) warnings.push("No income in the file.");
    if(patch.occ === "investment") warnings.push("Investment property: switch to DSCR if you're qualifying on rent.");
    const loanType = /fha/i.test(mortType) ? "FHA" : /va/i.test(mortType) ? "VA" : /conventional/i.test(mortType) ? "Conventional" : "";
    if(bureau.length) summary.push(...bureau.map(r => `  ${r.label}: Equifax ${r.eq || "—"}, Experian ${r.ex || "—"}, TransUnion ${r.tu || "—"}`));
    return {kind: "1003", patch, summary, warnings, skipped, name: {first: firstName, last: lastName}, loanType};
  }
  // ---- 1003 as a PDF (best effort): pdf.js reads the text in the browser; only labelled numbers and the first name are picked out ----
  const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
  function loadPdfJs(){
    if(window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    return new Promise((ok, bad) => { const sc = document.createElement("script"); sc.src = PDFJS + "pdf.min.js";
      sc.onload = () => { if(!window.pdfjsLib) return bad(new Error("The PDF reader didn't load.")); pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js"; ok(pdfjsLib); };
      sc.onerror = () => bad(new Error("The PDF reader didn't load. Check your connection and try again.")); document.head.appendChild(sc); });
  }
  async function pdfText(buf){
    const lib = await loadPdfJs(); const pdf = await lib.getDocument({data: buf}).promise; const parts = [];
    for(let i = 1; i <= Math.min(pdf.numPages, 15); i++){
      const pg = await pdf.getPage(i);
      const tc = await pg.getTextContent(); parts.push(tc.items.map(t => t.str).join(" "));
      // fillable PDFs keep typed values in form fields: use each field's tooltip (or name) as its label
      const an = await pg.getAnnotations(); an.forEach(a => { if(a.fieldValue && typeof a.fieldValue === "string") parts.push(`${a.alternativeText || a.fieldName || ""} ${a.fieldValue}`); else if(a.checkBox && a.fieldValue && a.fieldValue !== "Off") parts.push(`[x] ${a.alternativeText || a.fieldName || ""}`); });
    }
    return parts.join("\n").replace(/[ \t]+/g, " ");
  }
  const amtAfter = (t, re) => { const m = t.match(re); return m ? num(m[1]) : 0; };
  const MONEY = "\\$?\\s*([0-9][0-9,]*(?:\\.[0-9]{2})?)";
  async function parsePdf(buf){
    let t = "";
    try { t = await pdfText(buf); } catch(e){ throw new Error(e.message && /reader/.test(e.message) ? e.message : "That PDF couldn't be read."); }
    if(t.replace(/\s/g, "").length < 200) throw new Error("This PDF has no readable text (it may be a scan). Use the MISMO 3.4 XML export, or type the numbers in.");
    if(!/uniform residential loan application|form 1003|URLA|1003/i.test(t)) throw new Error("This doesn't look like a 1003. Use the MISMO 3.4 XML export, or type the numbers in.");
    const patch = {}, found = [], missing = [];
    const R = (label, re) => { const v = amtAfter(t, new RegExp(re, "i")); if(v) found.push(label); return v; };
    const loanAmt = R("loan amount", "Loan Amount\\s*" + MONEY);
    const price = R("purchase price", "(?:Sales Contract Price|Sales Price|Purchase Price)\\s*" + MONEY);
    const value = R("property value", "Property Value\\s*" + MONEY);
    const income = R("total monthly income", "(?:Total Monthly Income|TOTAL)\\s*" + MONEY + "\\s*/\\s*month");
    const tax = R("property taxes", "Property Taxes\\s*" + MONEY);
    const hoi = R("insurance", "Homeowner'?s Insurance\\s*" + MONEY);
    const hoa = R("HOA dues", "(?:Association/Project Dues|HOA Dues|Homeowner'?s Association Dues)\\s*" + MONEY);
    const rate = amtAfter(t, /Note Rate\s*([0-9]{1,2}\.[0-9]{1,4})\s*%/i); if(rate) found.push("note rate");
    const termM = amtAfter(t, /Loan Term\s*([0-9]{2,3})\s*\(?months/i); if(termM) found.push("term");
    const nm = t.match(/Name \(First, Middle, Last, Suffix\)\s+([A-Z][a-zA-Z'\-]+)/); if(nm) found.push("first name");
    const refi = /\[x\][^\n]*refinance|Loan Purpose\s*Refinance/i.test(t), cash = /cash.?out/i.test((t.match(/Refinance Type[^\n]{0,80}/i) || [""])[0]);
    if(!found.length) throw new Error("No loan numbers could be read from this PDF. Use the MISMO 3.4 XML export, or type the numbers in.");
    const saysPurchase = /Loan Purpose\s*Purchase/i.test(t);
    const purchase = price > 0 || (!refi && saysPurchase);
    if(purchase) patch.purpose = "purchase"; else if(refi || cash) patch.purpose = cash ? "cashout" : "rate";   // otherwise leave the LO's choice
    if(purchase && (price || value)){ patch.price = r0(price || value); if(loanAmt && loanAmt <= (price || value)){ patch.downMode = "amt"; patch.downAmt = r0((price || value) - loanAmt); } }
    if(!purchase && patch.purpose){ if(value) patch.value = r0(value); if(patch.purpose === "rate" && loanAmt) patch.payoff = r0(loanAmt); if(patch.purpose === "cashout") missing.push("payoff and cash out"); }
    if(income) patch.incomes = [{id: uid(), label: "Total monthly income (from the 1003)", amt: r0(income)}];
    if(rate && rate < 20){ patch.rate = String(rate); patch.noRateYet = false; }
    if([120,180,240,300,360,480].includes(termM)) patch.term = String(termM / 12);
    const v = num(patch.price || patch.value); if(tax && v) patch.taxRate = String(Math.round(tax * 12 / v * 10000) / 100);
    if(hoi){ patch.hoi = r0(hoi * 12); patch.hoiMode = "amt"; } if(hoa) patch.hoa = r0(hoa);
    if(nm){ patch.first = nm[1]; const ln = t.match(/Name \(First, Middle, Last, Suffix\)\s+[A-Z][a-zA-Z'\-]+(?:\s+[A-Z]\.?)?\s+([A-Z][a-zA-Z'\-]+)/); if(ln) patch.last = ln[1]; }
    patch.appIn = true;
    ["loan amount", "total monthly income"].forEach(k => { if(!found.includes(k)) missing.push(k); });
    missing.push("debts", "assets", "credit scores (import the credit report XML or type them in)", "occupancy");
    const $ = x => "$" + Math.round(num(x)).toLocaleString("en-US");
    const summary = [`Read from a PDF (best effort): ${found.join(", ") || "nothing recognisable"}`];
    if(patch.price) summary.push(`Price ${$(patch.price)}${patch.downAmt ? `, ${$(patch.downAmt)} down` : ""}`);
    if(patch.value) summary.push(`Value ${$(patch.value)}`);
    if(loanAmt) summary.push(`Loan ${$(loanAmt)}${patch.term ? `, ${patch.term} years` : ""}${patch.rate ? `, rate ${patch.rate}% (LO only)` : ""}`);
    if(income) summary.push(`Income ${$(income)}/mo (one total line)`);
    return {kind: "pdf", patch, summary, warnings: [`Not found in the PDF, so enter or check by hand: ${missing.join(", ")}. PDF layouts vary by LOS, so check every number.`],
      skipped: ["SSNs and taxpayer ids", "dates of birth", "account numbers", "everything not listed above"], name: nm ? {first: nm[1], last: ""} : null, loanType: ""};
  }
  async function parseFile(file){
    const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    if(String.fromCharCode(...head) === "%PDF-") return parsePdf(await file.arrayBuffer());
    return parse(await file.text());
  }
  return {parse, parsePdf, parseFile};
})();

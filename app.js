'use strict';

/* ---------- constants ---------- */
const KEY = 'spendwise-data-v1';
const BUCKETS = [
  { id: 'me',     icon: '🧑',      color: 'var(--me)',     pdf: [37, 99, 235] },
  { id: 'wife',   icon: '👩',      color: 'var(--wife)',   pdf: [219, 39, 119] },
  { id: 'kids',   icon: '🧒',      color: 'var(--kids)',   pdf: [217, 119, 6] },
  { id: 'family', icon: '👨‍👩‍👧', color: 'var(--family)', pdf: [22, 163, 74] },
  { id: 'fixed',  icon: '🏠',      color: 'var(--fixed)',  pdf: [124, 58, 237] },
];
const CATEGORIES = ['Food', 'Groceries', 'Transport', 'Fuel', 'Shopping', 'Clothes', 'Health', 'Education',
  'Bills', 'Rent', 'EMI', 'Entertainment', 'Gifts', 'Other'];

/* ---------- state ---------- */
function defaultData() {
  return {
    expenses: [],          // {id, date:'YYYY-MM-DD', amount, who, category, place, note}
    fixed: [],             // {id, name, amount, day}
    fixedPaid: {},         // {'YYYY-MM': {fixedId: expenseId}}
    checkins: {},          // {'YYYY-MM-DD': 'none'}  (days marked "nothing spent")
    settings: {
      currency: '₹',
      names: { me: 'Me', wife: 'Wife', kids: 'Kids', family: 'Whole family', fixed: 'EMI, rent & bills' },
      startDate: todayStr(),
      lastPrompt: '',
    },
  };
}
let data, ui;

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw), def = defaultData();
      d.settings = Object.assign(def.settings, d.settings || {});
      d.settings.names = Object.assign(def.settings.names, (d.settings && d.settings.names) || {});
      return Object.assign(def, d);
    }
  } catch (e) { console.warn('load failed', e); }
  return defaultData();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); }
  catch (e) { toast('Could not save on this device!'); }
  syncReminderState();
}

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const pad = n => String(n).padStart(2, '0');
function dateStr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function todayStr() { return dateStr(new Date()); }
function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = parseDate(s); d.setDate(d.getDate() + n); return dateStr(d); }
function monthLabel(ym) { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }); }
function shiftMonth(ym, n) { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
function daysInMonth(ym) { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); }
function niceDate(s, long) {
  if (s === todayStr()) return 'Today';
  if (s === addDays(todayStr(), -1)) return 'Yesterday';
  return parseDate(s).toLocaleDateString('en-IN', long ? { weekday: 'long', day: 'numeric', month: 'long' } : { weekday: 'short', day: 'numeric', month: 'short' });
}
function num(n) { return Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
function money(n) { return data.settings.currency + num(n); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function bucket(id) { return BUCKETS.find(b => b.id === id) || BUCKETS[0]; }
function bname(id) { return data.settings.names[id] || id; }
function sum(list) { return list.reduce((a, e) => a + Number(e.amount || 0), 0); }
function inMonth(ym) { return data.expenses.filter(e => e.date.startsWith(ym)); }
function onDay(d) { return data.expenses.filter(e => e.date === d); }
function sortExp(list) { return list.slice().sort((a, b) => b.date.localeCompare(a.date) || (b.created || 0) - (a.created || 0)); }

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

/* ---------- daily check-in ---------- */
function isLogged(d) { return !!data.checkins[d] || data.expenses.some(e => e.date === d); }
function pendingDays() {
  // days from startDate up to yesterday (max 31 back) with nothing logged
  const out = [], today = todayStr();
  let d = data.settings.startDate > addDays(today, -31) ? data.settings.startDate : addDays(today, -31);
  while (d < today) { if (!isLogged(d)) out.push(d); d = addDays(d, 1); }
  return out;
}
function markNothing(d) { data.checkins[d] = 'none'; save(); render(); toast('Marked ' + niceDate(d) + ' as no spending'); }

function maybeDailyPrompt() {
  const today = todayStr();
  if (data.settings.lastPrompt === today) return;
  const pending = pendingDays();
  const eveningAsk = new Date().getHours() >= 18 && !isLogged(today);
  if (!pending.length && !eveningAsk) return;
  data.settings.lastPrompt = today; save();
  const day = pending.length ? pending[0] : today;
  openSheet(`
    <h3>Daily check-in 👋</h3>
    <p style="font-size:17px;margin:0 0 6px">How much did you spend <b>${pending.length ? 'on ' + esc(niceDate(day, true)) : 'today'}</b>, and where?</p>
    ${pending.length > 1 ? `<p class="muted small">${pending.length} days still need an entry. They're listed on the Home screen.</p>` : ''}
    <div class="btn-row" style="margin-top:14px">
      <button class="btn primary" data-action="add" data-date="${day}">Add spending</button>
      <button class="btn" data-action="nothing" data-date="${day}">Nothing spent</button>
      <button class="btn" data-action="close-sheet">Later</button>
    </div>`);
}

/* ---------- views ---------- */
function render() {
  document.querySelectorAll('.bottomnav button').forEach(b => b.classList.toggle('active', b.dataset.nav === ui.view));
  $('#topSub').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  const v = { home: viewHome, history: viewHistory, fixed: viewFixed, report: viewReport }[ui.view];
  $('#view').innerHTML = v();
}

function expenseRow(e, showDate) {
  const b = bucket(e.who);
  const sub = [bname(e.who), e.category, showDate ? niceDate(e.date) : '', e.note].filter(Boolean).map(esc).join(' · ');
  return `<button class="item" data-action="edit" data-id="${e.id}" style="--c:${b.color}">
    <span class="dot">${b.icon}</span>
    <span class="mid"><div class="t">${esc(e.place || e.category || 'Expense')}</div><div class="s">${sub}</div></span>
    <span class="amt">${money(e.amount)}</span></button>`;
}

function bucketCards(ym) {
  const list = inMonth(ym);
  return `<div class="buckets">${BUCKETS.map(b => {
    const l = list.filter(e => e.who === b.id);
    return `<button class="bucket ${b.id === 'fixed' ? 'wide' : ''}" style="--c:${b.color}" data-action="open-bucket" data-who="${b.id}">
      <div class="name">${b.icon} ${esc(bname(b.id))}</div>
      <div class="amt">${money(sum(l))}</div>
      <div class="cnt">${l.length} ${l.length === 1 ? 'entry' : 'entries'}</div></button>`;
  }).join('')}</div>`;
}

function viewHome() {
  const today = todayStr(), ym = today.slice(0, 7);
  const monthList = inMonth(ym), todayList = sortExp(onDay(today));
  const day = new Date().getDate(), dim = daysInMonth(ym);
  const pending = pendingDays();
  let h = `<div class="card hero">
    <div class="label">Spent in ${monthLabel(ym)}</div>
    <div class="big">${money(sum(monthList))}</div>
    <div class="row"><span>Today: <b>${money(sum(todayList))}</b></span><span>Daily avg: <b>${money(Math.round(sum(monthList) / day))}</b></span></div>
  </div>`;

  if (!isLogged(today)) {
    h += `<div class="card checkin" style="margin-top:12px">
      <div class="q">How much did you spend today, and where?</div>
      <div class="btn-row"><button class="btn primary" data-action="add">Add today's spending</button>
      <button class="btn" data-action="nothing" data-date="${today}">Nothing spent today</button></div></div>`;
  }
  if (pending.length) {
    h += `<h2>Missed days (${pending.length})</h2><div class="list">${pending.slice().reverse().map(d => `
      <div class="fixed-row"><div class="mid"><b>${esc(niceDate(d))}</b><div class="small muted">Nothing logged yet</div></div>
      <button class="btn sm primary" data-action="add" data-date="${d}">Add</button>
      <button class="btn sm" data-action="nothing" data-date="${d}">Nothing spent</button></div>`).join('')}</div>`;
  }
  if (dim - day <= 2) {
    h += `<div class="card month-end" style="margin-top:12px"><b>📄 Month is ending</b>
      <div class="small muted" style="margin:4px 0 10px">Create the PDF of all ${monthLabel(ym)} expenses.</div>
      <button class="btn primary" data-action="pdf-save" data-month="${ym}">Create PDF</button></div>`;
  }
  const unpaid = data.fixed.filter(f => !fixedPaidId(ym, f.id));
  if (unpaid.length) {
    h += `<div class="card" style="margin-top:12px" data-nav="fixed" role="button"><b>📅 ${unpaid.length} fixed payment${unpaid.length > 1 ? 's' : ''} not marked paid</b>
      <div class="small muted">${unpaid.map(f => esc(f.name)).join(', ')}: ${money(sum(unpaid))} due</div></div>`;
  }
  h += `<h2>This month by person</h2>${bucketCards(ym)}`;
  h += `<h2>Today</h2>${todayList.length ? `<div class="list">${todayList.map(e => expenseRow(e)).join('')}</div>`
    : `<div class="list"><div class="empty">${data.checkins[today] ? 'Marked as no spending today 🎉' : 'Nothing added today yet'}</div></div>`}`;
  return h;
}

function monthBar() {
  return `<div class="monthbar">
    <button class="btn sm" data-action="month" data-d="-1">‹ Prev</button>
    <div class="m">${monthLabel(ui.month)}</div>
    <button class="btn sm" data-action="month" data-d="1" ${ui.month >= todayStr().slice(0, 7) ? 'disabled' : ''}>Next ›</button></div>`;
}

function viewHistory() {
  let list = inMonth(ui.month);
  const filters = [{ id: 'all', label: 'All' }, ...BUCKETS.map(b => ({ id: b.id, label: b.icon + ' ' + bname(b.id) }))];
  if (ui.filter !== 'all') list = list.filter(e => e.who === ui.filter);
  list = sortExp(list);
  let h = monthBar() + `<div class="chips">${filters.map(f => `<button class="chip ${ui.filter === f.id ? 'on' : ''}" data-action="filter" data-f="${f.id}">${esc(f.label)}</button>`).join('')}</div>`;
  h += `<div class="card" style="margin-bottom:6px"><span class="muted">Total${ui.filter !== 'all' ? ' for ' + esc(bname(ui.filter)) : ''}:</span> <b style="font-size:18px">${money(sum(list))}</b> <span class="muted small">(${list.length} entries)</span></div>`;
  if (!list.length) return h + `<div class="list"><div class="empty">No expenses for this month yet</div></div>`;
  const byDay = {};
  list.forEach(e => (byDay[e.date] = byDay[e.date] || []).push(e));
  Object.keys(byDay).sort().reverse().forEach(d => {
    h += `<div class="day-head"><span>${esc(niceDate(d))}</span><span>${money(sum(byDay[d]))}</span></div>
      <div class="list">${byDay[d].map(e => expenseRow(e)).join('')}</div>`;
  });
  return h;
}

function fixedPaidId(ym, fid) {
  const id = (data.fixedPaid[ym] || {})[fid];
  return id && data.expenses.some(e => e.id === id) ? id : null;
}

function viewFixed() {
  const ym = ui.month;
  const items = data.fixed.slice().sort((a, b) => (a.day || 0) - (b.day || 0));
  const paidTotal = sum(items.filter(f => fixedPaidId(ym, f.id)));
  let h = monthBar();
  h += `<div class="card"><div class="muted small">Regular monthly payments: EMI, rent, school fees, bills…</div>
    <div style="display:flex;gap:20px;margin-top:6px"><div>Total<br><b style="font-size:18px">${money(sum(items))}</b></div>
    <div>Paid<br><b style="font-size:18px;color:var(--family)">${money(paidTotal)}</b></div>
    <div>Pending<br><b style="font-size:18px;color:var(--danger)">${money(sum(items) - paidTotal)}</b></div></div></div>`;
  h += `<h2>Monthly payments</h2>`;
  if (!items.length) {
    h += `<div class="list"><div class="empty">Add your EMI, rent, electricity, school fees, etc. once.<br>Each month just tick them as paid.</div></div>`;
  } else {
    h += `<div class="list">${items.map(f => {
      const paid = fixedPaidId(ym, f.id);
      return `<div class="fixed-row">
        <span class="dot" style="--c:var(--fixed)">🏠</span>
        <div class="mid" data-action="edit-fixed" data-id="${f.id}" role="button"><b>${esc(f.name)}</b>
          <div class="small muted">${money(f.amount)}${f.day ? ' · due on ' + f.day + ordinal(f.day) : ''} · tap to edit</div></div>
        ${paid ? `<span class="paid">✓ Paid</span><button class="btn sm" data-action="unpay" data-id="${f.id}">Undo</button>`
               : `<button class="btn sm primary" data-action="pay" data-id="${f.id}">Mark paid</button>`}
      </div>`;
    }).join('')}</div>`;
  }
  h += `<div style="margin-top:12px"><button class="btn block" data-action="edit-fixed">+ Add monthly payment</button></div>`;
  const other = sortExp(inMonth(ym).filter(e => e.who === 'fixed'));
  if (other.length) h += `<h2>All ${esc(bname('fixed'))} entries this month</h2><div class="list">${other.map(e => expenseRow(e, true)).join('')}</div>`;
  return h;
}
function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return s[(v - 20) % 10] || s[v] || s[0]; }

function viewReport() {
  const list = inMonth(ui.month), total = sum(list);
  let h = monthBar();
  h += `<div class="card hero"><div class="label">Total for ${monthLabel(ui.month)}</div><div class="big">${money(total)}</div>
    <div class="row"><span>${list.length} entries</span></div></div>`;
  h += `<div class="card" style="margin-top:12px"><b>📄 Monthly PDF report</b>
    <div class="small muted" style="margin:4px 0 10px">Summary for every person, category totals and the full list of expenses.</div>
    <div class="btn-row"><button class="btn primary" data-action="pdf-save" data-month="${ui.month}">Create PDF</button>
    <button class="btn" data-action="pdf-share" data-month="${ui.month}">Share PDF (WhatsApp…)</button></div></div>`;
  h += `<h2>By person</h2><div class="card">${BUCKETS.map(b => {
    const s = sum(list.filter(e => e.who === b.id));
    return `<div class="bar-row" style="--c:${b.color}"><div class="top"><span>${b.icon} ${esc(bname(b.id))}</span><b>${money(s)}</b></div>
      <div class="bar"><i style="width:${total ? (s / total * 100).toFixed(1) : 0}%"></i></div></div>`;
  }).join('')}</div>`;
  const cats = {};
  list.forEach(e => (cats[e.category || 'Other'] = (cats[e.category || 'Other'] || 0) + Number(e.amount)));
  const catRows = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  h += `<h2>By category</h2><div class="card">${catRows.length ? catRows.map(([c, s]) => `<div class="bar-row"><div class="top"><span>${esc(c)}</span><b>${money(s)}</b></div>
    <div class="bar"><i style="width:${(s / total * 100).toFixed(1)}%"></i></div></div>`).join('') : '<div class="empty">No data</div>'}</div>`;
  const places = {};
  list.forEach(e => { const p = (e.place || '').trim(); if (p) places[p] = (places[p] || 0) + Number(e.amount); });
  const top = Object.entries(places).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (top.length) h += `<h2>Where the money went</h2><div class="list">${top.map(([p, s]) => `<div class="fixed-row"><div class="mid">${esc(p)}</div><b>${money(s)}</b></div>`).join('')}</div>`;
  return h;
}

/* ---------- add / edit expense ---------- */
function openExpense(opts = {}) {
  const e = opts.id ? data.expenses.find(x => x.id === opts.id) : null;
  ui.draft = e ? { ...e } : { id: null, date: opts.date || todayStr(), amount: '', who: opts.who || lastWho(), category: '', place: '', note: '' };
  const d = ui.draft;
  const places = [...new Set(sortExp(data.expenses).map(x => x.place).filter(Boolean))].slice(0, 60);
  openSheet(`
    <h3>${e ? 'Edit expense' : 'Add expense'}</h3>
    <div class="field"><label>How much?</label>
      <input class="input amount" id="fAmount" type="number" inputmode="decimal" min="0" step="any" placeholder="${esc(data.settings.currency)}0" value="${esc(d.amount)}"></div>
    <div class="field"><label>For whom?</label><div class="seg" id="fWho">${BUCKETS.map(b =>
      `<button type="button" data-who="${b.id}" style="--c:${b.color}" class="${d.who === b.id ? 'on' : ''}"><span>${b.icon}</span>${esc(bname(b.id))}</button>`).join('')}</div></div>
    <div class="field"><label>Where did you spend?</label>
      <input class="input" id="fPlace" list="placeList" placeholder="e.g. Big Bazaar, Petrol pump, School" value="${esc(d.place)}">
      <datalist id="placeList">${places.map(p => `<option value="${esc(p)}">`).join('')}</datalist></div>
    <div class="field"><label>Category</label><div class="catchips" id="fCat">${CATEGORIES.map(c =>
      `<button type="button" class="chip ${d.category === c ? 'on' : ''}" data-cat="${c}">${c}</button>`).join('')}</div></div>
    <div class="field" style="display:flex;gap:10px">
      <div style="flex:1"><label>Date</label><input class="input" id="fDate" type="date" max="${todayStr()}" value="${d.date}"></div>
      <div style="flex:1.4"><label>Note (optional)</label><input class="input" id="fNote" placeholder="Anything extra" value="${esc(d.note)}"></div></div>
    <div class="btn-row">
      <button class="btn primary" style="flex:1" data-action="save-exp">Save</button>
      ${e ? `<button class="btn danger" data-action="del-exp">Delete</button>` : `<button class="btn" data-action="save-exp" data-more="1">Save &amp; add more</button>`}
    </div>`);
  if (!e) setTimeout(() => $('#fAmount') && $('#fAmount').focus(), 150);
}
function lastWho() { const l = sortExp(data.expenses).find(e => e.who !== 'fixed'); return l ? l.who : 'me'; }

function saveExpense(more) {
  const d = ui.draft;
  const amount = parseFloat($('#fAmount').value);
  if (!(amount > 0)) { toast('Enter the amount'); $('#fAmount').focus(); return; }
  const date = $('#fDate').value || todayStr();
  Object.assign(d, { amount: Math.round(amount * 100) / 100, date, place: $('#fPlace').value.trim(), note: $('#fNote').value.trim(), category: d.category || 'Other' });
  if (d.id) {
    const i = data.expenses.findIndex(x => x.id === d.id); data.expenses[i] = d;
  } else {
    d.id = uid(); d.created = Date.now(); data.expenses.push(d);
  }
  delete data.checkins[date];
  save();
  toast('Saved ' + money(d.amount) + ' for ' + bname(d.who));
  if (more) openExpense({ date, who: d.who }); else closeSheet();
  render();
}

/* ---------- fixed payments ---------- */
function openFixed(id) {
  const f = id ? data.fixed.find(x => x.id === id) : { name: '', amount: '', day: '' };
  openSheet(`
    <h3>${id ? 'Edit' : 'Add'} monthly payment</h3>
    <div class="field"><label>Name</label><input class="input" id="xName" placeholder="e.g. Home loan EMI, House rent, School fees" value="${esc(f.name)}"></div>
    <div class="field" style="display:flex;gap:10px">
      <div style="flex:1.4"><label>Amount per month</label><input class="input" id="xAmount" type="number" inputmode="decimal" value="${esc(f.amount)}"></div>
      <div style="flex:1"><label>Due day (1-31)</label><input class="input" id="xDay" type="number" inputmode="numeric" min="1" max="31" value="${esc(f.day)}"></div></div>
    <div class="btn-row"><button class="btn primary" style="flex:1" data-action="save-fixed" data-id="${id || ''}">Save</button>
    ${id ? `<button class="btn danger" data-action="del-fixed" data-id="${id}">Delete</button>` : ''}</div>`);
}
function saveFixed(id) {
  const name = $('#xName').value.trim(), amount = parseFloat($('#xAmount').value), day = parseInt($('#xDay').value, 10) || '';
  if (!name || !(amount > 0)) { toast('Enter a name and amount'); return; }
  if (id) Object.assign(data.fixed.find(x => x.id === id), { name, amount, day });
  else data.fixed.push({ id: uid(), name, amount, day });
  save(); closeSheet(); render();
}
function payFixed(fid) {
  const f = data.fixed.find(x => x.id === fid), ym = ui.month;
  const isCur = ym === todayStr().slice(0, 7);
  const date = isCur ? todayStr() : ym + '-' + pad(Math.min(f.day || 1, daysInMonth(ym)));
  const cat = /emi|loan/i.test(f.name) ? 'EMI' : /rent/i.test(f.name) ? 'Rent' : /school|fee|tuition/i.test(f.name) ? 'Education' : 'Bills';
  const e = { id: uid(), created: Date.now(), date, amount: f.amount, who: 'fixed', category: cat, place: f.name, note: 'Monthly payment' };
  data.expenses.push(e);
  (data.fixedPaid[ym] = data.fixedPaid[ym] || {})[fid] = e.id;
  save(); render(); toast(f.name + ' marked paid');
}
function unpayFixed(fid) {
  const ym = ui.month, eid = fixedPaidId(ym, fid);
  data.expenses = data.expenses.filter(e => e.id !== eid);
  delete data.fixedPaid[ym][fid];
  save(); render();
}

/* ---------- PDF ---------- */
function pdfMoney(n) {
  const c = data.settings.currency === '₹' ? 'Rs. ' : data.settings.currency.replace(/[^\x20-\x7E]/g, '') + ' ';
  return c + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pdfText(s) { return String(s || '').replace(/[^\x20-\x7E -ÿ]/g, '').trim(); }

function buildPdf(ym) {
  if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('PDF library not loaded. Open the app once with internet so it can download.');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const list = inMonth(ym).slice().sort((a, b) => a.date.localeCompare(b.date));
  const total = sum(list);
  const teal = [15, 118, 110];

  doc.setFillColor(...teal); doc.rect(0, 0, W, 78, 'F');
  doc.setTextColor(255); doc.setFontSize(20); doc.setFont('helvetica', 'bold');
  doc.text('Monthly Expense Report', 40, 38);
  doc.setFontSize(12); doc.setFont('helvetica', 'normal');
  doc.text(monthLabel(ym), 40, 58);
  doc.setFontSize(10); doc.text('Generated ' + new Date().toLocaleDateString('en-IN'), W - 40, 58, { align: 'right' });
  doc.setFontSize(11); doc.text('Total spent', W - 40, 30, { align: 'right' });
  doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.text(pdfMoney(total), W - 40, 46, { align: 'right' });
  doc.setTextColor(17); doc.setFont('helvetica', 'normal');

  const base = { theme: 'grid', styles: { fontSize: 9.5, cellPadding: 5 }, headStyles: { fillColor: teal }, margin: { left: 40, right: 40 } };
  const days = daysInMonth(ym);

  doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.text('Summary', 40, 108);
  doc.autoTable({ ...base, startY: 116,
    head: [['Section', 'Entries', 'Amount', '% of total']],
    body: BUCKETS.map(b => { const l = list.filter(e => e.who === b.id); return [pdfText(bname(b.id)), l.length, pdfMoney(sum(l)), total ? (sum(l) / total * 100).toFixed(1) + '%' : '0%']; }),
    foot: [['Total', { content: list.length, styles: { halign: 'center' } }, { content: pdfMoney(total), styles: { halign: 'right' } }, { content: '100%', styles: { halign: 'right' } }]],
    footStyles: { fillColor: [229, 231, 235], textColor: 17, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    didParseCell: c => { if (c.section === 'body' && c.column.index === 0) c.cell.styles.textColor = BUCKETS[c.row.index].pdf; },
  });
  let y = doc.lastAutoTable.finalY + 10;
  doc.setFontSize(9.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(90);
  doc.text('Average per day: ' + pdfMoney(total / days) + '   |   Personal (excluding EMI, rent & bills): ' + pdfMoney(sum(list.filter(e => e.who !== 'fixed'))), 40, y + 6);
  doc.setTextColor(17);

  const cats = {};
  list.forEach(e => (cats[e.category || 'Other'] = (cats[e.category || 'Other'] || 0) + Number(e.amount)));
  const catRows = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  if (catRows.length) {
    doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.text('By category', 40, y + 32);
    doc.autoTable({ ...base, startY: y + 40, head: [['Category', 'Amount', '% of total']],
      body: catRows.map(([c, s]) => [c, pdfMoney(s), (s / total * 100).toFixed(1) + '%']),
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } } });
    y = doc.lastAutoTable.finalY;
  }

  // fixed payments status
  if (data.fixed.length) {
    if (y > H - 140) { doc.addPage(); y = 30; }
    doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.text('Monthly payments (EMI, rent, bills)', 40, y + 32);
    doc.autoTable({ ...base, startY: y + 40, head: [['Payment', 'Due day', 'Amount', 'Status']],
      body: data.fixed.map(f => [pdfText(f.name), f.day || '-', pdfMoney(f.amount), fixedPaidId(ym, f.id) ? 'Paid' : 'NOT PAID']),
      columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' }, 3: { halign: 'center' } },
      didParseCell: c => { if (c.section === 'body' && c.column.index === 3 && c.cell.raw === 'NOT PAID') c.cell.styles.textColor = [220, 38, 38]; } });
    y = doc.lastAutoTable.finalY;
  }

  // details per person
  BUCKETS.forEach(b => {
    const l = list.filter(e => e.who === b.id);
    if (!l.length) return;
    if (y > H - 140) { doc.addPage(); y = 30; }
    doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(...b.pdf);
    doc.text(pdfText(bname(b.id)) + ' - ' + pdfMoney(sum(l)), 40, y + 34);
    doc.setTextColor(17);
    doc.autoTable({ ...base, startY: y + 42, headStyles: { fillColor: b.pdf },
      head: [['Date', 'Where', 'Category', 'Note', 'Amount']],
      body: l.map(e => [parseDate(e.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', weekday: 'short' }), pdfText(e.place) || '-', e.category || '', pdfText(e.note), pdfMoney(e.amount)]),
      foot: [['', '', '', 'Total', pdfMoney(sum(l))]],
      footStyles: { fillColor: [243, 244, 246], textColor: 17, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 72 }, 4: { halign: 'right', cellWidth: 82 } } });
    y = doc.lastAutoTable.finalY;
  });

  // daily totals
  const daily = {};
  list.forEach(e => (daily[e.date] = (daily[e.date] || 0) + Number(e.amount)));
  if (Object.keys(daily).length) {
    if (y > H - 140) { doc.addPage(); y = 30; }
    doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.text('Day by day', 40, y + 34);
    doc.autoTable({ ...base, startY: y + 42, head: [['Date', 'Entries', 'Spent that day']],
      body: Object.keys(daily).sort().map(d => [parseDate(d).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' }), list.filter(e => e.date === d).length, pdfMoney(daily[d])]),
      columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' } } });
  }

  if (!list.length) { doc.setFontSize(11); doc.setFont('helvetica', 'normal'); doc.text('No expenses recorded for this month.', 40, y + 30); }

  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFontSize(8.5); doc.setTextColor(140); doc.setFont('helvetica', 'normal');
    doc.text('SpendWise - ' + monthLabel(ym), 40, H - 20);
    doc.text('Page ' + i + ' of ' + pages, W - 40, H - 20, { align: 'right' });
  }
  return doc;
}
function pdfName(ym) { return 'Expenses-' + monthLabel(ym).replace(' ', '-') + '.pdf'; }

async function createPdf(ym, share) {
  let doc;
  try { doc = buildPdf(ym); } catch (err) { toast(err.message); return; }
  const name = pdfName(ym);
  if (share) {
    const file = new File([doc.output('blob')], name, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); } catch (e) { /* user cancelled */ }
      return;
    }
    toast('Sharing not supported here. Downloading instead.');
  }
  doc.save(name);
  toast('PDF saved to Downloads: ' + name);
}

/* ---------- settings / backup ---------- */
function openSettings() {
  const n = data.settings.names;
  openSheet(`
    <h3>Settings</h3>
    <div class="field"><label>Names shown in the app</label>
      ${['me', 'wife', 'kids', 'family', 'fixed'].map(k => `<input class="input" style="margin-bottom:6px" data-name="${k}" value="${esc(n[k])}" placeholder="${k}">`).join('')}</div>
    <div class="field"><label>Currency symbol</label><input class="input" id="sCur" value="${esc(data.settings.currency)}" style="max-width:120px"></div>
    <button class="btn primary block" data-action="save-settings">Save settings</button>

    <h3 style="margin-top:26px">Daily reminder</h3>
    <p class="small muted" style="margin-top:-6px">The app always asks you when you open it. You can also let the phone remind you with a notification (Android decides the exact time, usually once a day).</p>
    <button class="btn block" data-action="reminder">🔔 Turn on daily notification</button>

    <h3 style="margin-top:26px">Backup</h3>
    <p class="small muted" style="margin-top:-6px">Your data is stored only on this phone. Make a backup now and then (e.g. send it to yourself on WhatsApp/Drive).</p>
    <div class="btn-row"><button class="btn" data-action="backup">⬇ Save backup file</button>
    <button class="btn" data-action="restore">⬆ Restore from backup</button></div>
    <input type="file" id="restoreFile" accept=".json,application/json" hidden>
    <p class="small muted" style="margin-top:18px">${data.expenses.length} expenses stored · tracking since ${esc(niceDate(data.settings.startDate))}</p>`);
}
function saveSettings() {
  document.querySelectorAll('[data-name]').forEach(i => { if (i.value.trim()) data.settings.names[i.dataset.name] = i.value.trim(); });
  data.settings.currency = $('#sCur').value.trim() || '₹';
  save(); closeSheet(); render(); toast('Settings saved');
}
function backup() {
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'spendwise-backup-' + todayStr() + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Backup saved to Downloads');
}
function restore(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!Array.isArray(d.expenses)) throw new Error();
      if (!confirm('Replace the data on this phone with this backup (' + d.expenses.length + ' expenses)?')) return;
      localStorage.setItem(KEY, JSON.stringify(d)); data = load(); save(); closeSheet(); render(); toast('Backup restored');
    } catch (e) { toast('That file is not a SpendWise backup'); }
  };
  r.readAsText(file);
}

/* ---------- reminders (service worker, best effort) ---------- */
async function syncReminderState() {
  try {
    if (!('caches' in window)) return;
    const c = await caches.open('spendwise-state');
    await c.put('state.json', new Response(JSON.stringify({ logged: Object.keys(data.checkins).concat(data.expenses.map(e => e.date)).filter(d => d >= addDays(todayStr(), -3)) })));
  } catch (e) { /* ignore */ }
}
async function enableReminder() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) { toast('Notifications are not supported here'); return; }
  const p = await Notification.requestPermission();
  if (p !== 'granted') { toast('Notification permission was not given'); return; }
  const reg = await navigator.serviceWorker.ready;
  if ('periodicSync' in reg) {
    try {
      await reg.periodicSync.register('daily-checkin', { minInterval: 12 * 60 * 60 * 1000 });
      toast('Daily reminder is on'); return;
    } catch (e) { /* not allowed, e.g. app not installed */ }
  }
  toast('Install the app to the home screen first, then try again. Or set a daily phone alarm.');
}

/* ---------- sheet ---------- */
function openSheet(html) { $('#sheet').innerHTML = html; $('#sheetWrap').hidden = false; }
function closeSheet() { $('#sheetWrap').hidden = true; $('#sheet').innerHTML = ''; ui.draft = null; }

/* ---------- events ---------- */
document.addEventListener('click', ev => {
  const nav = ev.target.closest('[data-nav]');
  if (nav) {
    ui.view = nav.dataset.nav;
    if (ui.view === 'history' || ui.view === 'report' || ui.view === 'fixed') ui.month = ui.month || todayStr().slice(0, 7);
    render(); window.scrollTo(0, 0); return;
  }
  const whoBtn = ev.target.closest('#fWho button');
  if (whoBtn) { ui.draft.who = whoBtn.dataset.who; document.querySelectorAll('#fWho button').forEach(b => b.classList.toggle('on', b === whoBtn)); return; }
  const catBtn = ev.target.closest('#fCat button');
  if (catBtn) { ui.draft.category = catBtn.dataset.cat; document.querySelectorAll('#fCat button').forEach(b => b.classList.toggle('on', b === catBtn)); return; }

  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  switch (a) {
    case 'add': openExpense({ date: el.dataset.date }); break;
    case 'edit': openExpense({ id: el.dataset.id }); break;
    case 'save-exp': saveExpense(!!el.dataset.more); break;
    case 'del-exp':
      if (confirm('Delete this expense?')) { data.expenses = data.expenses.filter(e => e.id !== ui.draft.id); save(); closeSheet(); render(); toast('Deleted'); }
      break;
    case 'nothing': markNothing(el.dataset.date); closeSheet(); break;
    case 'close-sheet': closeSheet(); break;
    case 'open-bucket': ui.view = 'history'; ui.filter = el.dataset.who; ui.month = todayStr().slice(0, 7); render(); window.scrollTo(0, 0); break;
    case 'filter': ui.filter = el.dataset.f; render(); break;
    case 'month': ui.month = shiftMonth(ui.month, Number(el.dataset.d)); render(); break;
    case 'edit-fixed': openFixed(el.dataset.id); break;
    case 'save-fixed': saveFixed(el.dataset.id); break;
    case 'del-fixed':
      if (confirm('Delete this monthly payment? (Already paid entries stay in your expenses.)')) { data.fixed = data.fixed.filter(f => f.id !== el.dataset.id); save(); closeSheet(); render(); }
      break;
    case 'pay': payFixed(el.dataset.id); break;
    case 'unpay': unpayFixed(el.dataset.id); break;
    case 'pdf-save': createPdf(el.dataset.month, false); break;
    case 'pdf-share': createPdf(el.dataset.month, true); break;
    case 'open-settings': openSettings(); break;
    case 'save-settings': saveSettings(); break;
    case 'backup': backup(); break;
    case 'restore': $('#restoreFile').click(); break;
    case 'reminder': enableReminder(); break;
  }
});
document.addEventListener('change', ev => { if (ev.target.id === 'restoreFile' && ev.target.files[0]) restore(ev.target.files[0]); });
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeSheet(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); maybeDailyPrompt(); } });

/* ---------- start ---------- */
data = load();
ui = { view: 'home', month: todayStr().slice(0, 7), filter: 'all', draft: null };
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW failed', e));
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
save();
render();
setTimeout(maybeDailyPrompt, 400);

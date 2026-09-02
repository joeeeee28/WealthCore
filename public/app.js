// WealthCore client — a single-page application over the real REST API.
// No frameworks, no third-party scripts, no external telemetry. Money values
// are always integers (minor units) from the API and formatted here.

const API = '/api/v1';
const state = {
  token: localStorage.getItem('wc_token') || null,
  csrf: sessionStorage.getItem('wc_csrf') || null,
  user: null,
  config: null,
  locked: false,
  route: 'dashboard',
  demoHint: false,
};

const $app = document.getElementById('app');
const $modal = document.getElementById('modal-root');
const $toast = document.getElementById('toast-root');

/* ---------- helpers ---------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function groupIndian(intStr) {
  let s = String(intStr);
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  if (s.length <= 3) return (neg ? '-' : '') + s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${rest},${last3}`;
}

function sym(currency) {
  return { INR: '\u20B9', USD: '$', EUR: '\u20AC', GBP: '\u00A3', SGD: 'S$', JPY: '\u00A5' }[currency] || '';
}

function fmtMoney(minor, currency = 'INR', compact = true) {
  minor = Number(minor || 0);
  const exp = 2;
  const major = minor / (10 ** exp);
  const abs = Math.abs(major);
  if (compact && abs >= 1e7) return `${sym(currency)}${(major / 1e7).toFixed(2)} Cr`;
  if (compact && abs >= 1e5) return `${sym(currency)}${(major / 1e5).toFixed(2)}L`;
  const [i, d] = major.toFixed(2).split('.');
  return `${sym(currency)}${groupIndian(i)}.${d}`;
}

function fmtPct(x, digits = 1) {
  if (x == null || isNaN(x)) return '—';
  return `${(x * 100).toFixed(digits)}%`;
}

const mutating = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);
async function api(path, { method = 'GET', body, raw } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (mutating.has(method) && state.csrf) headers['X-CSRF-Token'] = state.csrf;
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  if (res.status !== 204) {
    const ct = res.headers.get('content-type') || '';
    json = ct.includes('json') ? await res.json() : await res.text();
  }
  if (!res.ok) {
    if (res.status === 401 && state.token) { clearSession(); }
    if (res.status === 423) { state.locked = true; render(); }
    const msg = (json && json.error && json.error.message) || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return { status: res.status, data: json };
}

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $toast.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function modal(html) {
  $modal.innerHTML = `<div class="modal-backdrop"><div class="modal">${html}</div></div>`;
  $modal.querySelector('.modal-backdrop').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-backdrop')) closeModal();
  });
}

function closeModal() { $modal.innerHTML = ''; }

function setSession(token, user, csrf) {
  state.token = token; state.user = user; state.locked = false;
  state.csrf = csrf || null;
  localStorage.setItem('wc_token', token);
  if (csrf) sessionStorage.setItem('wc_csrf', csrf);
}
function clearSession() {
  state.token = null; state.user = null; state.locked = false; state.csrf = null;
  localStorage.removeItem('wc_token');
  sessionStorage.removeItem('wc_csrf');
}

/* ---------- SVG charts ---------- */
function lineChart(points, { width = 640, height = 180 } = {}) {
  const vals = points.map((p) => p.v);
  const min = Math.min(...vals, 0);
  const max = Math.max(...vals, 1);
  const n = points.length;
  const pad = 16;
  const x = (i) => pad + (i / Math.max(n - 1, 1)) * (width - pad * 2);
  const y = (v) => height - pad - ((v - min) / (max - min || 1)) * (height - pad * 2);
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const dots = points.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3" fill="#1d4ed8"/>`).join('');
  const labels = points.map((p, i) => `<text x="${x(i).toFixed(1)}" y="${height - 2}" font-size="10" fill="#94a3b8" text-anchor="middle">${esc(p.label)}</text>`).join('');
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img">
    <line x1="${pad}" y1="${y(0)}" x2="${width - pad}" y2="${y(0)}" stroke="#e2e8f0" stroke-width="1"/>
    <path d="${line}" fill="none" stroke="#1d4ed8" stroke-width="2.5" stroke-linecap="round"/>${dots}${labels}</svg>`;
}

function bars(items, { width = 640, height = 180 } = {}) {
  const max = Math.max(...items.map((i) => i.v), 1);
  const pad = 16; const bw = (width - pad * 2) / items.length;
  const h = height - pad * 2;
  const rects = items.map((it, i) => {
    const bh = (it.v / max) * h;
    const x = pad + i * bw + bw * 0.18;
    const y = height - pad - bh;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${bh.toFixed(1)}" rx="4" fill="${it.color || '#7c3aed'}">
      <title>${esc(it.label)}: ${it.title || it.v}</title></rect>
      <text x="${(x + bw * 0.32).toFixed(1)}" y="${height - 2}" font-size="9" fill="#94a3b8" text-anchor="middle">${esc(it.label)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img">${rects}</svg>`;
}

function donut(parts, size = 130) {
  const total = parts.reduce((a, p) => a + p.v, 0) || 1;
  let acc = 0;
  const segs = parts.map((p, i) => {
    const a0 = (acc / total) * 2 * Math.PI - Math.PI / 2;
    acc += p.v;
    const a1 = (acc / total) * 2 * Math.PI - Math.PI / 2;
    const x0 = 50 + 40 * Math.cos(a0), y0 = 50 + 40 * Math.sin(a0);
    const x1 = 50 + 40 * Math.cos(a1), y1 = 50 + 40 * Math.sin(a1);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `<path d="M50,50 L${x0.toFixed(1)},${y0.toFixed(1)} A40,40 0 ${large} 1 ${x1.toFixed(1)},${y1.toFixed(1)} Z" fill="${p.color}" opacity="0.9">
      <title>${esc(p.label)}: ${p.title || p.v}</title></path>`;
  }).join('');
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" role="img">${segs}<circle cx="50" cy="50" r="24" fill="#ffffff"/><text x="50" y="54" text-anchor="middle" font-size="9" font-weight="700" fill="#0f172a">${(parts[0] && parts[0].center) || ''}</text></svg>`;
}

const PALETTE = ['#1d4ed8', '#7c3aed', '#16a34a', '#f59e0b', '#dc2626', '#06b6d4', '#8b5cf6', '#64748b', '#0ea5e9', '#84cc16'];

/* ---------- Router ---------- */
const routes = {
  dashboard: { label: 'Dashboard', icon: '\u25A6', fn: viewDashboard },
  accounts: { label: 'Accounts', icon: '\u25A4', fn: viewAccounts },
  transactions: { label: 'Transactions', icon: '\u2261', fn: viewTransactions },
  portfolio: { label: 'Portfolio', icon: '\u2686', fn: viewPortfolio },
  networth: { label: 'Net Worth', icon: '\u25A0', fn: viewNetWorth },
  budgets: { label: 'Budgets', icon: '\u25A1', fn: viewBudgets },
  goals: { label: 'Goals', icon: '\u2605', fn: viewGoals },
  reports: { label: 'Reports', icon: '\u25B2', fn: viewReports },
  calculators: { label: 'Calculators', icon: '\u2211', fn: viewCalculators },
  reconciliation: { label: 'Reconciliation', icon: '\u21C4', fn: viewReconciliation },
  import: { label: 'Import', icon: '\u20E3', fn: viewImport },
  notifications: { label: 'Notifications', icon: '\u25D0', fn: viewNotifications },
  ai: { label: 'AI Assistant', icon: '\u25C9', fn: viewAi },
  integrations: { label: 'Integrations', icon: '\u2699', fn: viewIntegrations },
  settings: { label: 'Settings', icon: '\u25F1', fn: viewSettings },
};

function render() {
  if (state.locked) { renderLock(); return; }
  if (!state.config) return;
  if (state.config.setupRequired && !state.token) { renderSetup(); return; }
  if (!state.token) { renderLogin(); return; }

  const nav = Object.entries(routes).map(([key, r]) =>
    `<a class="nav-item ${state.route === key ? 'active' : ''}" href="#${key}"><span class="ic">${r.icon}</span>${r.label}</a>`).join('');

  $app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="logo">W</div>
          <div><div class="name">WealthCore</div><span class="tag">One Intelligent Core</span></div>
        </div>
        <div class="nav-label">Overview</div>
        ${nav}
        <div class="foot">
          <div class="row"><span>${esc(state.user?.name || 'User')}</span><button class="btn ghost sm" data-action="logout">Sign out</button></div>
          <div class="row"><span class="small">${esc(state.user?.email || '')}</span></div>
        </div>
      </aside>
      <main class="main" id="view-wrap"></main>
    </div>`;

  routes[state.route].fn();
}

function renderSetup() {
  $app.innerHTML = `
    <div class="auth-wrap"><div class="auth-card">
      <div class="brand2"><div class="logo">W</div> WealthCore</div>
      <p class="lead">Your Entire Financial Life. One Intelligent Core. Set up your private personal financial operating system.</p>
      <div id="setup-msg"></div>
      <form id="setup-form">
        <div class="field"><label>Full name</label><input class="input" name="name" required /></div>
        <div class="field"><label>Email</label><input class="input" name="email" type="email" required /></div>
        <div class="field"><label>Password (8+ characters)</label><input class="input" name="password" type="password" minlength="8" required /></div>
        <button class="btn primary block" type="submit">Create my WealthCore</button>
      </form>
      <p class="small muted mt">This is a private, single-user app. Your data stays on this device.</p>
    </div></div>`;
  document.getElementById('setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const { data } = await api('/auth/setup', { method: 'POST', body: { name: fd.get('name'), email: fd.get('email'), password: fd.get('password') } });
      setSession(data.token, data.user, data.csrf);
      await bootstrap();
    } catch (err) {
      document.getElementById('setup-msg').innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });
}

function renderLogin() {
  $app.innerHTML = `
    <div class="auth-wrap"><div class="auth-card">
      <div class="brand2"><div class="logo">W</div> WealthCore</div>
      <p class="lead">Sign in to your private financial operating system.</p>
      <div id="login-msg"></div>
      <form id="login-form">
        <div class="field"><label>Email</label><input class="input" name="email" type="email" required /></div>
        <div class="field"><label>Password</label><input class="input" name="password" type="password" required /></div>
        <button class="btn primary block" type="submit">Sign in</button>
      </form>
    </div></div>`;
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const { data } = await api('/auth/login', { method: 'POST', body: { email: fd.get('email'), password: fd.get('password') } });
      setSession(data.token, data.user, data.csrf);
      await bootstrap();
    } catch (err) {
      document.getElementById('login-msg').innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });
}

function renderLock() {
  $app.innerHTML = `
    <div class="lock-overlay"><div class="auth-card" style="background:#fff;color:#0f172a">
      <div class="brand2"><div class="logo">W</div> WealthCore</div>
      <p class="lead">Your app is locked. Enter your PIN to continue.</p>
      <div id="lock-msg"></div>
      <form id="lock-form">
        <div class="field"><label>PIN</label><input class="input" name="pin" type="password" inputmode="numeric" required /></div>
        <button class="btn primary block" type="submit">Unlock</button>
      </form>
      <button class="btn ghost block mt" data-action="logout">Sign out instead</button>
    </div></div>`;
  document.getElementById('lock-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = new FormData(e.target).get('pin');
    try {
      await api('/auth/unlock', { method: 'POST', body: { pin } });
      state.locked = false; render();
    } catch (err) {
      document.getElementById('lock-msg').innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });
}

// Only one global handler is registered for data-action clicks.
function wireGlobalActions() {
  if (wireGlobalActions._done) return;
  wireGlobalActions._done = true;
  document.body.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (action === 'logout') {
      try { await api('/auth/logout', { method: 'POST' }); } catch {}
      clearSession();
      const { data } = await api('/config');
      state.config = data; render();
    }
  });
}

async function bootstrap() {
  const { data } = await api('/config');
  state.config = data;
  if (state.token) {
    try {
      const me = await api('/auth/me');
      state.user = me.data.user;
      state.locked = me.data.session.locked;
      state.demoHint = !!me.data.session.locked;
    } catch {
      clearSession();
    }
  }
  render();
}

/* =========================================================
   VIEWS
   ========================================================= */

async function viewDashboard() {
  const w = document.getElementById('view-wrap');
  w.innerHTML = `<div class="grid c4" id="kpis"><div class="skeleton" style="height:90px"></div><div class="skeleton" style="height:90px"></div><div class="skeleton" style="height:90px"></div><div class="skeleton" style="height:90px"></div></div>
    <div class="grid c2 mt"><div class="skeleton" style="height:260px"></div><div class="skeleton" style="height:260px"></div></div>`;
  let d;
  try { d = (await api('/dashboard')).data; }
  catch (err) { w.innerHTML = `<div class="alert error">${esc(err.message)}</div>`; return; }

  const nw = d.netWorth;
  const trend = [...d.snapshots].reverse();
  const topExp = d.topExpenses;
  w.innerHTML = `
    <div class="topbar"><div><h1>Dashboard</h1><div class="sub">Your complete financial position, ${esc(d.month)}</div></div>
      <button class="btn primary" data-action="add-account">+ Add account</button></div>
    ${d.demoCount ? `<div class="alert warn"><b>Demo data</b> — ${d.demoCount} sample account${d.demoCount === 1 ? '' : 's'} present. This is clearly-labelled MANUAL/SANDBOX data. Connect a real account to replace it.</div>` : ''}
    <div class="grid c4">
      ${kpi('Net Worth', fmtMoney(nw.netWorthMinor), 'Assets − Liabilities')}
      ${kpi('Total Assets', fmtMoney(nw.totalAssetsMinor), `${nw.accountCount + ' accounts'}`)}
      ${kpi('Liabilities', fmtMoney(nw.totalLiabilitiesMinor), 'Loans & credit')}
      ${kpi('Savings Rate', fmtPct(d.savingsRate), `${fmtMoney(d.incomeMinor)} in / ${fmtMoney(d.expenseMinor)} out`)}
    </div>
    <div class="grid c2 mt">
      <div class="card"><div class="section-title">Net Worth Over Time <span class="small muted">Last ${trend.length} snapshots</span></div>
        ${trend.length ? lineChart(trend.map((s) => ({ label: s.asOf.slice(5), v: s.netWorthMinor })), { height: 200 }) : `<div class="empty"><div class="big">◔</div>Take a snapshot to see your trend.</div>`}
      </div>
      <div class="card"><div class="section-title">Monthly Cash Flow</div>
        ${bars([{ label: 'Income', v: d.incomeMinor, color: '#16a34a', title: fmtMoney(d.incomeMinor) }, { label: 'Expenses', v: d.expenseMinor, color: '#dc2626', title: fmtMoney(d.expenseMinor) }], { height: 200 })}
      </div>
    </div>
    <div class="grid c3 mt">
      <div class="card"><div class="section-title">Allocation</div>
        ${d.allocation.length ? donut(d.allocation.slice(0, 6).map((a, i) => ({ label: a.name, v: a.valueMinor, color: PALETTE[i % PALETTE.length], title: fmtMoney(a.valueMinor) }))) : `<div class="empty">No investments yet.</div>`}
        ${d.allocation.slice(0, 6).map((a) => `<div class="flex between small mt" style="gap:8px"><span><b>${esc(a.name)}</b></span><span class="muted">${fmtPct(a.pct,0)}</span></div>`).join('')}
      </div>
      <div class="card"><div class="section-title">Top Expenses ${esc(d.month)}</div>
        ${topExp.length ? topExp.map((t) => `<div class="flex between small" style="padding:6px 0;border-bottom:1px solid var(--surface-3)"><span>${esc(t.category)}</span><b>${fmtMoney(t.totalMinor)}</b></div>`).join('') : `<div class="empty">No expenses this month.</div>`}
      </div>
      <div class="card"><div class="section-title">Portfolio</div>
        <div class="kpi"><span class="label">Current value</span><span class="value">${fmtMoney(d.portfolio.totalValueMinor)}</span></div>
        <div class="kpi mt"><span class="label">Total P&amp;L</span><span class="value ${d.portfolio.totalPnlMinor >= 0 ? 'pos' : 'neg'}">${fmtMoney(d.portfolio.totalPnlMinor)}</span></div>
        <div class="small muted mt">${d.portfolio.holdingsCount} holdings · ${unpricedLabel(d.portfolio.unpricedCount)}</div>
      </div>
    </div>
    ${d.notifications.filter((n) => !n.read).slice(0, 3).map((n) => `<div class="alert info mt"><div><b>${esc(n.title)}</b><div class="small">${esc(n.body || '')}</div></div></div>`).join('')}`;
  document.querySelector('[data-action="add-account"]').addEventListener('click', openAccountModal);
  wireDashboardActions(d);
}

function kpi(label, value, hint) {
  return `<div class="card kpi"><span class="label">${esc(label)}</span><span class="value">${value}</span><span class="hint">${esc(hint)}</span></div>`;
}
function unpricedLabel(n) { return n ? `${n} without a current price (shown at cost)` : 'all priced'; }
function wireDashboardActions() {}

/* ----- Accounts ----- */
async function viewAccounts() {
  const w = document.getElementById('view-wrap');
  w.innerHTML = `<div class="topbar"><div><h1>Accounts</h1><div class="sub">Bank, credit, loans & investments</div></div><button class="btn primary" data-action="add-account">+ Add account</button></div><div class="card" id="accounts-body"><div class="skeleton" style="height:120px"></div></div>`;
  document.querySelector('[data-action="add-account"]').addEventListener('click', openAccountModal);
  const { data } = await api('/accounts');
  const assets = data.filter((a) => !a.isLiability);
  const liabs = data.filter((a) => a.isLiability);
  const row = (a) => `<tr>
    <td><b>${esc(a.name)}</b><div class="small muted">${esc(a.type)}${a.institution ? ' · ' + esc(a.institution) : ''}</div></td>
    <td class="right bold">${fmtMoney(a.balanceMinor, a.currency)}</td>
    <td class="right">${statusChip(a.source, a.aaStatus)}</td>
    <td class="right"><button class="btn ghost sm" data-edit-account="${a.id}">Edit</button></td></tr>`;
  document.getElementById('accounts-body').innerHTML = `
    ${data.length === 0 ? `<div class="empty"><div class="big">▦</div>No accounts yet. Add your first financial account.</div>` : ''}
    ${assets.length ? `<h3 class="section-title">Assets</h3><div class="tbl-wrap"><table><thead><tr><th>Account</th><th class="right">Balance</th><th class="right">Source</th><th class="right"></th></tr></thead><tbody>${assets.map(row).join('')}</tbody></table></div>` : ''}
    ${liabs.length ? `<h3 class="section-title mt">Liabilities</h3><div class="tbl-wrap"><table><thead><tr><th>Liability</th><th class="right">Outstanding</th><th class="right">Source</th><th class="right"></th></tr></thead><tbody>${liabs.map(row).join('')}</tbody></table></div>` : ''}`;
  document.querySelectorAll('[data-edit-account]').forEach((b) => b.addEventListener('click', () => openAccountModal(data.find((a) => a.id === Number(b.dataset.editAccount)))));
}

function statusChip(source, aaStatus) {
  if (source === 'manual') return `<span class="chip gray">Manual</span>`;
  if (aaStatus === 'LIVE') return `<span class="chip green">AA Live</span>`;
  return `<span class="chip amber">AA</span>`;
}

function openAccountModal(account) {
  const isEdit = !!account;
  modal(`
    <span class="close" data-close>×</span>
    <h3>${isEdit ? 'Edit account' : 'Add account'}</h3>
    <p class="lead">${isEdit ? 'Update account details.' : 'Add a bank, credit, loan or investment account.'}</p>
    <form id="acct-form">
      <div class="field"><label>Name</label><input class="input" name="name" value="${esc(account?.name || '')}" required /></div>
      <div class="field"><label>Type</label><select name="type">
        ${['savings','current','credit','brokerage','mutual_fund','loan','fd','crypto','real_estate','other'].map((t) => `<option value="${t}" ${account?.type === t ? 'selected' : ''}>${t.replace('_',' ')}</option>`).join('')}
      </select></div>
      <div class="row"><div class="field grow"><label>Balance (in ₹) </label><input class="input" name="balance" type="number" step="0.01" value="${account ? (Number(account.balanceMinor) / 100) : ''}" /></div>
      <div class="field grow"><label>Institution</label><input class="input" name="institution" value="${esc(account?.institution || '')}" /></div></div>
      <div class="field"><label><input type="checkbox" name="isLiability" ${account?.isLiability ? 'checked' : ''} /> This is a liability (loan / credit card)</label></div>
      <div class="form-actions"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" type="submit">${isEdit ? 'Save' : 'Add'}</button></div>
    </form>`);
  wireModalClose();
  document.getElementById('acct-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      name: fd.get('name'), type: fd.get('type'), institution: fd.get('institution') || undefined,
      balanceMinor: Math.round(Number(fd.get('balance') || 0) * 100),
      isLiability: fd.get('isLiability') === 'on', source: 'manual',
    };
    try {
      if (isEdit) await api(`/accounts/${account.id}`, { method: 'PUT', body });
      else await api('/accounts', { method: 'POST', body });
      closeModal(); toast('Account saved', 'success'); render();
    } catch (err) { toast(err.message, 'error'); }
  });
}

/* ----- Transactions ----- */
async function viewTransactions() {
  const w = document.getElementById('view-wrap');
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  w.innerHTML = `
    <div class="topbar"><div><h1>Transactions</h1><div class="sub">Income, expenses, transfers & recurring payments</div></div>
      <div class="row"><button class="btn ghost" data-action="detect-transfers">Detect transfers</button><button class="btn ghost" data-action="detect-recurring">Recurring</button><button class="btn primary" data-action="add-txn">+ Add transaction</button></div></div>
    <div class="card">
      <div class="row mb"><div class="field grow"><label>Month</label><input class="input" type="month" name="month" value="${ym}" /></div>
      <div class="field grow"><label>Search</label><input class="input" name="search" placeholder="Merchant or note" /></div>
      <div class="field"><label>&nbsp;</label><button class="btn ghost" data-action="refresh-txn">Filter</button></div></div>
      <div id="txn-body"><div class="skeleton" style="height:160px"></div></div>
    </div>`;
  document.querySelector('[data-action="add-txn"]').addEventListener('click', openTxnModal);
  document.querySelector('[data-action="detect-transfers"]').addEventListener('click', detectTransfers);
  document.querySelector('[data-action="detect-recurring"]').addEventListener('click', showRecurring);
  document.querySelector('[data-action="refresh-txn"]').addEventListener('click', () => loadTxn(w));
  await loadTxn(w);
}

async function loadTxn(w) {
  const month = w.querySelector('[name="month"]').value;
  const search = w.querySelector('[name="search"]').value;
  const { data } = await api(`/transactions?month=${month}&search=${encodeURIComponent(search)}&limit=200`);
  const body = document.getElementById('txn-body');
  const rows = data.transactions;
  body.innerHTML = rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Account</th><th>Merchant / Note</th><th>Category</th><th class="right">Amount</th><th></th></tr></thead><tbody>
    ${rows.map((t) => `<tr>
      <td class="muted">${esc(t.date)}</td><td>${esc(t.account_name || '—')}</td>
      <td><b>${esc(t.merchant || '—')}</b>${t.is_transfer ? ' <span class="chip blue">transfer</span>' : ''}${t.is_recurring ? ' <span class="chip purple">recurring</span>' : ''}</td>
      <td>${esc(t.category_name || 'Uncategorized')}</td>
      <td class="right ${t.direction === 'in' ? 'pos' : 'neg'}">${t.direction === 'in' ? '+' : '−'}${fmtMoney(t.amount_minor, t.currency)}</td>
      <td class="right"><button class="btn ghost sm" data-edit-txn="${t.id}">Edit</button></td></tr>`).join('')}
  </tbody></table></div><div class="small muted mt">${headerCount(rows)} of ${data.total} records</div>`
  : `<div class="empty"><div class="big">≡</div>No transactions for this period.</div>`;
  document.querySelectorAll('[data-edit-txn]').forEach((b) => b.addEventListener('click', () => openTxnModal(rows.find((t) => t.id === Number(b.dataset.editTxn)))));
}
function headerCount(rows) { return `${rows.length}`; }

function openTxnModal(txn) {
  modal(`
    <span class="close" data-close>×</span>
    <h3>${txn ? 'Edit transaction' : 'Add transaction'}</h3>
    <p class="lead">Transactions are validated, deduplicated and auto-categorised.</p>
    <form id="txn-form">
      <div class="row"><div class="field grow"><label>Date</label><input class="input" name="date" type="date" value="${esc(txn?.date || new Date().toISOString().slice(0, 10))}" required /></div>
      <div class="field grow"><label>Amount (₹)</label><input class="input" name="amount" type="number" step="0.01" value="${txn ? (Number(txn.amount_minor) / 100) : ''}" required /></div></div>
      <div class="row"><div class="field grow"><label>Direction</label><select name="direction"><option value="out" ${txn?.direction === 'out' ? 'selected' : ''}>Money out</option><option value="in" ${txn?.direction === 'in' ? 'selected' : ''}>Money in</option></select></div>
      <div class="field grow"><label>Account</label><select name="accountId" id="txn-account"></select></div></div>
      <div class="field"><label>Merchant</label><input class="input" name="merchant" value="${esc(txn?.merchant || '')}" placeholder="e.g. BigBasket Groceries" /></div>
      <div class="field"><label>Note</label><input class="input" name="note" value="${esc(txn?.note || '')}" /></div>
      <div class="form-actions"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" type="submit">${txn ? 'Save' : 'Add'}</button></div>
    </form>`);
  wireModalClose();
  // load accounts
  api('/accounts').then(({ data }) => {
    document.getElementById('txn-account').innerHTML = data.filter((a) => !a.isLiability).map((a) =>
      `<option value="${a.id}" ${txn && Number(txn.account_id) === Number(a.id) ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
  });
  document.getElementById('txn-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = { accountId: Number(fd.get('accountId')), date: fd.get('date'), amountMinor: Math.round(Number(fd.get('amount')) * 100), direction: fd.get('direction'), merchant: fd.get('merchant') || undefined, note: fd.get('note') || undefined, currency: 'INR' };
    try {
      if (txn) await api(`/transactions/${txn.id}`, { method: 'PUT', body });
      else await api('/transactions', { method: 'POST', body });
      closeModal(); toast('Transaction saved', 'success'); render();
    } catch (err) { toast(err.message, 'error'); }
  });
}

async function detectTransfers() {
  try {
    const { data } = await api('/transactions/intelligence/detect-transfers');
    modal(`<span class="close" data-close>×</span><h3>Transfer detection</h3><p class="lead">${data.count} potential internal transfer${data.count === 1 ? '' : 's'} found.</p><div class="empty">${data.count ? 'Transfers are marked in the transactions view.' : 'No paired in/out transactions detected.'}</div>`);
    wireModalClose();
  } catch (e) { toast(e.message, 'error'); }
}
async function showRecurring() {
  const { data } = await api('/transactions/intelligence/recurring');
  modal(`<span class="close" data-close>×</span><h3>Recurring payments</h3>${data.recurring.length ? data.recurring.map((r) => `<div class="flex between small" style="padding:6px 0;border-bottom:1px solid var(--surface-3)"><span>${esc(r.merchant)}</span><b>${fmtMoney(r.amountMinor)} · ${r.months}mo</b></div>`).join('') : `<div class="empty">No recurring patterns detected.</div>`}`);
  wireModalClose();
}

/* ----- Portfolio ----- */
async function viewPortfolio() {
  const w = document.getElementById('view-wrap');
  w.innerHTML = `<div class="topbar"><div><h1>Portfolio</h1><div class="sub">Holdings, cost basis & market value</div></div>
    <div class="row"><button class="btn ghost" data-action="add-security">+ Security</button><button class="btn primary" data-action="add-holding">+ Add holding</button><button class="btn ghost" data-action="refresh-prices">Refresh prices</button></div></div>
    <div class="grid c3" id="pf-summary"></div><div class="card mt"><div id="pf-body"><div class="skeleton" style="height:180px"></div></div></div>`;
  document.querySelector('[data-action="add-security"]').addEventListener('click', openSecurityModal);
  document.querySelector('[data-action="add-holding"]').addEventListener('click', openHoldingModal);
  document.querySelector('[data-action="refresh-prices"]').addEventListener('click', refreshPrices);
  const { data } = await api('/portfolio');
  document.getElementById('pf-summary').innerHTML = `
    ${kpi('Market value', fmtMoney(data.totalValueMinor), `${data.holdingsCount} holdings`)}
    ${kpi('Invested (cost)', fmtMoney(data.totalCostMinor), 'cost basis')}
    ${kpi('P&L', `+${fmtMoney(data.totalPnlMinor)}`, fmtPct(data.totalPnlPct))}`;
  const body = document.getElementById('pf-body');
  body.innerHTML = data.holdings.length ? `<div class="tbl-wrap"><table><thead><tr><th>Security</th><th class="right">Qty</th><th class="right">Cost</th><th class="right">Price</th><th class="right">Value</th><th class="right">P&L</th><th>Status</th><th></th></tr></thead><tbody>
    ${data.holdings.map((h) => `<tr>
      <td><b>${esc(h.securityName)}</b><div class="small muted">${esc(h.assetClass)}·${esc(h.exchange || 'N/A')}${h.priceMissing ? ' · <span class="chip amber">no price</span>' : ''}</div></td>
      <td class="right">${esc(h.quantity)}</td><td class="right">${fmtMoney(h.costBasisMinor, h.currency)}</td>
      <td class="right"><button class="btn ghost sm" data-price="${h.holdingId}">${h.priceMinor != null ? fmtMoney(h.priceMinor, h.currency) : '—'}</button></td>
      <td class="right bold">${fmtMoney(h.currentValueMinor, h.currency)}</td>
      <td class="right ${h.pnlMinor >= 0 ? 'pos' : 'neg'}">${h.pnlMinor >= 0 ? '+' : ''}${fmtMoney(h.pnlMinor, h.currency)}</td>
      <td class="right"><span class="status ${h.priceStatus}">${h.priceStatus.replace('_', ' ')}</span></td>
      <td class="right"><button class="btn ghost sm" data-holding="${h.holdingId}">Edit</button></td></tr>`).join('')}
  </tbody></table></div><div class="small muted mt">Invariant check: ${data.validation.invariantHolds ? '✓' : '✗'} quantity × price = value (${data.validation.mismatches} mismatch)</div>`
  : `<div class="empty"><div class="big">⊞</div>No holdings yet. Add a security and a holding.</div>`;
  document.querySelectorAll('[data-price]').forEach((b) => b.addEventListener('click', () => openPriceModal(Number(b.dataset.price))));
  document.querySelectorAll('[data-holding]').forEach((b) => b.addEventListener('click', () => openHoldingModal(Number(b.dataset.holding))));
}

function openSecurityModal() {
  modal(`<span class="close" data-close>×</span><h3>Add security</h3><p class="lead">Register a stock, fund, gold, crypto or other asset.</p>
    <form id="sec-form">
      <div class="field"><label>Name</label><input class="input" name="name" required /></div>
      <div class="row"><div class="field grow"><label>Ticker</label><input class="input" name="ticker" /></div><div class="field grow"><label>Exchange</label><input class="input" name="exchange" /></div></div>
      <div class="row"><div class="field grow"><label>Asset class</label><select name="assetClass">${['equity','mutual_fund','etf','gold','silver','crypto','bond','real_estate','fd','other'].map((c) => `<option value="${c}">${c.replace('_',' ')}</option>`).join('')}</select></div>
      <div class="field grow"><label>Currency</label><select name="currency">${['INR','USD','EUR','SGD','GBP'].map((c) => `<option>${c}</option>`).join('')}</select></div></div>
      <div class="row"><div class="field grow"><label>Current price (₹)</label><input class="input" name="price" type="number" step="0.01" /></div>
        <div class="field"><label>Status</label><select name="priceStatus"><option value="MANUAL">MANUAL</option><option value="LAST_AVAILABLE">LAST AVAILABLE</option><option value="DELAYED">DELAYED</option></select></div></div>
      <div class="form-actions"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" type="submit">Add</button></div></form>`);
  wireModalClose();
  document.getElementById('sec-form').addEventListener('submit', async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    try {
      await api('/securities', { method: 'POST', body: { name: fd.get('name'), ticker: fd.get('ticker') || undefined, exchange: fd.get('exchange') || undefined, assetClass: fd.get('assetClass'), currency: fd.get('currency'), priceMinor: fd.get('price') ? Math.round(Number(fd.get('price')) * 100) : null, priceStatus: fd.get('priceStatus') } });
      closeModal(); toast('Security added', 'success'); render();
    } catch (err) { toast(err.message, 'error'); }
  });
}

function openHoldingModal(holdingId) {
  api('/securities').then(({ data: securities }) => {
    modal(`<span class="close" data-close>×</span><h3>${holdingId ? 'Edit holding' : 'Add holding'}</h3>
      <form id="hold-form">
        <div class="field"><label>Security</label><select name="securityId">${securities.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Account</label><select name="accountId"><option value="">— none —</option></select></div>
        <div class="row"><div class="field grow"><label>Quantity</label><input class="input" name="quantity" type="number" step="any" required /></div>
        <div class="field grow"><label>Cost basis (₹)</label><input class="input" name="cost" type="number" step="0.01" value="0" /></div></div>
        <div class="form-actions"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" type="submit">Save</button></div></form>`);
    wireModalClose();
    const acctSel = document.querySelector('[name="accountId"]');
    api('/accounts').then(({ data }) => acctSel.innerHTML = data.filter((a) => ['brokerage','mutual_fund','crypto','other'].includes(a.type)).map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join(''));
    document.getElementById('hold-form').addEventListener('submit', async (e) => {
      e.preventDefault(); const fd = new FormData(e.target);
      const body = { securityId: Number(fd.get('securityId')), accountId: fd.get('accountId') ? Number(fd.get('accountId')) : undefined, quantity: fd.get('quantity'), costBasisMinor: Math.round(Number(fd.get('cost')) * 100) };
      try {
        if (holdingId) await api(`/holdings/${holdingId}`, { method: 'PUT', body });
        else await api('/holdings', { method: 'POST', body });
        closeModal(); toast('Holding saved', 'success'); render();
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}

function openPriceModal(holdingId) {
  modal(`<span class="close" data-close>×</span><h3>Update price</h3><p class="lead">Set a manual / last-known price. We never claim real-time pricing without a real provider.</p>
    <form id="price-form"><div class="field"><label>New price (₹)</label><input class="input" name="price" type="number" step="0.01" required /></div>
      <div class="field"><label>Status</label><select name="priceStatus"><option value="MANUAL">MANUAL</option><option value="LAST_AVAILABLE">LAST AVAILABLE</option></select></div>
      <div class="form-actions"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" type="submit">Save</button></div></form>`);
  wireModalClose();
  document.getElementById('price-form').addEventListener('submit', async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    try {
      // find security by holding via portfolio
      const { data } = await api('/portfolio');
      const h = data.holdings.find((x) => Number(x.holdingId) === holdingId);
      if (!h) throw new Error('Holding not found');
      await api(`/securities/${h.securityId}`, { method: 'PUT', body: { priceMinor: Math.round(Number(fd.get('price')) * 100), priceStatus: fd.get('priceStatus'), provider: 'manual' } });
      closeModal(); toast('Price updated', 'success'); render();
    } catch (err) { toast(err.message, 'error'); }
  });
}

async function refreshPrices() {
  try {
    const { data } = await api('/market/refresh', { method: 'POST' });
    toast(data.status === 'READY_FOR_CONFIGURATION' ? `Market data: ${data.message}` : 'Prices refreshed', 'info');
    render();
  } catch (e) { toast(e.message, 'error'); }
}

/* ----- Net Worth ----- */
async function viewNetWorth() {
  const w = document.getElementById('view-wrap');
  w.innerHTML = `<div class="topbar"><div><h1>Net Worth</h1><div class="sub">Assets − Liabilities, from a single source of truth</div></div>
    <button class="btn primary" data-action="snapshot">Take snapshot</button></div>
    <div class="grid c3" id="nw-kpis"></div><div class="grid c2 mt"><div class="card" id="nw-breakdown"></div><div class="card"><div class="section-title">Snapshots</div><div id="nw-snapshots"></div></div></div>`;
  document.querySelector('[data-action="snapshot"]').addEventListener('click', async () => {
    try { await api('/net-worth/snapshot', { method: 'POST', body: {} }); toast('Snapshot recorded', 'success'); render(); } catch (e) { toast(e.message, 'error'); }
  });
  const [{ data: nw }, { data: snaps }] = await Promise.all([api('/net-worth'), api('/net-worth/snapshots')]);
  document.getElementById('nw-kpis').innerHTML = `
    ${kpi('Total Assets', fmtMoney(nw.totalAssetsMinor), 'cash + investments')}
    ${kpi('Total Liabilities', fmtMoney(nw.totalLiabilitiesMinor), 'loans & credit')}
    ${kpi('Net Worth', fmtMoney(nw.netWorthMinor), 'assets − liabilities')}`;
  const classes = nw.assetClassBreakdown || [];
  document.getElementById('nw-breakdown').innerHTML = `<div class="section-title">Asset breakdown</div>
    ${classes.length ? `<div style="display:flex;gap:24px;align-items:center"><div>${donut(classes.slice(0, 8).map((a, i) => ({ label: a.name, v: a.valueMinor, color: PALETTE[i % PALETTE.length], title: fmtMoney(a.valueMinor) })))}</div>
      <div style="flex:1">${classes.map((a) => `<div class="flex between small" style="padding:4px 0;border-bottom:1px solid var(--surface-3)"><span>${esc(a.name)}</span><b>${fmtMoney(a.valueMinor)}</b></div>`).join('')}</div></div>` : `<div class="empty">No assets yet.</div>`}`;
  document.getElementById('nw-snapshots').innerHTML = snaps.length ? snaps.map((s) => `<div class="flex between small" style="padding:8px 0;border-bottom:1px solid var(--surface-3)"><span class="muted">${esc(s.as_of)}</span><b>${fmtMoney(s.net_worth_minor)}</b></div>`).join('') : `<div class="empty">No snapshots yet.</div>`;
}

/* ----- Budgets ----- */
async function viewBudgets() {
  const w = document.getElementById('view-wrap');
  w.innerHTML = `<div class="topbar"><div><h1>Budgets</h1><div class="sub">Monthly spending limits per category</div></div><button class="btn primary" data-action="add-budget">+ Add budget</button></div>
    <div class="card" id="budget-body"><div class="skeleton" style="height:180px"></div></div>`;
  document.querySelector('[data-action="add-budget"]').addEventListener('click', () => openBudgetModal());
  const { data } = await api('/budgets');
  const { data: cats } = await api('/categories');
  document.getElementById('budget-body').innerHTML = data.length ? data.map((b) => `
    <div class="mb">
      <div class="flex between"><div><b>${esc(b.category_name || 'All')}</b> <span class="small muted">· ${esc(b.period)}</span></div>
        <span class="small ${b.percentSpent > 1 ? 'neg' : 'muted'}">${fmtMoney(b.spentMinor, b.currency)} of ${fmtMoney(b.amount_minor, b.currency)} (${fmtPct(b.percentSpent, 0)})</span></div>
      <div class="progress mt" style="margin-top:6px"><span style="width:${Math.min(b.percentSpent * 100, 100).toFixed(1)}%;background:${b.percentSpent > 1 ? 'var(--red)' : 'var(--grad)'}"></span></div>
    </div>`).join('') : `<div class="empty"><div class="big">▤</div>No budgets yet. ${cats.length ? '' : 'Create categories first.'}</div>`;
}

function openBudgetModal() {
  api('/categories').then(({ data: cats }) => {
    modal(`<span class="close" data-close>×</span><h3>Add budget</h3><form id="bud-form">
      <div class="field"><label>Category</label><select name="categoryId">${cats.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Monthly limit (₹)</label><input class="input" name="amount" type="number" step="0.01" required /></div>
      <div class="form-actions"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" type="submit">Save</button></div></form>`);
    wireModalClose();
    document.getElementById('bud-form').addEventListener('submit', async (e) => { e.preventDefault(); const fd = new FormData(e.target);
      try { await api('/budgets', { method: 'POST', body: { categoryId: Number(fd.get('categoryId')), amountMinor: Math.round(Number(fd.get('amount')) * 100), currency: 'INR' } }); closeModal(); toast('Budget saved', 'success'); render(); } catch (err) { toast(err.message, 'error'); } });
  });
}

/* ----- Goals ----- */
async function viewGoals() {
  const w = document.getElementById('view-wrap');
  w.innerHTML = `<div class="topbar"><div><h1>Goals</h1><div class="sub">Track progress toward your financial targets</div></div><button class="btn primary" data-action="add-goal">+ Add goal</button></div>
    <div class="grid c3" id="goal-body"><div class="skeleton" style="height:150px"></div></div>`;
  document.querySelector('[data-action="add-goal"]').addEventListener('click', () => openGoalModal());
  const { data } = await api('/goals');
  document.getElementById('goal-body').innerHTML = data.length ? data.map((g) => `<div class="card">
    <div class="flex between"><b>${esc(g.name)}</b><span class="chip ${g.progress >= 1 ? 'green' : 'blue'}">${fmtPct(g.progress, 0)}</span></div>
    <div class="small muted mt">${fmtMoney(g.current_amount_minor, g.currency)} of ${fmtMoney(g.target_amount_minor, g.currency)}</div>
    <div class="progress mt" style="margin-top:8px"><span style="width:${Math.min(g.progress * 100, 100).toFixed(1)}%"></span></div>
    ${g.deadline ? `<div class="small muted mt">Due ${esc(g.deadline)}</div>` : ''}
    <div class="flex gap mt"><button class="btn ghost sm" data-goal="${g.id}" data-gname="${esc(g.name)}" data-current="${g.current_amount_minor}" data-target="${g.target_amount_minor}">Update</button></div>
  </div>`).join('') : `<div class="empty"><div class="big">★</div>No goals yet.</div>`;
  document.querySelectorAll('[data-goal]').forEach((b) => b.addEventListener('click', () => openGoalModal({ id: Number(b.dataset.goal), name: b.dataset.gname, currentAmountMinor: Number(b.dataset.current), targetAmountMinor: Number(b.dataset.target) })));
}

function openGoalModal(goal) {
  modal(`<span class="close" data-close>×</span><h3>${goal ? 'Update goal' : 'Add goal'}</h3><form id="goal-form">
    <div class="field"><label>Name</label><input class="input" name="name" value="${esc(goal?.name || '')}" required /></div>
    <div class="row"><div class="field grow"><label>Target (₹)</label><input class="input" name="target" type="number" step="0.01" value="${goal ? goal.targetAmountMinor / 100 : ''}" required /></div>
    <div class="field grow"><label>Saved (₹)</label><input class="input" name="current" type="number" step="0.01" value="${goal ? goal.currentAmountMinor / 100 : ''}" /></div></div>
    <div class="field"><label>Deadline</label><input class="input" name="deadline" type="date" /></div>
    <div class="form-actions"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" type="submit">Save</button></div></form>`);
  wireModalClose();
  document.getElementById('goal-form').addEventListener('submit', async (e) => { e.preventDefault(); const fd = new FormData(e.target);
    const body = { name: fd.get('name'), targetAmountMinor: Math.round(Number(fd.get('target')) * 100), currentAmountMinor: Math.round(Number(fd.get('current') || 0) * 100), deadline: fd.get('deadline') || undefined };
    try { if (goal) await api(`/goals/${goal.id}`, { method: 'PUT', body }); else await api('/goals', { method: 'POST', body }); closeModal(); toast('Goal saved', 'success'); render(); } catch (err) { toast(err.message, 'error'); } });
}

/* ----- Reports ----- */
async function viewReports() {
  const w = document.getElementById('view-wrap');
  const year = new Date().getFullYear();
  w.innerHTML = `<div class="topbar"><div><h1>Reports</h1><div class="sub">Cash flow & allocation insights</div></div>
    <div class="row"><div class="field"><label>Year</label><select name="year"><option>${year}</option><option>${year - 1}</option></select></div><button class="btn ghost" data-action="load-report">Load</button></div></div>
    <div class="grid c2"><div class="card"><div class="section-title">Income vs Expenses (${year})</div><div id="cashflow"></div></div>
    <div class="card"><div class="section-title">Net Worth Trend</div><div id="nw-trend"></div></div></div>`;
  document.querySelector('[data-action="load-report"]').addEventListener('click', async () => {
    const y = document.querySelector('[name="year"]').value;
    const { data } = await api(`/reports/cashflow?year=${y}`);
    document.getElementById('cashflow').innerHTML = bars(data.rows.map((r) => ({ label: r.month.slice(5), v: r.incomeMinor - r.expenseMinor, title: `${fmtMoney(r.incomeMinor)} - ${fmtMoney(r.expenseMinor)}` })), { height: 260 });
  });
  const [{ data: cf }, { data: snaps }] = await Promise.all([api(`/reports/cashflow?year=${year}`), api('/net-worth/snapshots')]);
  document.getElementById('cashflow').innerHTML = bars(cf.rows.map((r) => ({ label: r.month.slice(5), v: r.incomeMinor - r.expenseMinor, title: `${fmtMoney(r.incomeMinor)} - ${fmtMoney(r.expenseMinor)}` })), { height: 260 });
  const trend = [...snaps].reverse();
  document.getElementById('nw-trend').innerHTML = trend.length ? lineChart(trend.map((s) => ({ label: s.as_of.slice(5), v: s.net_worth_minor })), { height: 260 }) : `<div class="empty">Take snapshots to see your trend.</div>`;
}

/* ----- Calculators ----- */
async function viewCalculators() {
  const w = document.getElementById('view-wrap');
  const card = (title, fields, id, button) => `<div class="card"><div class="section-title">${title}</div>${fields}<button class="btn primary sm mt" data-calc="${id}">${button}</button> <span class="small muted" id="res-${id}"></span></div>`;
  w.innerHTML = `<div class="topbar"><div><h1>Calculators</h1><div class="sub">Deterministic financial formulas — never computed by the AI</div></div></div>
    <div class="grid c2">
      ${card('EMI / Loan', `<div class="row"><div class="field grow"><label>Principal (₹)</label><input class="input" name="p" type="number" value="500000" /></div><div class="field grow"><label>Rate %</label><input class="input" name="r" type="number" value="8.5" /></div><div class="field grow"><label>Months</label><input class="input" name="n" type="number" value="240" /></div></div>`, 'emi', 'Calculate EMI')}
      ${card('SIP Future Value', `<div class="row"><div class="field grow"><label>Monthly (₹)</label><input class="input" name="p" type="number" value="10000" /></div><div class="field grow"><label>Return %</label><input class="input" name="r" type="number" value="12" /></div><div class="field grow"><label>Months</label><input class="input" name="n" type="number" value="60" /></div></div>`, 'sip', 'Calculate')}
      ${card('FD Maturity', `<div class="row"><div class="field grow"><label>Principal (₹)</label><input class="input" name="p" type="number" value="100000" /></div><div class="field grow"><label>Rate %</label><input class="input" name="r" type="number" value="6.5" /></div><div class="field grow"><label>Years</label><input class="input" name="n" type="number" value="5" /></div></div>`, 'fd', 'Calculate')}
      ${card('CAGR', `<div class="row"><div class="field grow"><label>Begin (₹)</label><input class="input" name="p" type="number" value="100000" /></div><div class="field grow"><label>End (₹)</label><input class="input" name="r" type="number" value="150000" /></div><div class="field grow"><label>Years</label><input class="input" name="n" type="number" value="3" /></div></div>`, 'cagr', 'Calculate')}
    </div>
    <div class="card mt"><div class="section-title">XIRR</div><p class="small muted">Cash flows (date, amount). Negative = investment, positive = return.</p>
      <textarea class="input" id="xirr-input" rows="5" placeholder="2020-01-01,-1000&#10;2021-01-01,1500"></textarea>
      <button class="btn primary sm mt" data-calc="xirr">Calculate XIRR</button> <span class="small muted" id="res-xirr"></span></div>`;
  w.querySelectorAll('[data-calc]').forEach((b) => b.addEventListener('click', awaitCalc));
  // compute defaults eagerly
  ['emi', 'sip', 'fd', 'cagr'].forEach(async (type) => { const el = w.querySelector(`[data-calc="${type}"]`); if (el) await runCalc(type, el); });
  async function awaitCalc(e) { await runCalc(e.currentTarget.dataset.calc, e.currentTarget); }
  async function runCalc(type, btn) {
    const cardEl = btn.closest('.card');
    const g = (n) => cardEl.querySelector(`[name="${n}"]`)?.value;
    const resEl = document.getElementById(`res-${type}`);
    try {
      const body = { principal: Number(g('p')), annualRatePercent: Number(g('r')), months: Number(g('n')), years: Number(g('n')), monthlyInvestment: Number(g('p')), beginValue: Number(g('p')), endValue: Number(g('r')) };
      let out = null;
      if (type === 'emi') out = (await api('/calculators/emi', { method: 'POST', body })).data;
      if (type === 'sip') out = (await api('/calculators/sip', { method: 'POST', body })).data;
      if (type === 'fd') out = (await api('/calculators/fd', { method: 'POST', body })).data;
      if (type === 'cagr') out = (await api('/calculators/cagr', { method: 'POST', body })).data;
      if (type === 'xirr') {
        const lines = document.getElementById('xirr-input').value.trim().split('\n').map((l) => l.split(',').map((x) => x.trim()));
        out = (await api('/calculators/xirr', { method: 'POST', body: { flows: lines.map(([date, amount]) => ({ date, amount })) } })).data;
      }
      if (type === 'emi') resEl.textContent = `EMI ₹${out.emi.toFixed(2)} · total interest ₹${out.totalInterest.toFixed(2)}`;
      if (type === 'sip') resEl.textContent = `Future value ₹${out.futureValue.toFixed(2)}`;
      if (type === 'fd') resEl.textContent = `Maturity ₹${out.maturity.toFixed(2)}`;
      if (type === 'cagr') resEl.textContent = `CAGR ${(out.cagr * 100).toFixed(4)}%`;
      if (type === 'xirr') resEl.textContent = `XIRR ${(out.xirr * 100).toFixed(4)}%`;
    } catch (e) { resEl.textContent = e.message; }
  }
}

/* ----- AI assistant ----- */
async function viewAi() {
  const w = document.getElementById('view-wrap');
  w.innerHTML = `<div class="topbar"><div><h1>AI Assistant</h1><div class="sub">Answers from your real WealthCore data — never invented</div></div></div>
    <div class="card chat-wrap" id="chat">
      <div class="chat-log" id="chat-log">
        <div class="msg assistant">Hi, I'm your WealthCore assistant. Ask me about your net worth, spending, portfolio, goals, budgets, accounts or sync status.</div>
      </div>
      <div class="chat-input"><textarea id="chat-text" placeholder="Ask about your money… (e.g. How much did I spend this month?)"></textarea>
      <button class="btn primary" id="chat-send">Send</button></div>
    </div>`;
  const log = document.getElementById('chat-log');
  const send = async () => {
    const text = document.getElementById('chat-text').value.trim();
    if (!text) return;
    log.insertAdjacentHTML('beforeend', `<div class="msg user">${esc(text)}</div>`);
    document.getElementById('chat-text').value = '';
    log.scrollTop = log.scrollHeight;
    const typing = document.createElement('div'); typing.className = 'msg assistant'; typing.textContent = '…'; log.appendChild(typing);
    try {
      const { data } = await api('/ai/message', { method: 'POST', body: { message: text } });
      typing.outerHTML = `<div class="msg assistant">${esc(data.answer)}<div class="toolchip">tools: ${(data.toolCalls || []).join(', ')}</div></div>`;
    } catch (e) { typing.outerHTML = `<div class="msg assistant">${esc(e.message)}</div>`; }
    log.scrollTop = log.scrollHeight;
  };
  document.getElementById('chat-send').addEventListener('click', send);
  document.getElementById('chat-text').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
}

/* ----- Integrations ----- */
async function viewIntegrations() {
  const w = document.getElementById('view-wrap');
  w.innerHTML = `<div class="topbar"><div><h1>Integrations</h1><div class="sub">Account Aggregator, consents & market data state</div></div></div>
    <div id="integ-body"><div class="skeleton" style="height:200px"></div></div>`;
  const [{ data }, { data: market }, { data: cfgF }, { data: prov }] = await Promise.all([api('/aa/status'), api('/market/status'), api('/config'), api('/aa/providers')]);
  const providers = prov.providers || [];
  const modeLabel = (m) => m === 'MOCK' ? 'Demo / Simulation' : m === 'SANDBOX' ? 'Sandbox / UAT' : m === 'PRODUCTION' ? 'Production' : m;
  const modeChip = (m) => m === 'MOCK' ? 'purple' : m === 'SANDBOX' ? 'blue' : m === 'PRODUCTION' ? 'green' : 'gray';
  const soa = ({ integration, status, provider, mode, configured }) => `
    <div class="card"><div class="section-title">Account Aggregator (FIU)</div>
      <div class="kpi"><span class="label">Integration</span><span class="value">${esc(integration)}</span></div>
      <div class="small muted mt">${esc(status)}</div>
      <div class="chip ${configured ? 'green' : 'amber'} mt">${configured ? 'CONFIGURED' : 'READY_FOR_CONFIGURATION'}</div>
      <p class="small muted mt">${configured ? `Provider: ${esc(provider)} (${esc(mode)})` : 'To go live, supply FIU provider credentials (client id, secret, base URL). No live data is fetched or claimed until then.'}</p>
      <div class="row mt"><button class="btn primary sm" data-action="connect-aa">Connect financial accounts</button></div>
    </div>`;
  const consents = data.consents || [];
  w.innerHTML = `<div class="topbar"><div><h1>Integrations</h1><div class="sub">Account Aggregator, consents, market data & AI provider state</div></div></div>
    ${providers.length ? `<div class="alert info"><b>Providers</b> — ${providers.map((p) => `<span class="chip ${modeChip(p.status.mode)}">${esc(p.name)} · ${esc(modeLabel(p.status.mode))}</span>`).join(' ')}. Imports from the demo provider are <b>TEST DATA — NOT REAL FINANCIAL DATA</b>.</div>` : ''}
    <div class="grid c2">
      ${soa(data)}
      <div class="card"><div class="section-title">Consents</div><div id="consent-list">${consents.length ? consents.map((c) => consentRow(c)).join('') : `<div class="empty">No consents yet. Connect an account to start.</div>`}</div>
      <button class="btn primary sm mt" data-action="connect-aa">+ Connect financial account</button></div>
    </div>
    <div class="card mt"><div class="section-title">Market data</div>
      <div class="kpi"><span class="label">Provider</span><span class="value">${esc(market.provider || 'Not configured')}</span></div>
      <div class="chip ${market.configured ? 'green' : 'amber'} mt">${market.configured ? 'CONFIGURED' : 'READY_FOR_CONFIGURATION'}</div>
      <p class="small muted mt">Prices are classified as LIVE / DELAYED / LAST_AVAILABLE / MANUAL / COST_BASIS / UNPRICED. Without a configured provider, nothing is reported as LIVE.</p>
      <div class="row"><button class="btn ghost" data-action="refresh-prices">Refresh prices</button><button class="btn ghost" data-action="view-securities">View securities</button></div>
    </div>
    <div class="grid c2 mt">
      <div class="card"><div class="section-title">AI provider</div>
        <div class="kpi"><span class="label">Provider</span><span class="value">${esc(cfgF.llm.provider || 'offline-deterministic')}</span></div>
        <div class="chip ${cfgF.llm.configured ? 'green' : 'amber'} mt">${cfgF.llm.configured ? 'CONFIGURED' : 'NOT_CONFIGURED'}</div>
        <p class="small muted mt">${cfgF.llm.configured ? 'Model-backed tool calling is active.' : 'Offline deterministic mode is active. Model provider credentials are required for LLM-backed answers.'}</p>
      </div>
      <div class="card"><div class="section-title">Data freshness</div><div id="integ-fresh">Loading…</div></div>
    </div>`;
  wireIntegr(data);
  api('/ai/status').then(({ data }) => {
    const el = document.getElementById('integ-fresh');
    if (el) el.innerHTML = `<div class="small muted">${esc(data.message)}</div><div class="small muted mt">Refresh is triggered by the scheduler (if enabled) and manual actions.</div>`;
  }).catch(() => {
    const el = document.getElementById('integ-fresh');
    if (el) el.innerHTML = `<div class="small muted">Check Reports and Dashboard for trends.</div>`;
  });
}

function statusChipConsent(s) {
  const map = { pending: 'amber', approved: 'green', active: 'green', rejected: 'red', expired: 'gray', revoked: 'red', data_requested: 'blue', data_ready: 'blue', fetched: 'green' };
  return `<span class="chip ${map[s] || 'gray'}">${esc(s)}</span>`;
}

function consentRow(c) {
  const fi = (c.fi_types ? JSON.parse(c.fi_types) : [c.fi_type]).filter(Boolean).join(' · ');
  const actions = [];
  // A real provider (e.g. Setu) returns a consent webview URL; surface it so the
  // customer can open the provider UI to approve a REAL consent (never auto-approve).
  if (c.status === 'pending' && c.consent_url) {
    actions.push(`<button class="btn primary sm" data-open-consent="${c.id}" data-url="${esc(c.consent_url)}">Open consent</button>`);
  }
  if (c.status === 'pending') actions.push(`<button class="btn ghost sm" data-approve-consent="${c.id}">Approve</button>`);
  if (c.status === 'approved' || c.status === 'active') {
    actions.push(`<button class="btn primary sm" data-sync-consent="${c.id}">Sync data</button>`);
    actions.push(`<button class="btn ghost sm" data-revoke-consent="${c.id}">Revoke</button>`);
  }
  return `<div class="flex between small" style="padding:8px 0;border-bottom:1px solid var(--surface-3)">
    <div><b>${esc(c.purpose || 'Personal financial management')}</b><div class="muted">${esc(c.provider)} · ${esc(fi)}</div></div>
    <div class="row gap">${statusChipConsent(c.status)} ${actions.join(' ')}</div></div>`;
}

function wireIntegr(data) {
  document.querySelectorAll('[data-action="connect-aa"]').forEach((b) => b.addEventListener('click', openAAConnect));
  document.querySelectorAll('[data-open-consent]').forEach((b) => b.addEventListener('click', () => {
    window.open(b.dataset.url, '_blank', 'noopener');
    toast('Opened provider consent screen — approve it there, then refresh', 'info');
  }));
  document.querySelectorAll('[data-approve-consent]').forEach((b) => b.addEventListener('click', async () => { await api(`/aa/consent/${b.dataset.approveConsent}/approve`, { method: 'POST', body: {} }); toast('Consent approved', 'success'); render(); }));
  document.querySelectorAll('[data-revoke-consent]').forEach((b) => b.addEventListener('click', async () => { await api(`/aa/consent/${b.dataset.revokeConsent}/revoke`, { method: 'POST', body: {} }); toast('Consent revoked', 'success'); render(); }));
  document.querySelectorAll('[data-sync-consent]').forEach((b) => b.addEventListener('click', async () => {
    try {
      const { data } = await api('/aa/sync', { method: 'POST', body: { consentId: Number(b.dataset.syncConsent) } });
      toast(`Sync complete: ${data.summary.accountsCreated} accounts, ${data.summary.transactionsCreated} transactions, ${data.summary.holdingsCreated} holdings`, 'success');
      render();
    } catch (e) { toast(e.message, 'error'); }
  }));
  document.querySelectorAll('[data-action="refresh-prices"]').forEach((b) => b.addEventListener('click', refreshPrices));
  document.querySelectorAll('[data-action="view-securities"]').forEach((b) => b.addEventListener('click', async () => { const { data: secs } = await api('/securities'); modal(`<span class="close" data-close>×</span><h3>Securities</h3>${secs.length ? secs.map((s) => `<div class="flex between small" style="padding:6px 0;border-bottom:1px solid var(--surface-3)"><div><b>${esc(s.name)}</b><div class="muted">${esc(s.asset_class)}</div></div><span class="status ${s.price_status}">${esc(s.price_status)}</span></div>`).join('') : `<div class="empty">No securities.</div>`}`); wireModalClose(); }));
}

async function openAAConnect() {
  let list;
  try { list = (await api('/aa/providers')).data.providers; }
  catch (e) { toast(e.message, 'error'); return; }
  modal(`<span class="close" data-close>×</span><h3>Connect financial accounts</h3><p class="lead">Choose an Account Aggregator provider. The demo provider runs fully locally with synthetic data.</p>
    <form id="connect-form">
      <div class="field"><label>Provider</label><select name="provider">${list.map((p) => `<option value="${esc(p.name)}">${esc(p.name)} — ${esc(p.status.mode === 'MOCK' ? 'Demo / Simulation' : p.status.mode === 'SANDBOX' ? 'Sandbox / UAT' : p.status.mode === 'PRODUCTION' ? 'Production' : p.status.mode)}</option>`).join('')}</select></div>
      <div class="field"><label>Data to request</label><select name="fiType">${['DEPOSIT','EQUITIES','MUTUAL_FUNDS','BONDS','INSURANCE_POLICIES','GOLD','NPS'].map((t) => `<option value="${t}">${t.replace('_',' ')}</option>`).join('')}</select></div>
      <div class="field"><label>Purpose</label><input class="input" name="purpose" value="Personal financial management" required /></div>
      <div class="field"><label>Customer handle (optional)</label><input class="input" name="customerHandle" placeholder="e.g. demo@mock" /></div>
      <div class="form-actions"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" type="submit">Request consent</button></div></form>`);
  wireModalClose();
  document.getElementById('connect-form').addEventListener('submit', async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    try {
      const body = { provider: fd.get('provider'), fiType: fd.get('fiType'), purpose: fd.get('purpose'), customerHandle: fd.get('customerHandle') || undefined };
      const { data } = await api('/aa/connect', { method: 'POST', body });
      closeModal(); render();
      // A real provider (e.g. Setu sandbox) returns a consent webview URL. The
      // customer MUST open it to approve the real consent — never auto-approve.
      if (data.consentUrl) {
        toast('Consent created. Open the provider screen to approve it (manual user action).', 'info');
        window.open(data.consentUrl, '_blank', 'noopener');
      } else {
        toast('Consent created — approve it to sync data', 'success');
      }
    } catch (err) { toast(err.message, 'error'); }
  });
}

/* ----- Reconciliation ----- */
async function viewReconciliation() {
  const w = document.getElementById('view-wrap');
  w.innerHTML = `<div class="topbar"><div><h1>Reconciliation</h1><div class="sub">Source balance vs WealthCore balance — differences are surfaced, never hidden</div></div>
    <div class="row"><button class="btn ghost" data-action="recon-history">History</button><button class="btn primary" data-action="recon-run">Run reconciliation</button></div></div>
    <div id="recon-body"><div class="skeleton" style="height:220px"></div></div>`;
  w.querySelector('[data-action="recon-run"]').addEventListener('click', async () => {
    try { await api('/reconciliation/run', { method: 'POST', body: {} }); toast('Reconciliation run recorded', 'success'); render(); } catch (e) { toast(e.message, 'error'); }
  });
  w.querySelector('[data-action="recon-history"]').addEventListener('click', async () => {
    const { data } = await api('/reconciliation/history?limit=30');
    modal(`<span class="close" data-close>×</span><h3>Reconciliation history</h3>${data.length ? data.map((r) => `<div class="flex between small" style="padding:6px 0;border-bottom:1px solid var(--surface-3)"><div><b>${esc(r.account_name || 'Account')}</b><div class="muted">${esc(r.as_of)}</div></div><span>${statusChipConsent(r.status)}</span></div>`).join('') : `<div class="empty">No reconciliation runs yet.</div>`}`);
    wireModalClose();
  });
  const { data } = await api('/reconciliation');
  const res = data.results || [];
  const sum = data.summary || {};
  w.innerHTML = `<div class="topbar"><div><h1>Reconciliation</h1><div class="sub">Source balance vs WealthCore balance — differences are surfaced, never hidden</div></div>
    <div class="row"><button class="btn ghost" data-action="recon-history">History</button><button class="btn primary" data-action="recon-run">Run reconciliation</button></div></div>
    <div class="grid c5">
      ${kpi('Accounts', res.length, 'checked')}
      ${kpi('Matched', sum.matched || 0, 'balanced')}
      ${kpi('Difference', sum.difference || 0, 'needs review')}
      ${kpi('Duplicates', sum.duplicate || 0, 'detected')}
      ${kpi('Missing src', sum.missingSource || 0, 'no source balance')}
    </div>
    <div class="card mt" id="recon-table"></div>`;
  document.getElementById('recon-table').innerHTML = res.length ? `<div class="tbl-wrap"><table><thead><tr><th>Account</th><th class="right">Source</th><th class="right">WealthCore</th><th class="right">Difference</th><th>Status</th><th></th></tr></thead><tbody>
    ${res.map((r) => `<tr>
      <td><b>${esc(r.accountName)}</b></td>
      <td class="right">${r.sourceBalanceMinor != null ? fmtMoney(r.sourceBalanceMinor, r.currency) : '—'}</td>
      <td class="right">${fmtMoney(r.localBalanceMinor, r.currency)}</td>
      <td class="right ${(r.differenceMinor || 0) !== 0 ? 'neg' : 'pos'}">${r.differenceMinor != null ? fmtMoney(r.differenceMinor, r.currency) : '—'}</td>
      <td>${statusChipConsent(r.status)}</td>
      <td class="right">${r.status === 'DIFFERENCE' ? `<button class="btn ghost sm" data-resolve="${r.accountId}">Resolve</button>` : ''}</td></tr>`).join('')}
  </tbody></table></div>` : `<div class="empty"><div class="big">⇆</div>No accounts to reconcile.</div>`;
  document.querySelectorAll('[data-resolve]').forEach((b) => b.addEventListener('click', () => resolveRecon(Number(b.dataset.resolve))));
}
function resolveRecon(accountId) {
  modal(`<span class="close" data-close>×</span><h3>Resolve difference</h3><p class="lead">Adopt the source balance into WealthCore, or record the difference for review.</p>
    <div class="row"><button class="btn primary sm" data-adopt="${accountId}">Adopt source balance</button><button class="btn ghost sm" data-record="${accountId}">Record for review</button></div>`);
  wireModalClose();
  document.querySelector('[data-adopt]').addEventListener('click', async () => { await api(`/reconciliation/${accountId}/resolve`, { method: 'POST', body: { setBalance: true } }); closeModal(); toast('Source balance adopted', 'success'); render(); });
  document.querySelector('[data-record]').addEventListener('click', async () => { await api(`/reconciliation/${accountId}/resolve`, { method: 'POST', body: { note: 'recorded' } }); closeModal(); toast('Difference recorded', 'success'); render(); });
}

/* ----- Import ----- */
async function viewImport() {
  const w = document.getElementById('view-wrap');
  w.innerHTML = `<div class="topbar"><div><h1>Import</h1><div class="sub">CSV / JSON transaction ingestion with preview, dedup & summary</div></div></div>
    <div class="grid c2">
      <div class="card"><div class="section-title">Ingest a file</div>
        <div class="field"><label>Format</label><select name="format" id="fmt"><option value="csv-generic">Generic CSV</option><option value="bank-csv">Bank CSV statement</option><option value="json-transactions">JSON transactions</option><option value="zerodha-holdings">Zerodha holdings</option><option value="groww-holdings">Groww holdings</option></select></div>
        <div class="field"><label>Default account (optional)</label><select name="accountId" id="ingest-account"><option value="">— none —</option></select></div>
        <div class="field"><label>Data (paste CSV/JSON)</label><textarea class="input" id="ingest-text" rows="8" placeholder="date,merchant,amount,direction&#10;2026-08-01,BigBasket Groceries,1240.00,out&#10;2026-08-02,ACME Corp Salary,150000.00,in"></textarea></div>
        <div class="row"><button class="btn ghost" data-action="ingest-preview">Preview</button><button class="btn primary" data-action="ingest-run">Import</button></div>
        <div id="import-result" class="mt"></div></div>
      <div class="card"><div class="section-title">Recent imports</div><div id="import-runs"><div class="skeleton" style="height:120px"></div></div></div>
    </div>`;
  api('/accounts').then(({ data }) => document.getElementById('ingest-account').innerHTML += data.filter((a) => !a.isLiability).map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join(''));
  api('/ingestion/runs').then(({ data }) => document.getElementById('import-runs').innerHTML = data.length ? data.map((r) => `<div class="flex between small" style="padding:6px 0;border-bottom:1px solid var(--surface-3)"><div><b>${esc(r.format)}</b> · ${esc(r.file_name || 'paste')} <div class="muted">${esc(r.status)}</div></div><span class="muted">+${r.created_records} / dup ${r.duplicates} / fail ${r.failed_records}</span></div>`).join('') : `<div class="empty">No imports yet.</div>`);
  w.querySelector('[data-action="ingest-preview"]').addEventListener('click', async () => {
    const format = document.getElementById('fmt').value, text = document.getElementById('ingest-text').value;
    try { const { data } = await api('/ingest/preview', { method: 'POST', body: { format, text } }); showImportPreview(data); }
    catch (e) { toast(e.message, 'error'); }
  });
  w.querySelector('[data-action="ingest-run"]').addEventListener('click', async () => {
    const format = document.getElementById('fmt').value, text = document.getElementById('ingest-text').value;
    const accountId = document.getElementById('ingest-account').value;
    try {
      const { data } = await api('/ingest', { method: 'POST', body: { format, text, defaultAccountId: accountId ? Number(accountId) : undefined } });
      showImportResult(data);
      toast(`Imported ${data.summary.created} records`, 'success'); render();
    } catch (e) { toast(e.message, 'error'); }
  });
}
function showImportPreview(data) {
  const box = document.getElementById('import-result');
  box.innerHTML = `<div class="alert info"><b>Preview</b> — ${data.total} records; ${data.holdings || 0} holdings.</div><div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Merchant</th><th class="right">Amount</th><th>Direction</th></tr></thead><tbody>${(data.preview || []).map((t) => `<tr><td>${esc(t.date)}</td><td>${esc(t.merchant || '—')}</td><td class="right">${fmtMoney(t.amountMinor)}</td><td>${esc(t.direction)}</td></tr>`).join('')}</tbody></table></div>`;
}
function showImportResult(data) {
  const box = document.getElementById('import-result');
  const s = data.summary;
  box.innerHTML = `<div class="alert ${s.failed ? 'warn' : 'success'}"><b>${s.created} created</b>, ${s.duplicates} duplicates, ${s.failed} failed (${s.total} total).${s.holdingsReceived ? ` ${s.holdingsCreated} holdings added.` : ''}</div>`;
  if (data.failed && data.failed.length) {
    box.insertAdjacentHTML('beforeend', `<div class="small muted">${data.failed.slice(0, 5).map((f) => esc(f.error || 'invalid')).join('; ')}</div>`);
  }
}

/* ----- Notifications ----- */
async function viewNotifications() {
  const w = document.getElementById('view-wrap');
  const [{ data: prefs }, { data: notifs }] = await Promise.all([api('/notifications/preferences'), api('/notifications')]);
  w.innerHTML = `<div class="topbar"><div><h1>Notifications</h1><div class="sub">Configurable alerts from your financial data</div></div>
    <button class="btn primary" data-action="eval-notifs">Evaluate now</button></div>
    <div class="grid c2">
      <div class="card"><div class="section-title">Preferences</div>${prefs.map((p) => `<label class="flex between small" style="padding:8px 0;border-bottom:1px solid var(--surface-3)"><span>${esc(p.type)}</span><input type="checkbox" data-pref="${esc(p.type)}" ${p.enabled ? 'checked' : ''} /></label>`).join('')}</div>
      <div class="card"><div class="section-title">Activity</div><div id="notif-list">${notifs.length ? notifs.filter((n) => !n.dismissed).map((n) => `<div class="flex between small" style="padding:8px 0;border-bottom:1px solid var(--surface-3)"><div><b>${esc(n.title)}</b>${n.read ? '' : ' <span class="chip blue">new</span>'}<div class="muted">${esc(n.body || '')}</div></div><button class="btn ghost sm" data-dismiss="${n.id}">✕</button></div>`).join('') : `<div class="empty">No notifications.</div>`}</div></div>
    </div>`;
  w.querySelector('[data-action="eval-notifs"]').addEventListener('click', async () => { const { data } = await api('/notifications/evaluate', { method: 'POST', body: {} }); toast(`${data.count} notifications created`, 'success'); render(); });
  document.querySelectorAll('[data-pref]').forEach((el) => el.addEventListener('change', async () => { try { await api(`/notifications/preferences/${el.dataset.pref}`, { method: 'PUT', body: { enabled: el.checked } }); } catch (e) { toast(e.message, 'error'); } }));
  document.querySelectorAll('[data-dismiss]').forEach((el) => el.addEventListener('click', async () => { await api(`/notifications/${el.dataset.dismiss}/dismiss`, { method: 'POST', body: {} }); render(); }));
}

/* ----- Settings ----- */
async function viewSettings() {
  const w = document.getElementById('view-wrap');
  const { data: me } = await api('/auth/me');
  w.innerHTML = `
    <div class="topbar"><div><h1>Settings</h1><div class="sub">Security, privacy, data & demo tools</div></div></div>
    <div class="grid c2">
      <div class="card"><div class="section-title">Security</div>
        <p class="small muted">Add a PIN to lock the app. Sessions are server-side tokens with expiry.</p>
        <button class="btn primary sm" data-action="set-pin">${me.session.appLockEnabled ? 'Change app lock PIN' : 'Enable app lock PIN'}</button>
        ${me.session.appLockEnabled ? `<button class="btn ghost sm" data-action="lock-now">Lock now</button>` : ''}
      </div>
      <div class="card"><div class="section-title">Data</div>
        <div class="row wrap gap">
          <button class="btn ghost sm" data-action="export-json">Export JSON</button>
          <button class="btn ghost sm" data-action="export-csv">Export CSV</button>
          <button class="btn ghost sm" data-action="load-demo">Load sample data</button>
        </div>
      </div>
      <div class="card"><div class="section-title">Privacy</div>
        <p class="small muted">WealthCore stores your data locally (SQLite). No data is written to browser/server logs, telemetry or analytics. Full data export is always available.</p>
        <div class="row wrap gap">
          <button class="btn ghost sm" data-action="revoke-conn">Revoke connections</button>
          <button class="btn danger sm" data-action="delete-data">Delete all data</button>
        </div>
      </div>
      <div class="card"><div class="section-title">About</div>
        <p class="small muted"><b>WealthCore</b> — Your Entire Financial Life. One Intelligent Core.<br/>Version 1.0 · Private single-user personal financial OS.</p>
      </div>
    </div>`;
  w.querySelector('[data-action="set-pin"]').addEventListener('click', openPinModal);
  w.querySelector('[data-action="lock-now"]')?.addEventListener('click', async () => { await api('/auth/lock', { method: 'POST' }); state.locked = true; render(); });
  w.querySelector('[data-action="export-json"]').addEventListener('click', () => download('/export.json', 'wealthcore-export.json'));
  w.querySelector('[data-action="export-csv"]').addEventListener('click', () => download('/export.csv', 'wealthcore-transactions.csv'));
  w.querySelector('[data-action="load-demo"]').addEventListener('click', loadDemo);
  w.querySelector('[data-action="revoke-conn"]').addEventListener('click', async () => {
    if (!confirm('Revoke all approved/pending connections and detach accounts from providers?')) return;
    try { await api('/privacy/revoke-connections', { method: 'POST', body: {} }); toast('Connections revoked', 'success'); render(); } catch (e) { toast(e.message, 'error'); }
  });
  w.querySelector('[data-action="delete-data"]').addEventListener('click', async () => {
    if (!confirm('This permanently deletes all accounts, transactions, holdings, goals, budgets, consents, snapshots and notifications. This cannot be undone. Continue?')) return;
    try { await api('/privacy/delete-data', { method: 'POST', body: {} }); toast('Financial data deleted', 'success'); render(); } catch (e) { toast(e.message, 'error'); }
  });
}

function openPinModal() {
  modal(`<span class="close" data-close>×</span><h3>Set app lock PIN</h3><p class="lead">A 4-6 digit PIN to lock and unlock the app on this device.</p>
    <form id="pin-form"><div class="field"><label>PIN</label><input class="input" name="pin" type="password" pattern="[0-9]{4,6}" required /></div>
      <div class="form-actions"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" type="submit">Save PIN</button></div></form>`);
  wireModalClose();
  document.getElementById('pin-form').addEventListener('submit', async (e) => { e.preventDefault();
    try { await api('/auth/pin', { method: 'POST', body: { pin: new FormData(e.target).get('pin') } }); closeModal(); toast('PIN set', 'success'); render(); } catch (err) { toast(err.message, 'error'); } });
}

async function download(path, filename) {
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${state.token}` } });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}

async function loadDemo() {
  try {
    const { data } = await api('/seed-demo', { method: 'POST' });
    toast('Sample data loaded', 'success'); render();
  } catch (e) { toast(e.message, 'error'); }
}

function wireModalClose() {
  document.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', closeModal));
  document.querySelectorAll('.close').forEach((el) => el.addEventListener('click', closeModal));
}

/* ---------- boot ---------- */
async function init() {
  try {
    const { data } = await api('/config');
    state.config = data;
  } catch (e) { $app.innerHTML = `<div class="auth-wrap"><div class="auth-card"><div class="alert error">Could not reach the WealthCore server: ${esc(e.message)}</div></div></div>`; return; }
  if (state.token) {
    try {
      const me = await api('/auth/me');
      state.user = me.data.user;
      state.locked = me.data.session.locked;
    } catch { clearSession(); }
  }
  wireGlobalActions();
  const initial = window.location.hash.replace('#', '');
  if (routes[initial]) state.route = initial;
  render();
}

window.addEventListener('hashchange', () => {
  const key = window.location.hash.replace('#', '');
  if (routes[key]) { state.route = key; if (state.token && !state.locked) routes[key].fn(); }
});

init();

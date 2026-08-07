// ══════════════════════════════════════════════════════════════════════
// RATESECURE BRANCH PORTAL — SHARED CONFIG
// Loaded by every page. Fill in the three values below once you've
// created your Supabase project (see SETUP-README.md for step-by-step).
// ══════════════════════════════════════════════════════════════════════

var SUPA_URL = 'https://ugzadcpvijpvphqrmuko.supabase.co';
var SUPA_ANON_KEY = 'sb_publishable_l8NJwMx2VP1BVrBnpCINlQ_CtziqtWK';

// The branch shares ONE login behind the scenes so nobody needs an
// individual account, but the page is still protected by a real,
// server-verified Supabase session (not just a JS "if password == x" check).
// Create this single user in Supabase Auth once (see SETUP-README.md),
// then set the same email here. The password itself is never stored in
// this file — it's typed on the login page and checked by Supabase.
var BRANCH_LOGIN_EMAIL = 'trevor@ratesecure.com';

var supa = supabase.createClient(SUPA_URL, SUPA_ANON_KEY);

// ── AUTH HELPERS ─────────────────────────────────────────────────────
// Call at the top of every protected page. Redirects to the login page
// if there's no active session.
async function requireAuth() {
  var { data: { session } } = await supa.auth.getSession();
  if (!session) {
    window.location.replace('index.html');
    return null;
  }
  return session;
}

async function doLogout() {
  await supa.auth.signOut();
  window.location.replace('index.html');
}

// ── SIGNER (LOAN OFFICER) DATA ──────────────────────────────────────
// Shared across the whole branch via the `signers` table in Supabase —
// this is what replaces the old per-browser localStorage version.
// Each row: key, name, title_line_1, title_line_2, nmls, company, email, phone.

var DEFAULT_SIGNERS = {
  trevor: { name:'Trevor Chan', titleLines:['Loan Originator'], nmls:'1096000', company:'', email:'trevor@ratesecure.com', phone:'415.506.7221' },
  robin:  { name:'Robin Mesina', titleLines:['VP of Strategic Growth','Sr. Loan Officer'], nmls:'1311825', company:'RateSecure', email:'robin@ratesecure.com', phone:'415.713.0084' },
  briana: { name:'Briana Jones', titleLines:['Retail Client Manager'], nmls:'', company:'', email:'briana@ratesecure.com', phone:'916.940.7007' }
};

async function fetchSigners() {
  var { data, error } = await supa.from('signers').select('*').order('name');
  if (error) { console.error('fetchSigners error:', error); return {}; }
  var out = {};
  data.forEach(function(row) {
    out[row.key] = {
      name: row.name,
      titleLines: [row.title_line_1, row.title_line_2].filter(Boolean),
      nmls: row.nmls || '',
      company: row.company || '',
      email: row.email || '',
      phone: row.phone || ''
    };
  });
  return out;
}

// Seeds the three example team members into Supabase, but ONLY the very
// first time the table is completely empty — never overwrites real data.
async function seedDefaultSignersIfEmpty() {
  var { count, error } = await supa.from('signers').select('*', { count: 'exact', head: true });
  if (error) { console.error('seed check error:', error); return; }
  if (count && count > 0) return;
  var keys = Object.keys(DEFAULT_SIGNERS);
  for (var i = 0; i < keys.length; i++) {
    await saveSigner(keys[i], DEFAULT_SIGNERS[keys[i]]);
  }
}

async function saveSigner(key, profile) {
  var row = {
    key: key,
    name: profile.name,
    title_line_1: profile.titleLines[0] || null,
    title_line_2: profile.titleLines[1] || null,
    nmls: profile.nmls || null,
    company: profile.company || null,
    email: profile.email || null,
    phone: profile.phone || null
  };
  var { error } = await supa.from('signers').upsert(row, { onConflict: 'key' });
  if (error) {
    console.error('saveSigner error:', error);
    alert('Could not save to the shared database — check your connection and try again.');
    return false;
  }
  return true;
}

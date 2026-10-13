#!/usr/bin/env node
/**
 * Clerk DNS for prismfilehero.com — check what public DNS actually says, and (only with a token that
 * has DNS rights) apply the five Clerk records.
 *
 *   node scripts/clerk-dns.mjs --check                    read-only, no credentials needed
 *   CLOUDFLARE_API_TOKEN=… node scripts/clerk-dns.mjs --apply --dry-run
 *   CLOUDFLARE_API_TOKEN=… node scripts/clerk-dns.mjs --apply --yes
 *
 * Why a token is needed: the wrangler OAuth login on this machine carries zone(read) but NOT
 * Zone DNS, so /zones/<id>/dns_records answers `Authentication error (10000)`. Create an API token at
 * dash.cloudflare.com → My Profile → API Tokens → Create Token, using the "Edit zone DNS" template,
 * scoped to Zone | prismfilehero.com | DNS | Edit. Pass it via the environment only — never in a
 * commit, and it can be deleted right after.
 *
 * Cloudflare specifics: every one of these CNAMEs must be **DNS only** (proxied=false). A proxied
 * CNAME resolves to Cloudflare's IPs, so Clerk's verification would never see its own target.
 * Existing DMARC is never touched; a policy is only added when none exists.
 */
const ZONE = 'prismfilehero.com';
const RECORDS = [
  { type: 'CNAME', name: 'accounts', content: 'accounts.clerk.services' },
  { type: 'CNAME', name: 'clerk', content: 'frontend-api.clerk.services' },
  { type: 'CNAME', name: 'clk._domainkey', content: 'dkim1.669azg0nmm0e.clerk.services' },
  { type: 'CNAME', name: 'clk2._domainkey', content: 'dkim2.669azg0nmm0e.clerk.services' },
  { type: 'CNAME', name: 'clkmail', content: 'mail.669azg0nmm0e.clerk.services' },
];
const DMARC = { type: 'TXT', name: '_dmarc', content: 'v=DMARC1; p=none;', onlyIfAbsent: true };

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const yes = args.includes('--yes');
const dry = args.includes('--dry-run') || !yes;
const tok = (process.env.CLOUDFLARE_API_TOKEN || '').trim();
const cf = (p) => `https://api.cloudflare.com/client/v4${p}`;
const api = async (p, init = {}) => {
  const r = await fetch(cf(p), { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!j.success) throw new Error(`${p} -> ${r.status} ${JSON.stringify(j.errors || j)}`.slice(0, 300));
  return j.result;
};
const doh = async (name, type) => {
  const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`, { signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  return { status: j.Status ?? -1, answers: (j.Answer || []).map((a) => String(a.data).replace(/\.$/, '').toLowerCase()) };
};
const full = (n) => `${n}.${ZONE}`;
const norm = (s) => String(s || '').replace(/\.$/, '').toLowerCase();

if (!apply) {
  console.log(`Public DNS for ${ZONE} (resolver: dns.google)\n`);
  for (const rec of [...RECORDS, DMARC]) {
    const q = rec.type === 'TXT' ? 'TXT' : 'CNAME';
    const { status, answers } = await doh(full(rec.name), q);
    const want = norm(rec.content);
    let verdict;
    if (status === 3 || !answers.length) verdict = `MISSING  (expected ${q} -> ${rec.content})`;
    else if (answers.includes(want)) verdict = `OK       ${answers.join(' ; ')}`;
    else verdict = `WRONG    present: ${answers.join(' ; ')} | must be exactly: ${rec.content}`;
    console.log(`${rec.type.padEnd(5)} ${full(rec.name).padEnd(42)} ${verdict}`);
  }
  const spf = await doh(ZONE, 'TXT');
  console.log(`\nApex TXT (SPF lives here — leave it alone): ${spf.answers.filter((a) => a.startsWith('v=spf1')).join(' | ') || 'none'}`);
  console.log('\nNext: re-run Clerk verification in the Clerk dashboard after the records are saved.');
  process.exit(0);
}

if (!tok) { console.error('CLOUDFLARE_API_TOKEN is required for --apply (see the header of this script).'); process.exit(2); }

const zones = await api(`/zones?name=${ZONE}`);
if (!zones.length) { console.error('Zone not visible to this token.'); process.exit(2); }
const zoneId = zones[0].id;
console.log(`zone ${ZONE} (${zoneId.slice(0, 8)}…) — ${dry ? 'DRY RUN, nothing will be written' : 'APPLYING'}`);
const existing = await api(`/zones/${zoneId}/dns_records?per_page=200`);
let changed = 0;
for (const rec of [...RECORDS, DMARC]) {
  const name = full(rec.name);
  const hits = existing.filter((r) => norm(r.name) === norm(name));
  if (rec.onlyIfAbsent && hits.length) { console.log(`keep   ${rec.type} ${name} (existing policy left untouched)`); continue; }
  if (hits.some((r) => norm(r.content) === norm(rec.content))) { console.log(`ok     ${rec.type} ${name}`); continue; }
  if (hits.length) {
    console.log(`fix    ${rec.type} ${name}: ${hits[0].content} -> ${rec.content}`);
    if (!dry) await api(`/zones/${zoneId}/dns_records/${hits[0].id}`, { method: 'PUT', body: JSON.stringify({ type: rec.type, name: rec.name, content: rec.content, ttl: 1, proxied: false }) });
  } else {
    console.log(`add    ${rec.type} ${name} -> ${rec.content} (DNS only)`);
    if (!dry) await api(`/zones/${zoneId}/dns_records`, { method: 'POST', body: JSON.stringify({ type: rec.type, name: rec.name, content: rec.content, ttl: 1, proxied: false }) });
  }
  changed++;
}
console.log(dry ? `\nDry run: ${changed} record(s) would change. Re-run with --yes to apply.` : `\nApplied ${changed} change(s). Allow a minute, then run --check and re-verify in Clerk.`);

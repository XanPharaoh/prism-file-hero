#!/usr/bin/env node
/**
 * Item 4 / Check C — a LOCAL deterministic Clerk stand-in for testing the Worker's authenticated
 * routes without real Clerk credentials. Generates an RSA keypair, serves a JWKS at
 * /.well-known/jwks.json, and mints RS256 JWTs at /mint?sub=<id> whose `iss` equals this server's
 * origin (the Worker derives the issuer from CLERK_JWKS_URL when CLERK_JWT_ISSUER is unset).
 * This is a TEST substitute — NOT real Clerk and NOT real AI providers.
 */
import { createServer } from 'node:http';
import { createSign, generateKeyPairSync, createPublicKey } from 'node:crypto';

const PORT = Number(process.env.JWKS_PORT || 8799);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
});
const KID = 'prism-test-key-1';
const jwk = { ...createPublicKey(publicKey).export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'RS256' };

const b64url = (buf) => Buffer.from(buf).toString('base64url');
function mint(sub) {
  const iat = Math.floor(Date.now() / 1000), exp = iat + 3600;
  const h = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: KID }));
  const p = b64url(JSON.stringify({ sub, iss: ORIGIN, iat, exp }));
  const sig = createSign('RSA-SHA256').update(`${h}.${p}`).sign(privateKey).toString('base64url');
  return `${h}.${p}.${sig}`;
}

createServer((req, res) => {
  const u = new URL(req.url, ORIGIN);
  if (u.pathname === '/.well-known/jwks.json') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ keys: [jwk] })); }
  if (u.pathname === '/mint') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(mint(u.searchParams.get('sub') || 'test-user')); }
  res.writeHead(404); res.end('no');
}).listen(PORT, '127.0.0.1', () => console.log(`local JWKS/mint on ${ORIGIN} (kid ${KID})`));

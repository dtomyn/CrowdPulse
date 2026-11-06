// HTTPS without buying a certificate.
//
// Phones only allow the camera on https pages, so `npm run secure` serves CrowdPulse over https using a certificate
// it makes for itself (self-signed). It covers localhost, this computer's name and its current network addresses,
// lasts a year, and is kept in data/certs so phones that accepted it once don't have to again.
// A new one is made automatically when it expires or the laptop joins a network with a different address.
//
// Got a certificate already (e.g. from mkcert or your company)? Set HTTPS_CERT and HTTPS_KEY to its PEM files.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function localAddresses() {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) if (ni.family === 'IPv4' && !ni.internal && !/^169\.254/.test(ni.address)) ips.push(ni.address);
  }
  return ips;
}

function hostNames() {
  const h = os.hostname().toLowerCase();
  return [...new Set(['localhost', h, `${h}.local`])].filter(n => /^[a-z0-9.-]+$/.test(n));
}

// Is the saved certificate still good for this network?
function stillValid(certPem) {
  try {
    const x = new crypto.X509Certificate(certPem);
    if (new Date(x.validTo).getTime() < Date.now() + 7 * 86400000) return false;
    return ['127.0.0.1', ...localAddresses()].every(ip => x.checkIP(ip)) && !!x.checkHost('localhost');
  } catch { return false; }
}

async function makeCert() {
  const selfsigned = require('selfsigned');
  const notAfter = new Date(); notAfter.setDate(notAfter.getDate() + 365);
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'CrowdPulse on ' + os.hostname() }, { name: 'organizationName', value: 'CrowdPulse (self-signed)' }], {
    keySize: 2048, algorithm: 'sha256', notAfterDate: notAfter,
    extensions: [
      { name: 'basicConstraints', cA: false, critical: true },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [
        ...hostNames().map(value => ({ type: 2, value })),
        ...['127.0.0.1', '::1', ...localAddresses()].map(ip => ({ type: 7, ip })),
      ] },
    ],
  });
  return { cert: pems.cert, key: pems.private };
}

// Returns { cert, key, source: 'custom' | 'saved' | 'new', fingerprint, file }
async function loadTls(dataDir) {
  const certFile = process.env.HTTPS_CERT, keyFile = process.env.HTTPS_KEY;
  if (certFile || keyFile) {
    if (!certFile || !keyFile) throw new Error('Set both HTTPS_CERT and HTTPS_KEY, or neither');
    const cert = fs.readFileSync(certFile, 'utf8');
    return { cert, key: fs.readFileSync(keyFile, 'utf8'), source: 'custom', fingerprint: fingerprint(cert), file: certFile };
  }
  const dir = path.join(dataDir, 'certs');
  const cFile = path.join(dir, 'crowdpulse-cert.pem'), kFile = path.join(dir, 'crowdpulse-key.pem');
  if (fs.existsSync(cFile) && fs.existsSync(kFile)) {
    const cert = fs.readFileSync(cFile, 'utf8');
    if (stillValid(cert)) return { cert, key: fs.readFileSync(kFile, 'utf8'), source: 'saved', fingerprint: fingerprint(cert), file: cFile };
  }
  const { cert, key } = await makeCert();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(kFile, key, { mode: 0o600 });
  fs.writeFileSync(cFile, cert);
  return { cert, key, source: 'new', fingerprint: fingerprint(cert), file: cFile };
}

function fingerprint(certPem) {
  try { return new crypto.X509Certificate(certPem).fingerprint256; } catch { return ''; }
}

module.exports = { loadTls, localAddresses };

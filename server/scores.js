import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

const JSONBIN_URL = 'https://api.jsonbin.io/v3/b';
const SESSION_SECONDS = 365 * 24 * 60 * 60;
const MAX_ENTRIES = 1000;
const MAX_BODY_BYTES = 1024;
const BIN_ID = /^[a-f0-9]{24}$/;

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'CDN-Cache-Control': 'no-store',
      'Vercel-CDN-Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
}

function validateEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)
    || Object.keys(entry).length !== 2
    || !Object.hasOwn(entry, 'date') || !Object.hasOwn(entry, 'scores')
    || typeof entry.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)
    || !Array.isArray(entry.scores) || entry.scores.length !== 6
    || !entry.scores.every(score => score === null || (Number.isInteger(score) && score >= 1 && score <= 10))
    || entry.scores.every(score => score === null)) {
    throw new RequestError(400, 'Choose at least one score between 1 and 10.');
  }
  const date = new Date(`${entry.date}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== entry.date) {
    throw new RequestError(400, 'The entry date is invalid.');
  }
  return { date: entry.date, scores: [...entry.scores] };
}

function readRecord(record) {
  if (!record || record.app !== 'goldsmith' || record.version !== 1
    || !Array.isArray(record.entries) || record.entries.length > MAX_ENTRIES) {
    throw new RequestError(502, 'Saved scores could not be read. Please try again.');
  }
  try {
    const entries = record.entries.map(validateEntry);
    if (new Set(entries.map(entry => entry.date)).size !== entries.length) throw new Error();
    return entries.sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    throw new RequestError(502, 'Saved scores could not be read. Please try again.');
  }
}

function cookieOptions(request) {
  const secure = new URL(request.url).protocol === 'https:';
  return {
    name: secure ? '__Host-goldsmith' : 'goldsmith_dev',
    attributes: `Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secure ? '; Secure' : ''}`,
  };
}

function signature(payload, key) {
  const signingKey = hkdfSync('sha256', key, 'goldsmith', 'browser-bin-session-v1', 32);
  return createHmac('sha256', signingKey).update(payload).digest('base64url');
}

function readSession(request, key, now) {
  const name = cookieOptions(request).name;
  const values = (request.headers.get('cookie') || '').split(';')
    .map(value => value.trim()).filter(value => value.startsWith(`${name}=`));
  if (!values.length) return null;
  const invalid = () => { throw new RequestError(401, 'This browser\'s saved access is invalid or expired.'); };
  if (values.length !== 1) return invalid();
  const token = values[0].slice(name.length + 1);
  const [version, binId, expires, suppliedSignature, extra] = token.split('.');
  if (extra !== undefined || version !== 'v1' || !BIN_ID.test(binId || '')
    || !/^\d{10}$/.test(expires || '') || Number(expires) <= Math.floor(now / 1000)
    || !/^[A-Za-z0-9_-]{43}$/.test(suppliedSignature || '')) return invalid();
  const expected = signature(`${version}.${binId}.${expires}`, key);
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(suppliedSignature))) return invalid();
  return binId;
}

function sessionCookie(request, binId, key, now) {
  const payload = `v1.${binId}.${Math.floor(now / 1000) + SESSION_SECONDS}`;
  const { name, attributes } = cookieOptions(request);
  return `${name}=${payload}.${signature(payload, key)}; ${attributes}`;
}

export function createScoresApi({
  getAccessKey = () => process.env.JSONBIN_ACCESS_KEY,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  logger = console,
} = {}) {
  async function jsonbin(path, key, options = {}) {
    const response = await fetchImpl(`${JSONBIN_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Access-Key': key,
        ...options.headers,
      },
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
      cache: 'no-store',
    });
    if (!response.ok) {
      // Never log upstream bodies, headers, credentials, or user scores.
      logger.error('Goldsmith storage request failed', { status: response.status });
      throw new RequestError(502, 'Cloud storage is unavailable. Your entry was not saved. Please try again.');
    }
    return response.json();
  }

  return async function scoresApi(request) {
    try {
      if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed.' }, 405, { Allow: 'GET, POST' });
      const url = new URL(request.url);
      // There is no client-selected bin, URL, or upstream operation.
      if (url.search) throw new RequestError(400, 'Unexpected request parameters.');
      if (request.headers.get('sec-fetch-site') === 'cross-site') throw new RequestError(403, 'Cross-site requests are not allowed.');
      if (request.method === 'POST' && request.headers.get('origin') !== url.origin) {
        throw new RequestError(403, 'Save entries from the Goldsmith app.');
      }
      const key = getAccessKey();
      if (!key) throw new RequestError(503, 'Cloud storage is not configured.');
      const timestamp = now();
      const binId = readSession(request, key, timestamp);

      if (request.method === 'GET') {
        if (!binId) return json({ entries: [] });
        const result = await jsonbin(`/${binId}/latest`, key);
        const entries = readRecord(result.record);
        return json({ entries }, 200, { 'Set-Cookie': sessionCookie(request, binId, key, timestamp) });
      }

      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
        throw new RequestError(415, 'Send entries as JSON.');
      }
      if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) throw new RequestError(413, 'Entry is too large.');
      const reader = request.body?.getReader();
      if (!reader) throw new RequestError(400, 'Entry is missing.');
      let bytes = 0;
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BODY_BYTES) {
          await reader.cancel();
          throw new RequestError(413, 'Entry is too large.');
        }
        chunks.push(value);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new RequestError(400, 'Entry is invalid JSON.'); }
      const entry = validateEntry(body);
      let entries = [];
      if (binId) {
        const current = await jsonbin(`/${binId}/latest`, key);
        entries = readRecord(current.record);
      }
      entries = entries.filter(previous => previous.date !== entry.date);
      if (entries.length >= MAX_ENTRIES) throw new RequestError(409, 'Cloud history is full. Your entry was not saved.');
      entries.push(entry);
      entries.sort((a, b) => a.date.localeCompare(b.date));
      const result = await jsonbin(binId ? `/${binId}` : '', key, {
        method: binId ? 'PUT' : 'POST',
        headers: binId ? { 'X-Bin-Versioning': 'false' } : { 'X-Bin-Private': 'true', 'X-Bin-Name': 'Goldsmith scores' },
        body: JSON.stringify({ app: 'goldsmith', version: 1, entries }),
      });
      const savedId = binId || result.metadata?.id;
      if (!BIN_ID.test(savedId || '')) throw new RequestError(502, 'Cloud storage returned an invalid response.');
      return json({ entries }, 200, { 'Set-Cookie': sessionCookie(request, savedId, key, timestamp) });
    } catch (error) {
      if (error instanceof RequestError) return json({ error: error.message }, error.status);
      logger.error('Goldsmith storage request failed', { type: error?.name || 'Error' });
      return json({ error: 'Cloud storage is unavailable. Please try again.' }, 502);
    }
  };
}

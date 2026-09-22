// The browser's only path to Solana. Forwards one JSON-RPC request to HELIUS_RPC_URL, which stays
// server-side: it carries the key, so it never appears in a response, a log line or an error.

const ALLOWED_METHODS = new Set([
  'getLatestBlockhash',
  'getSignatureStatuses',
  'sendTransaction',
  'simulateTransaction',
  'getSignaturesForAddress',
  'getTransaction',
  'getParsedTransaction',
  'getTokenAccountsByOwner',
  'getBalance',
  'getAccountInfo',
  'getMultipleAccounts',
]);

// A serialized v0 transaction is at most 1232 bytes, under 2 KiB as base64; 64 KiB leaves room
// for every allowed method's params without accepting arbitrary payloads.
const MAX_BODY_BYTES = 65536;

function reject(status: number, reason: string): Response {
  return new Response(reason, { status, headers: { 'content-type': 'text/plain' } });
}

// A single JSON-RPC response object. Error objects pass through on purpose: web3.js Connection
// reads error.message and error.data.logs to build SendTransactionError.
function isJsonRpcResponse(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    ('result' in value || 'error' in value)
  );
}

export async function POST(req: Request): Promise<Response> {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) return reject(413, 'body too large');

  let raw: ArrayBuffer;
  try {
    raw = await req.arrayBuffer();
  } catch {
    return reject(400, 'unreadable body');
  }
  if (raw.byteLength > MAX_BODY_BYTES) return reject(413, 'body too large');
  const text = new TextDecoder().decode(raw);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return reject(400, 'invalid json');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return reject(400, 'single json-rpc request expected');
  }
  const method = (body as { method?: unknown }).method;
  if (typeof method !== 'string' || !ALLOWED_METHODS.has(method)) {
    return reject(400, 'method not allowed');
  }

  const upstreamUrl = process.env.HELIUS_RPC_URL;
  if (!upstreamUrl) return reject(500, 'rpc not configured');

  let ok: boolean;
  let status: number;
  let upstreamText: string;
  let secrets: string[];
  try {
    const target = new URL(upstreamUrl);
    secrets = [upstreamUrl, target.hostname, target.searchParams.get('api-key') ?? ''].filter(
      (s) => s.length > 0,
    );
    const upstream = await fetch(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: text,
      cache: 'no-store',
    });
    ok = upstream.ok;
    status = upstream.status;
    upstreamText = await upstream.text();
  } catch {
    return reject(502, 'upstream unreachable');
  }
  if (!ok) return reject(status, 'upstream error');

  let upstreamBody: unknown;
  try {
    upstreamBody = JSON.parse(upstreamText);
  } catch {
    return reject(502, 'bad upstream response');
  }
  if (!isJsonRpcResponse(upstreamBody)) return reject(502, 'bad upstream response');
  // The raw text can hide a marker behind \uXXXX escapes; re-serializing the parsed body writes
  // every string value and property name at every depth plainly, so both forms are checked.
  let reserialized: string;
  try {
    reserialized = JSON.stringify(upstreamBody);
  } catch {
    return reject(502, 'bad upstream response');
  }
  if (secrets.some((s) => upstreamText.includes(s) || reserialized.includes(s))) {
    return reject(502, 'bad upstream response');
  }

  return new Response(upstreamText, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

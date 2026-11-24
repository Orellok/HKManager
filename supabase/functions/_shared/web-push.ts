/**
 * Web Push with Web Crypto only (M7.2-5, NOTIF-4): message encryption per RFC 8291
 * (aes128gcm, RFC 8188) and the VAPID authorization per RFC 8292 (ES256 JWT). Runs unchanged
 * on Supabase Edge Functions (Deno) and in Node 22 (tests), with no dependency: both provide
 * `crypto.subtle`, `fetch`, `btoa` and `atob`.
 */

/** A browser's push subscription as stored in `push_subscriptions`. */
export type PushTarget = { endpoint: string; p256dh: string; auth: string };

/** The application server's VAPID identity (base64url keys, as the key script writes them). */
export type VapidKeys = {
  /** Uncompressed P-256 point, 65 bytes. */
  publicKey: string;
  /** The private scalar d, 32 bytes. */
  privateKey: string;
  /** `mailto:` or `https:` contact (RFC 8292 section 2.1). */
  subject: string;
};

const P256_POINT_LENGTH = 65;
const P256_SCALAR_LENGTH = 32;
const AUTH_SECRET_LENGTH = 16;
const SALT_LENGTH = 16;
/** One record holds the whole message (push services accept at most 4096 bytes). */
const RECORD_SIZE = 4096;
const MAX_PAYLOAD_BYTES = 3000;
/** RFC 8292: the token must expire within 24 hours; 12 hours leaves room for clock skew. */
const VAPID_TOKEN_LIFETIME_SECONDS = 12 * 60 * 60;
const textEncoder = new TextEncoder();

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decodes base64url (padding optional); throws on any other character. */
export function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(value)) {
    throw new TypeError("Not base64url");
  }
  const base64 = value.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function decodeExact(value: string, length: number, name: string): Uint8Array<ArrayBuffer> {
  const bytes = base64UrlDecode(value);
  if (bytes.length !== length) {
    throw new TypeError(`${name} must be ${length} bytes`);
  }
  return bytes;
}

function decodePoint(value: string, name: string): Uint8Array<ArrayBuffer> {
  const point = decodeExact(value, P256_POINT_LENGTH, name);
  if (point[0] !== 0x04) {
    throw new TypeError(`${name} must be an uncompressed P-256 point`);
  }
  return point;
}

/** A P-256 private key as JWK, from the raw scalar and the matching public point. */
function privateJwk(privateKey: string, publicPoint: Uint8Array): JsonWebKey {
  decodeExact(privateKey, P256_SCALAR_LENGTH, "The private key");
  return {
    kty: "EC",
    crv: "P-256",
    d: privateKey.replace(/=+$/, ""),
    x: base64UrlEncode(publicPoint.subarray(1, 33)),
    y: base64UrlEncode(publicPoint.subarray(33, 65)),
    ext: true,
  };
}

/** An ECDH key pair given as raw keys (tests use RFC 8291's fixed sender keys). */
export type SenderKeys = { publicKey: string; privateKey: string };

async function senderKeyPair(fixed?: SenderKeys) {
  if (fixed) {
    const publicPoint = decodePoint(fixed.publicKey, "The sender public key");
    const privateKey = await crypto.subtle.importKey(
      "jwk",
      privateJwk(fixed.privateKey, publicPoint),
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    );
    return { privateKey, publicPoint };
  }
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const publicPoint = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { privateKey: pair.privateKey, publicPoint };
}

async function hkdf(
  ikm: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  bits: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bits),
  );
}

export type EncryptOptions = {
  /** RFC 8291 test vectors only: fixed salt and sender keys. Random when omitted. */
  salt?: Uint8Array<ArrayBuffer>;
  senderKeys?: SenderKeys;
};

/**
 * RFC 8291 section 3 / RFC 8188: the request body for `payload` to the subscription's
 * user agent – salt, record size, the sender's public key, then one AES-128-GCM record.
 */
export async function encryptPayload(
  target: Pick<PushTarget, "p256dh" | "auth">,
  payload: Uint8Array,
  options: EncryptOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  if (payload.length > MAX_PAYLOAD_BYTES) {
    throw new RangeError("The push payload is too large");
  }
  const receiverPoint = decodePoint(target.p256dh, "p256dh");
  const authSecret = decodeExact(target.auth, AUTH_SECRET_LENGTH, "auth");
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  if (salt.length !== SALT_LENGTH) {
    throw new TypeError("The salt must be 16 bytes");
  }
  const sender = await senderKeyPair(options.senderKeys);
  const receiverKey = await crypto.subtle.importKey(
    "raw",
    receiverPoint,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: receiverKey }, sender.privateKey, 256),
  );
  const keyInfo = concat(textEncoder.encode("WebPush: info\0"), receiverPoint, sender.publicPoint);
  const ikm = await hkdf(ecdhSecret, authSecret, keyInfo, 256);
  const contentKey = await hkdf(
    ikm,
    salt,
    textEncoder.encode("Content-Encoding: aes128gcm\0"),
    128,
  );
  const nonce = await hkdf(ikm, salt, textEncoder.encode("Content-Encoding: nonce\0"), 96);
  const aesKey = await crypto.subtle.importKey("raw", contentKey, "AES-GCM", false, ["encrypt"]);
  // 0x02: the last (and only) record, no padding.
  const record = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      aesKey,
      concat(payload, new Uint8Array([0x02])),
    ),
  );
  const header = new Uint8Array(SALT_LENGTH + 4 + 1);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(SALT_LENGTH, RECORD_SIZE);
  header[SALT_LENGTH + 4] = P256_POINT_LENGTH;
  return concat(header, sender.publicPoint, record);
}

/** RFC 8292: `Authorization: vapid t=<ES256 JWT>, k=<public key>` for the endpoint's origin. */
export async function vapidAuthorization(
  endpoint: string,
  vapid: VapidKeys,
  now: Date = new Date(),
): Promise<string> {
  const publicPoint = decodePoint(vapid.publicKey, "The VAPID public key");
  const signingKey = await crypto.subtle.importKey(
    "jwk",
    privateJwk(vapid.privateKey, publicPoint),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const encodeJson = (value: object) => base64UrlEncode(textEncoder.encode(JSON.stringify(value)));
  const unsigned = `${encodeJson({ typ: "JWT", alg: "ES256" })}.${encodeJson({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now.getTime() / 1000) + VAPID_TOKEN_LIFETIME_SECONDS,
    sub: vapid.subject,
  })}`;
  // Web Crypto returns the IEEE P1363 form (r || s), which is what JWS ES256 uses.
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      signingKey,
      textEncoder.encode(unsigned),
    ),
  );
  return `vapid t=${unsigned}.${base64UrlEncode(signature)}, k=${base64UrlEncode(publicPoint)}`;
}

export type SendOptions = {
  /** Seconds the push service keeps the message while the device is unreachable. */
  ttlSeconds: number;
  urgency: "very-low" | "low" | "normal" | "high";
  /** Replaces an undelivered message with the same topic (RFC 8030 section 5.4). */
  topic?: string;
  now?: Date;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 10_000;

/** Sends one encrypted message; returns the push service's HTTP status (never throws on 4xx/5xx). */
export async function sendWebPush(
  target: PushTarget,
  payload: string,
  vapid: VapidKeys,
  options: SendOptions,
): Promise<number> {
  const endpoint = new URL(target.endpoint);
  if (endpoint.protocol !== "https:") {
    throw new TypeError("The push endpoint must be https");
  }
  const body = await encryptPayload(target, textEncoder.encode(payload));
  const headers: Record<string, string> = {
    Authorization: await vapidAuthorization(target.endpoint, vapid, options.now),
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(options.ttlSeconds),
    Urgency: options.urgency,
  };
  if (options.topic) {
    headers.Topic = options.topic;
  }
  const response = await (options.fetchImpl ?? fetch)(endpoint, {
    method: "POST",
    headers,
    body,
    redirect: "error",
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  // The body is not needed; reading it frees the connection.
  await response.body?.cancel();
  return response.status;
}

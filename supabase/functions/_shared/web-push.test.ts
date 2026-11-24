import { describe, expect, it, vi } from "vitest";

import {
  base64UrlDecode,
  base64UrlEncode,
  encryptPayload,
  sendWebPush,
  vapidAuthorization,
  type VapidKeys,
} from "./web-push.ts";

// RFC 8291 Appendix A.
const RFC_PLAINTEXT = "When I grow up, I want to be a watermelon";
const RFC_SENDER = {
  publicKey:
    "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  privateKey: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
};
const RFC_RECEIVER = {
  publicKey:
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  privateKey: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
};
const RFC_AUTH = "BTBZMqHH6r4Tts7J_aSIgg";
const RFC_SALT = "DGv6ra1nlYgDCS1FRnbzlw";
const RFC_BODY =
  "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN";

const encoder = new TextEncoder();

async function newKeyPair(usage: "ECDH" | "ECDSA") {
  const pair = (await crypto.subtle.generateKey(
    { name: usage, namedCurve: "P-256" },
    true,
    usage === "ECDH" ? ["deriveBits"] : ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { pair, publicKey: base64UrlEncode(raw), privateKey: jwk.d ?? "" };
}

async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: string | Uint8Array, bits: number) {
  const key = await crypto.subtle.importKey("raw", new Uint8Array(ikm), "HKDF", false, [
    "deriveBits",
  ]);
  const infoBytes = typeof info === "string" ? encoder.encode(info) : info;
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new Uint8Array(salt),
        info: new Uint8Array(infoBytes),
      },
      key,
      bits,
    ),
  );
}

/** The user agent's side of RFC 8291, written independently of the code under test. */
async function decrypt(body: Uint8Array, receiver: CryptoKeyPair, auth: Uint8Array) {
  const salt = body.subarray(0, 16);
  const recordSize = new DataView(body.buffer, body.byteOffset).getUint32(16);
  const keyLength = body[20];
  const senderPoint = body.subarray(21, 21 + keyLength);
  const record = body.subarray(21 + keyLength);
  const receiverPoint = new Uint8Array(await crypto.subtle.exportKey("raw", receiver.publicKey));
  const senderKey = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(senderPoint),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const secret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: senderKey }, receiver.privateKey, 256),
  );
  const info = new Uint8Array([
    ...encoder.encode("WebPush: info\0"),
    ...receiverPoint,
    ...senderPoint,
  ]);
  const ikm = await hkdf(secret, auth, info, 256);
  const cek = await hkdf(ikm, salt, "Content-Encoding: aes128gcm\0", 128);
  const nonce = await hkdf(ikm, salt, "Content-Encoding: nonce\0", 96);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, new Uint8Array(record)),
  );
  return {
    recordSize,
    keyLength,
    delimiter: plain[plain.length - 1],
    text: new TextDecoder().decode(plain.subarray(0, -1)),
  };
}

async function receiverKeys() {
  const receiver = await newKeyPair("ECDH");
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { receiver, target: { p256dh: receiver.publicKey, auth: base64UrlEncode(auth) }, auth };
}

describe("M7.2-5: RFC 8291 message encryption", () => {
  it("M7.2-5: reproduces the RFC 8291 Appendix A example byte for byte", async () => {
    const body = await encryptPayload(
      { p256dh: RFC_RECEIVER.publicKey, auth: RFC_AUTH },
      encoder.encode(RFC_PLAINTEXT),
      { salt: base64UrlDecode(RFC_SALT), senderKeys: RFC_SENDER },
    );
    expect(base64UrlEncode(body)).toBe(RFC_BODY);
  });

  it("M7.2-5: a user agent decrypts a random-key message (one 4096 record, final delimiter)", async () => {
    const { receiver, target, auth } = await receiverKeys();
    const body = await encryptPayload(target, encoder.encode("2 משימות להיום · 1 למחר"));
    const result = await decrypt(body, receiver.pair, auth);
    expect(result).toEqual({
      recordSize: 4096,
      keyLength: 65,
      delimiter: 2,
      text: "2 משימות להיום · 1 למחר",
    });
  });

  it("M7.2-5: two messages never share a salt or a sender key", async () => {
    const { target } = await receiverKeys();
    const first = await encryptPayload(target, encoder.encode("x"));
    const second = await encryptPayload(target, encoder.encode("x"));
    expect(base64UrlEncode(first.subarray(0, 16))).not.toBe(
      base64UrlEncode(second.subarray(0, 16)),
    );
    expect(base64UrlEncode(first.subarray(21, 86))).not.toBe(
      base64UrlEncode(second.subarray(21, 86)),
    );
  });

  it("M7.2-5: rejects malformed subscription keys and oversized payloads", async () => {
    const { target } = await receiverKeys();
    const payload = encoder.encode("x");
    await expect(encryptPayload({ ...target, p256dh: "AAAA" }, payload)).rejects.toThrow(/p256dh/);
    await expect(
      encryptPayload({ ...target, p256dh: `A${target.p256dh.slice(1)}` }, payload),
    ).rejects.toThrow(/uncompressed/);
    await expect(encryptPayload({ ...target, auth: "AAAA" }, payload)).rejects.toThrow(/auth/);
    await expect(encryptPayload({ ...target, auth: "!!" }, payload)).rejects.toThrow(/base64url/);
    await expect(encryptPayload(target, new Uint8Array(3001))).rejects.toThrow(/too large/);
  });
});

async function vapidKeys(): Promise<VapidKeys & { verifyKey: CryptoKey }> {
  const keys = await newKeyPair("ECDSA");
  return { ...keys, subject: "https://hkmanager.example", verifyKey: keys.pair.publicKey };
}

function decodeJson(part: string) {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(part)));
}

describe("M7.2-5: RFC 8292 VAPID authorization", () => {
  it("M7.2-5: an ES256 JWT for the endpoint origin, verifiable with the public key", async () => {
    const vapid = await vapidKeys();
    const now = new Date("2026-11-24T07:00:00Z");
    const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", vapid, now);
    const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, head, claims, signature, key] = match ?? [];
    expect(decodeJson(head)).toEqual({ typ: "JWT", alg: "ES256" });
    expect(decodeJson(claims)).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: Math.floor(now.getTime() / 1000) + 12 * 3600,
      sub: "https://hkmanager.example",
    });
    expect(key).toBe(vapid.publicKey);
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      vapid.verifyKey,
      base64UrlDecode(signature),
      encoder.encode(`${head}.${claims}`),
    );
    expect(valid).toBe(true);
  });

  it("M7.2-5: a private key of the wrong length is rejected", async () => {
    const vapid = await vapidKeys();
    await expect(
      vapidAuthorization("https://fcm.googleapis.com/x", { ...vapid, privateKey: "AAAA" }),
    ).rejects.toThrow(/32 bytes/);
  });
});

describe("M7.2-5: sending", () => {
  it("M7.2-5: POSTs the encrypted body with TTL, urgency, topic and VAPID headers", async () => {
    const vapid = await vapidKeys();
    const { receiver, target, auth } = await receiverKeys();
    const fetchImpl = vi.fn(async () => new Response(null, { status: 201 }));
    const status = await sendWebPush(
      { ...target, endpoint: "https://fcm.googleapis.com/fcm/send/abc" },
      '{"title":"HKManager"}',
      vapid,
      { ttlSeconds: 43200, urgency: "high", topic: "daily", fetchImpl },
    );
    expect(status).toBe(201);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://fcm.googleapis.com/fcm/send/abc");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    const headers = init.headers as Record<string, string>;
    expect(headers).toMatchObject({
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "43200",
      Urgency: "high",
      Topic: "daily",
    });
    expect(headers.Authorization).toMatch(/^vapid t=.+, k=.+$/);
    const decrypted = await decrypt(init.body as Uint8Array, receiver.pair, auth);
    expect(decrypted.text).toBe('{"title":"HKManager"}');
  });

  it("M7.2-5: returns 4xx/5xx statuses instead of throwing; refuses non-https endpoints", async () => {
    const vapid = await vapidKeys();
    const { target } = await receiverKeys();
    const gone = vi.fn(async () => new Response("gone", { status: 410 }));
    const options = { ttlSeconds: 60, urgency: "high" as const, fetchImpl: gone };
    expect(
      await sendWebPush(
        { ...target, endpoint: "https://fcm.googleapis.com/x" },
        "{}",
        vapid,
        options,
      ),
    ).toBe(410);
    await expect(
      sendWebPush({ ...target, endpoint: "http://fcm.googleapis.com/x" }, "{}", vapid, options),
    ).rejects.toThrow(/https/);
  });
});

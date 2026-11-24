/**
 * A browser's side of Web Push for tests (RFC 8291), written independently of
 * supabase/functions/_shared/web-push.ts: a subscription key pair, and decryption of a body.
 */

const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, bits: number) {
  const key = await crypto.subtle.importKey("raw", new Uint8Array(ikm), "HKDF", false, [
    "deriveBits",
  ]);
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(salt), info: new Uint8Array(info) },
      key,
      bits,
    ),
  );
}

export type TestReceiver = {
  /** base64url, as a browser's PushSubscription.getKey() would give after encoding. */
  p256dh: string;
  auth: string;
  decrypt(body: Uint8Array): Promise<string>;
};

export async function createTestReceiver(): Promise<TestReceiver> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const receiverPoint = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    p256dh: base64Url(receiverPoint),
    auth: base64Url(auth),
    async decrypt(body: Uint8Array) {
      const salt = body.subarray(0, 16);
      const keyLength = body[20];
      const senderPoint = body.subarray(21, 21 + keyLength);
      const record = body.subarray(21 + keyLength);
      const senderKey = await crypto.subtle.importKey(
        "raw",
        new Uint8Array(senderPoint),
        { name: "ECDH", namedCurve: "P-256" },
        false,
        [],
      );
      const secret = new Uint8Array(
        await crypto.subtle.deriveBits({ name: "ECDH", public: senderKey }, pair.privateKey, 256),
      );
      const info = new Uint8Array([
        ...encoder.encode("WebPush: info\0"),
        ...receiverPoint,
        ...senderPoint,
      ]);
      const ikm = await hkdf(secret, auth, info, 256);
      const cek = await hkdf(ikm, salt, encoder.encode("Content-Encoding: aes128gcm\0"), 128);
      const nonce = await hkdf(ikm, salt, encoder.encode("Content-Encoding: nonce\0"), 96);
      const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
      const plain = new Uint8Array(
        await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, new Uint8Array(record)),
      );
      if (plain[plain.length - 1] !== 2) {
        throw new Error("Expected a single final record");
      }
      return new TextDecoder().decode(plain.subarray(0, -1));
    },
  };
}

/** A fresh VAPID key pair as the key script writes it (base64url). */
export async function createTestVapidKeys(subject = "https://hkmanager.test") {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const publicKey = base64Url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  return { publicKey, privateKey: jwk.d ?? "", subject };
}

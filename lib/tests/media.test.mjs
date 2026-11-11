import test from "node:test";
import assert from "node:assert/strict";
import { encryptAttachment, decryptAttachment } from "../src/media.mjs";
test("attachments round trip and reject tampering, wrong conversation and size overruns", () => {
  const plaintext = Buffer.from("private attachment test"),
    c = "conversation",
    id = "client";
  const e = encryptAttachment(
      { buffer: plaintext, contentType: "image/png", fileName: "../image.png" },
      c,
      id,
    ),
    cipher = Buffer.from(e.ciphertext, "base64");
  assert.equal(e.manifest.name, "image.png");
  assert.equal(cipher.includes(plaintext), false);
  assert.deepEqual(
    decryptAttachment(cipher, e.manifest, c, id, 1000),
    plaintext,
  );
  assert.throws(() => decryptAttachment(cipher, e.manifest, "other", id, 1000));
  assert.throws(() => decryptAttachment(cipher, e.manifest, c, id, 2));
  cipher[0] ^= 1;
  assert.throws(() => decryptAttachment(cipher, e.manifest, c, id, 1000));
});

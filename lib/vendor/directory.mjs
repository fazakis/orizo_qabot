var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod2) => function __require() {
  return mod2 || (0, cb[__getOwnPropNames(cb)[0]])((mod2 = { exports: {} }).exports, mod2), mod2.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod2, isNodeMode, target) => (target = mod2 != null ? __create(__getProtoOf(mod2)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod2 || !mod2.__esModule ? __defProp(target, "default", { value: mod2, enumerable: true }) : target,
  mod2
));

// source/directory/node_modules/base64-js/index.js
var require_base64_js = __commonJS({
  "source/directory/node_modules/base64-js/index.js"(exports) {
    "use strict";
    exports.byteLength = byteLength;
    exports.toByteArray = toByteArray7;
    exports.fromByteArray = fromByteArray6;
    var lookup = [];
    var revLookup = [];
    var Arr = typeof Uint8Array !== "undefined" ? Uint8Array : Array;
    var code = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (i = 0, len = code.length; i < len; ++i) {
      lookup[i] = code[i];
      revLookup[code.charCodeAt(i)] = i;
    }
    var i;
    var len;
    revLookup["-".charCodeAt(0)] = 62;
    revLookup["_".charCodeAt(0)] = 63;
    function getLens(b64) {
      var len2 = b64.length;
      if (len2 % 4 > 0) {
        throw new Error("Invalid string. Length must be a multiple of 4");
      }
      var validLen = b64.indexOf("=");
      if (validLen === -1) validLen = len2;
      var placeHoldersLen = validLen === len2 ? 0 : 4 - validLen % 4;
      return [validLen, placeHoldersLen];
    }
    function byteLength(b64) {
      var lens = getLens(b64);
      var validLen = lens[0];
      var placeHoldersLen = lens[1];
      return (validLen + placeHoldersLen) * 3 / 4 - placeHoldersLen;
    }
    function _byteLength(b64, validLen, placeHoldersLen) {
      return (validLen + placeHoldersLen) * 3 / 4 - placeHoldersLen;
    }
    function toByteArray7(b64) {
      var tmp;
      var lens = getLens(b64);
      var validLen = lens[0];
      var placeHoldersLen = lens[1];
      var arr = new Arr(_byteLength(b64, validLen, placeHoldersLen));
      var curByte = 0;
      var len2 = placeHoldersLen > 0 ? validLen - 4 : validLen;
      var i2;
      for (i2 = 0; i2 < len2; i2 += 4) {
        tmp = revLookup[b64.charCodeAt(i2)] << 18 | revLookup[b64.charCodeAt(i2 + 1)] << 12 | revLookup[b64.charCodeAt(i2 + 2)] << 6 | revLookup[b64.charCodeAt(i2 + 3)];
        arr[curByte++] = tmp >> 16 & 255;
        arr[curByte++] = tmp >> 8 & 255;
        arr[curByte++] = tmp & 255;
      }
      if (placeHoldersLen === 2) {
        tmp = revLookup[b64.charCodeAt(i2)] << 2 | revLookup[b64.charCodeAt(i2 + 1)] >> 4;
        arr[curByte++] = tmp & 255;
      }
      if (placeHoldersLen === 1) {
        tmp = revLookup[b64.charCodeAt(i2)] << 10 | revLookup[b64.charCodeAt(i2 + 1)] << 4 | revLookup[b64.charCodeAt(i2 + 2)] >> 2;
        arr[curByte++] = tmp >> 8 & 255;
        arr[curByte++] = tmp & 255;
      }
      return arr;
    }
    function tripletToBase64(num) {
      return lookup[num >> 18 & 63] + lookup[num >> 12 & 63] + lookup[num >> 6 & 63] + lookup[num & 63];
    }
    function encodeChunk(uint8, start, end) {
      var tmp;
      var output = [];
      for (var i2 = start; i2 < end; i2 += 3) {
        tmp = (uint8[i2] << 16 & 16711680) + (uint8[i2 + 1] << 8 & 65280) + (uint8[i2 + 2] & 255);
        output.push(tripletToBase64(tmp));
      }
      return output.join("");
    }
    function fromByteArray6(uint8) {
      var tmp;
      var len2 = uint8.length;
      var extraBytes = len2 % 3;
      var parts = [];
      var maxChunkLength = 16383;
      for (var i2 = 0, len22 = len2 - extraBytes; i2 < len22; i2 += maxChunkLength) {
        parts.push(encodeChunk(uint8, i2, i2 + maxChunkLength > len22 ? len22 : i2 + maxChunkLength));
      }
      if (extraBytes === 1) {
        tmp = uint8[len2 - 1];
        parts.push(
          lookup[tmp >> 2] + lookup[tmp << 4 & 63] + "=="
        );
      } else if (extraBytes === 2) {
        tmp = (uint8[len2 - 2] << 8) + uint8[len2 - 1];
        parts.push(
          lookup[tmp >> 10] + lookup[tmp >> 4 & 63] + lookup[tmp << 2 & 63] + "="
        );
      }
      return parts.join("");
    }
  }
});

// source/directory/src/e2ee/directoryIdentity.ts
var import_base64_js2 = __toESM(require_base64_js(), 1);

// source/directory/node_modules/@noble/hashes/utils.js
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
}
function anumber(n, title = "") {
  if (typeof n !== "number") {
    const prefix = title && `"${title}" `;
    throw new TypeError(`${prefix}expected number, got ${typeof n}`);
  }
  if (!Number.isSafeInteger(n) || n < 0) {
    const prefix = title && `"${title}" `;
    throw new RangeError(`${prefix}expected integer >= 0, got ${n}`);
  }
}
function abytes(value, length, title = "") {
  const bytes = isBytes(value);
  const len = value?.length;
  const needsLen = length !== void 0;
  if (!bytes || needsLen && len !== length) {
    const prefix = title && `"${title}" `;
    const ofLen = needsLen ? ` of length ${length}` : "";
    const got = bytes ? `length=${len}` : `type=${typeof value}`;
    const message = prefix + "expected Uint8Array" + ofLen + ", got " + got;
    if (!bytes)
      throw new TypeError(message);
    throw new RangeError(message);
  }
  return value;
}
function aexists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (checkFinished && instance.finished)
    throw new Error("Hash#digest() has already been called");
}
function aoutput(out, instance) {
  abytes(out, void 0, "digestInto() output");
  const min = instance.outputLen;
  if (out.length < min) {
    throw new RangeError('"digestInto() output" expected to be of length >=' + min);
  }
}
function clean(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
function rotr(word, shift) {
  return word << 32 - shift | word >>> shift;
}
var hasHexBuiltin = /* @__PURE__ */ (() => (
  // @ts-ignore
  typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function"
))();
var hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
function bytesToHex(bytes) {
  abytes(bytes);
  if (hasHexBuiltin)
    return bytes.toHex();
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += hexes[bytes[i]];
  }
  return hex;
}
var asciis = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
function asciiToBase16(ch) {
  if (ch >= asciis._0 && ch <= asciis._9)
    return ch - asciis._0;
  if (ch >= asciis.A && ch <= asciis.F)
    return ch - (asciis.A - 10);
  if (ch >= asciis.a && ch <= asciis.f)
    return ch - (asciis.a - 10);
  return;
}
function hexToBytes(hex) {
  if (typeof hex !== "string")
    throw new TypeError("hex string expected, got " + typeof hex);
  if (hasHexBuiltin) {
    try {
      return Uint8Array.fromHex(hex);
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new RangeError(error.message);
      throw error;
    }
  }
  const hl = hex.length;
  const al = hl / 2;
  if (hl % 2)
    throw new RangeError("hex string expected, got unpadded hex of length " + hl);
  const array = new Uint8Array(al);
  for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
    const n1 = asciiToBase16(hex.charCodeAt(hi));
    const n2 = asciiToBase16(hex.charCodeAt(hi + 1));
    if (n1 === void 0 || n2 === void 0) {
      const char = hex[hi] + hex[hi + 1];
      throw new RangeError('hex string expected, got non-hex character "' + char + '" at index ' + hi);
    }
    array[ai] = n1 * 16 + n2;
  }
  return array;
}
function utf8ToBytes(str) {
  if (typeof str !== "string")
    throw new TypeError("string expected");
  return new Uint8Array(new TextEncoder().encode(str));
}
function concatBytes(...arrays) {
  let sum = 0;
  for (let i = 0; i < arrays.length; i++) {
    const a = arrays[i];
    abytes(a);
    sum += a.length;
  }
  const res = new Uint8Array(sum);
  for (let i = 0, pad = 0; i < arrays.length; i++) {
    const a = arrays[i];
    res.set(a, pad);
    pad += a.length;
  }
  return res;
}
function createHasher(hashCons, info = {}) {
  const hashC = (msg, opts) => hashCons(opts).update(msg).digest();
  const tmp = hashCons(void 0);
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.canXOF = tmp.canXOF;
  hashC.create = (opts) => hashCons(opts);
  Object.assign(hashC, info);
  return Object.freeze(hashC);
}
function randomBytes(bytesLength = 32) {
  anumber(bytesLength, "bytesLength");
  const cr = typeof globalThis === "object" ? globalThis.crypto : null;
  if (typeof cr?.getRandomValues !== "function")
    throw new Error("crypto.getRandomValues must be defined");
  if (bytesLength > 65536)
    throw new RangeError(`"bytesLength" expected <= 65536, got ${bytesLength}`);
  return cr.getRandomValues(new Uint8Array(bytesLength));
}
var oidNist = (suffix) => ({
  // Current NIST hashAlgs suffixes used here fit in one DER subidentifier octet.
  // Larger suffix values would need base-128 OID encoding and a different length byte.
  oid: Uint8Array.from([6, 9, 96, 134, 72, 1, 101, 3, 4, 2, suffix])
});

// source/directory/node_modules/@noble/hashes/_md.js
function Chi(a, b, c) {
  return a & b ^ ~a & c;
}
function Maj(a, b, c) {
  return a & b ^ a & c ^ b & c;
}
var HashMD = class {
  blockLen;
  outputLen;
  canXOF = false;
  padOffset;
  isLE;
  // For partial updates less than block size
  buffer;
  view;
  finished = false;
  length = 0;
  pos = 0;
  destroyed = false;
  constructor(blockLen, outputLen, padOffset, isLE) {
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.padOffset = padOffset;
    this.isLE = isLE;
    this.buffer = new Uint8Array(blockLen);
    this.view = createView(this.buffer);
  }
  update(data) {
    aexists(this);
    abytes(data);
    const { view, buffer, blockLen } = this;
    const len = data.length;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        const dataView = createView(data);
        for (; blockLen <= len - pos; pos += blockLen)
          this.process(dataView, pos);
        continue;
      }
      buffer.set(data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(view, 0);
        this.pos = 0;
      }
    }
    this.length += data.length;
    this.roundClean();
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    this.finished = true;
    const { buffer, view, blockLen, isLE } = this;
    let { pos } = this;
    buffer[pos++] = 128;
    clean(this.buffer.subarray(pos));
    if (this.padOffset > blockLen - pos) {
      this.process(view, 0);
      pos = 0;
    }
    for (let i = pos; i < blockLen; i++)
      buffer[i] = 0;
    view.setBigUint64(blockLen - 8, BigInt(this.length * 8), isLE);
    this.process(view, 0);
    const oview = createView(out);
    const len = this.outputLen;
    if (len % 4)
      throw new Error("_sha2: outputLen must be aligned to 32bit");
    const outLen = len / 4;
    const state = this.get();
    if (outLen > state.length)
      throw new Error("_sha2: outputLen bigger than state");
    for (let i = 0; i < outLen; i++)
      oview.setUint32(4 * i, state[i], isLE);
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneInto(to) {
    to ||= new this.constructor();
    to.set(...this.get());
    const { blockLen, buffer, length, finished, destroyed, pos } = this;
    to.destroyed = destroyed;
    to.finished = finished;
    to.length = length;
    to.pos = pos;
    if (length % blockLen)
      to.buffer.set(buffer);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
};
var SHA256_IV = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]);
var SHA512_IV = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  4089235720,
  3144134277,
  2227873595,
  1013904242,
  4271175723,
  2773480762,
  1595750129,
  1359893119,
  2917565137,
  2600822924,
  725511199,
  528734635,
  4215389547,
  1541459225,
  327033209
]);

// source/directory/node_modules/@noble/hashes/_u64.js
var U32_MASK64 = /* @__PURE__ */ BigInt(2 ** 32 - 1);
var _32n = /* @__PURE__ */ BigInt(32);
function fromBig(n, le = false) {
  if (le)
    return { h: Number(n & U32_MASK64), l: Number(n >> _32n & U32_MASK64) };
  return { h: Number(n >> _32n & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
}
function split(lst, le = false) {
  const len = lst.length;
  let Ah = new Uint32Array(len);
  let Al = new Uint32Array(len);
  for (let i = 0; i < len; i++) {
    const { h, l } = fromBig(lst[i], le);
    [Ah[i], Al[i]] = [h, l];
  }
  return [Ah, Al];
}
var shrSH = (h, _l, s) => h >>> s;
var shrSL = (h, l, s) => h << 32 - s | l >>> s;
var rotrSH = (h, l, s) => h >>> s | l << 32 - s;
var rotrSL = (h, l, s) => h << 32 - s | l >>> s;
var rotrBH = (h, l, s) => h << 64 - s | l >>> s - 32;
var rotrBL = (h, l, s) => h >>> s - 32 | l << 64 - s;
function add(Ah, Al, Bh, Bl) {
  const l = (Al >>> 0) + (Bl >>> 0);
  return { h: Ah + Bh + (l / 2 ** 32 | 0) | 0, l: l | 0 };
}
var add3L = (Al, Bl, Cl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0);
var add3H = (low, Ah, Bh, Ch) => Ah + Bh + Ch + (low / 2 ** 32 | 0) | 0;
var add4L = (Al, Bl, Cl, Dl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0);
var add4H = (low, Ah, Bh, Ch, Dh) => Ah + Bh + Ch + Dh + (low / 2 ** 32 | 0) | 0;
var add5L = (Al, Bl, Cl, Dl, El) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0) + (El >>> 0);
var add5H = (low, Ah, Bh, Ch, Dh, Eh) => Ah + Bh + Ch + Dh + Eh + (low / 2 ** 32 | 0) | 0;

// source/directory/node_modules/@noble/hashes/sha2.js
var SHA256_K = /* @__PURE__ */ Uint32Array.from([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var SHA256_W = /* @__PURE__ */ new Uint32Array(64);
var SHA2_32B = class extends HashMD {
  constructor(outputLen) {
    super(64, outputLen, 8, false);
  }
  get() {
    const { A, B, C, D, E, F, G, H } = this;
    return [A, B, C, D, E, F, G, H];
  }
  // prettier-ignore
  set(A, B, C, D, E, F, G, H) {
    this.A = A | 0;
    this.B = B | 0;
    this.C = C | 0;
    this.D = D | 0;
    this.E = E | 0;
    this.F = F | 0;
    this.G = G | 0;
    this.H = H | 0;
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4)
      SHA256_W[i] = view.getUint32(offset, false);
    for (let i = 16; i < 64; i++) {
      const W15 = SHA256_W[i - 15];
      const W2 = SHA256_W[i - 2];
      const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
      const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
      SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
    }
    let { A, B, C, D, E, F, G, H } = this;
    for (let i = 0; i < 64; i++) {
      const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
      const T1 = H + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
      const sigma0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
      const T2 = sigma0 + Maj(A, B, C) | 0;
      H = G;
      G = F;
      F = E;
      E = D + T1 | 0;
      D = C;
      C = B;
      B = A;
      A = T1 + T2 | 0;
    }
    A = A + this.A | 0;
    B = B + this.B | 0;
    C = C + this.C | 0;
    D = D + this.D | 0;
    E = E + this.E | 0;
    F = F + this.F | 0;
    G = G + this.G | 0;
    H = H + this.H | 0;
    this.set(A, B, C, D, E, F, G, H);
  }
  roundClean() {
    clean(SHA256_W);
  }
  destroy() {
    this.destroyed = true;
    this.set(0, 0, 0, 0, 0, 0, 0, 0);
    clean(this.buffer);
  }
};
var _SHA256 = class extends SHA2_32B {
  // We cannot use array here since array allows indexing by variable
  // which means optimizer/compiler cannot use registers.
  A = SHA256_IV[0] | 0;
  B = SHA256_IV[1] | 0;
  C = SHA256_IV[2] | 0;
  D = SHA256_IV[3] | 0;
  E = SHA256_IV[4] | 0;
  F = SHA256_IV[5] | 0;
  G = SHA256_IV[6] | 0;
  H = SHA256_IV[7] | 0;
  constructor() {
    super(32);
  }
};
var K512 = /* @__PURE__ */ (() => split([
  "0x428a2f98d728ae22",
  "0x7137449123ef65cd",
  "0xb5c0fbcfec4d3b2f",
  "0xe9b5dba58189dbbc",
  "0x3956c25bf348b538",
  "0x59f111f1b605d019",
  "0x923f82a4af194f9b",
  "0xab1c5ed5da6d8118",
  "0xd807aa98a3030242",
  "0x12835b0145706fbe",
  "0x243185be4ee4b28c",
  "0x550c7dc3d5ffb4e2",
  "0x72be5d74f27b896f",
  "0x80deb1fe3b1696b1",
  "0x9bdc06a725c71235",
  "0xc19bf174cf692694",
  "0xe49b69c19ef14ad2",
  "0xefbe4786384f25e3",
  "0x0fc19dc68b8cd5b5",
  "0x240ca1cc77ac9c65",
  "0x2de92c6f592b0275",
  "0x4a7484aa6ea6e483",
  "0x5cb0a9dcbd41fbd4",
  "0x76f988da831153b5",
  "0x983e5152ee66dfab",
  "0xa831c66d2db43210",
  "0xb00327c898fb213f",
  "0xbf597fc7beef0ee4",
  "0xc6e00bf33da88fc2",
  "0xd5a79147930aa725",
  "0x06ca6351e003826f",
  "0x142929670a0e6e70",
  "0x27b70a8546d22ffc",
  "0x2e1b21385c26c926",
  "0x4d2c6dfc5ac42aed",
  "0x53380d139d95b3df",
  "0x650a73548baf63de",
  "0x766a0abb3c77b2a8",
  "0x81c2c92e47edaee6",
  "0x92722c851482353b",
  "0xa2bfe8a14cf10364",
  "0xa81a664bbc423001",
  "0xc24b8b70d0f89791",
  "0xc76c51a30654be30",
  "0xd192e819d6ef5218",
  "0xd69906245565a910",
  "0xf40e35855771202a",
  "0x106aa07032bbd1b8",
  "0x19a4c116b8d2d0c8",
  "0x1e376c085141ab53",
  "0x2748774cdf8eeb99",
  "0x34b0bcb5e19b48a8",
  "0x391c0cb3c5c95a63",
  "0x4ed8aa4ae3418acb",
  "0x5b9cca4f7763e373",
  "0x682e6ff3d6b2b8a3",
  "0x748f82ee5defb2fc",
  "0x78a5636f43172f60",
  "0x84c87814a1f0ab72",
  "0x8cc702081a6439ec",
  "0x90befffa23631e28",
  "0xa4506cebde82bde9",
  "0xbef9a3f7b2c67915",
  "0xc67178f2e372532b",
  "0xca273eceea26619c",
  "0xd186b8c721c0c207",
  "0xeada7dd6cde0eb1e",
  "0xf57d4f7fee6ed178",
  "0x06f067aa72176fba",
  "0x0a637dc5a2c898a6",
  "0x113f9804bef90dae",
  "0x1b710b35131c471b",
  "0x28db77f523047d84",
  "0x32caab7b40c72493",
  "0x3c9ebe0a15c9bebc",
  "0x431d67c49c100d4c",
  "0x4cc5d4becb3e42b6",
  "0x597f299cfc657e2a",
  "0x5fcb6fab3ad6faec",
  "0x6c44198c4a475817"
].map((n) => BigInt(n))))();
var SHA512_Kh = /* @__PURE__ */ (() => K512[0])();
var SHA512_Kl = /* @__PURE__ */ (() => K512[1])();
var SHA512_W_H = /* @__PURE__ */ new Uint32Array(80);
var SHA512_W_L = /* @__PURE__ */ new Uint32Array(80);
var SHA2_64B = class extends HashMD {
  constructor(outputLen) {
    super(128, outputLen, 16, false);
  }
  // prettier-ignore
  get() {
    const { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
    return [Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl];
  }
  // prettier-ignore
  set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl) {
    this.Ah = Ah | 0;
    this.Al = Al | 0;
    this.Bh = Bh | 0;
    this.Bl = Bl | 0;
    this.Ch = Ch | 0;
    this.Cl = Cl | 0;
    this.Dh = Dh | 0;
    this.Dl = Dl | 0;
    this.Eh = Eh | 0;
    this.El = El | 0;
    this.Fh = Fh | 0;
    this.Fl = Fl | 0;
    this.Gh = Gh | 0;
    this.Gl = Gl | 0;
    this.Hh = Hh | 0;
    this.Hl = Hl | 0;
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4) {
      SHA512_W_H[i] = view.getUint32(offset);
      SHA512_W_L[i] = view.getUint32(offset += 4);
    }
    for (let i = 16; i < 80; i++) {
      const W15h = SHA512_W_H[i - 15] | 0;
      const W15l = SHA512_W_L[i - 15] | 0;
      const s0h = rotrSH(W15h, W15l, 1) ^ rotrSH(W15h, W15l, 8) ^ shrSH(W15h, W15l, 7);
      const s0l = rotrSL(W15h, W15l, 1) ^ rotrSL(W15h, W15l, 8) ^ shrSL(W15h, W15l, 7);
      const W2h = SHA512_W_H[i - 2] | 0;
      const W2l = SHA512_W_L[i - 2] | 0;
      const s1h = rotrSH(W2h, W2l, 19) ^ rotrBH(W2h, W2l, 61) ^ shrSH(W2h, W2l, 6);
      const s1l = rotrSL(W2h, W2l, 19) ^ rotrBL(W2h, W2l, 61) ^ shrSL(W2h, W2l, 6);
      const SUMl = add4L(s0l, s1l, SHA512_W_L[i - 7], SHA512_W_L[i - 16]);
      const SUMh = add4H(SUMl, s0h, s1h, SHA512_W_H[i - 7], SHA512_W_H[i - 16]);
      SHA512_W_H[i] = SUMh | 0;
      SHA512_W_L[i] = SUMl | 0;
    }
    let { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
    for (let i = 0; i < 80; i++) {
      const sigma1h = rotrSH(Eh, El, 14) ^ rotrSH(Eh, El, 18) ^ rotrBH(Eh, El, 41);
      const sigma1l = rotrSL(Eh, El, 14) ^ rotrSL(Eh, El, 18) ^ rotrBL(Eh, El, 41);
      const CHIh = Eh & Fh ^ ~Eh & Gh;
      const CHIl = El & Fl ^ ~El & Gl;
      const T1ll = add5L(Hl, sigma1l, CHIl, SHA512_Kl[i], SHA512_W_L[i]);
      const T1h = add5H(T1ll, Hh, sigma1h, CHIh, SHA512_Kh[i], SHA512_W_H[i]);
      const T1l = T1ll | 0;
      const sigma0h = rotrSH(Ah, Al, 28) ^ rotrBH(Ah, Al, 34) ^ rotrBH(Ah, Al, 39);
      const sigma0l = rotrSL(Ah, Al, 28) ^ rotrBL(Ah, Al, 34) ^ rotrBL(Ah, Al, 39);
      const MAJh = Ah & Bh ^ Ah & Ch ^ Bh & Ch;
      const MAJl = Al & Bl ^ Al & Cl ^ Bl & Cl;
      Hh = Gh | 0;
      Hl = Gl | 0;
      Gh = Fh | 0;
      Gl = Fl | 0;
      Fh = Eh | 0;
      Fl = El | 0;
      ({ h: Eh, l: El } = add(Dh | 0, Dl | 0, T1h | 0, T1l | 0));
      Dh = Ch | 0;
      Dl = Cl | 0;
      Ch = Bh | 0;
      Cl = Bl | 0;
      Bh = Ah | 0;
      Bl = Al | 0;
      const All = add3L(T1l, sigma0l, MAJl);
      Ah = add3H(All, T1h, sigma0h, MAJh);
      Al = All | 0;
    }
    ({ h: Ah, l: Al } = add(this.Ah | 0, this.Al | 0, Ah | 0, Al | 0));
    ({ h: Bh, l: Bl } = add(this.Bh | 0, this.Bl | 0, Bh | 0, Bl | 0));
    ({ h: Ch, l: Cl } = add(this.Ch | 0, this.Cl | 0, Ch | 0, Cl | 0));
    ({ h: Dh, l: Dl } = add(this.Dh | 0, this.Dl | 0, Dh | 0, Dl | 0));
    ({ h: Eh, l: El } = add(this.Eh | 0, this.El | 0, Eh | 0, El | 0));
    ({ h: Fh, l: Fl } = add(this.Fh | 0, this.Fl | 0, Fh | 0, Fl | 0));
    ({ h: Gh, l: Gl } = add(this.Gh | 0, this.Gl | 0, Gh | 0, Gl | 0));
    ({ h: Hh, l: Hl } = add(this.Hh | 0, this.Hl | 0, Hh | 0, Hl | 0));
    this.set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl);
  }
  roundClean() {
    clean(SHA512_W_H, SHA512_W_L);
  }
  destroy() {
    this.destroyed = true;
    clean(this.buffer);
    this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  }
};
var _SHA512 = class extends SHA2_64B {
  Ah = SHA512_IV[0] | 0;
  Al = SHA512_IV[1] | 0;
  Bh = SHA512_IV[2] | 0;
  Bl = SHA512_IV[3] | 0;
  Ch = SHA512_IV[4] | 0;
  Cl = SHA512_IV[5] | 0;
  Dh = SHA512_IV[6] | 0;
  Dl = SHA512_IV[7] | 0;
  Eh = SHA512_IV[8] | 0;
  El = SHA512_IV[9] | 0;
  Fh = SHA512_IV[10] | 0;
  Fl = SHA512_IV[11] | 0;
  Gh = SHA512_IV[12] | 0;
  Gl = SHA512_IV[13] | 0;
  Hh = SHA512_IV[14] | 0;
  Hl = SHA512_IV[15] | 0;
  constructor() {
    super(64);
  }
};
var sha256 = /* @__PURE__ */ createHasher(
  () => new _SHA256(),
  /* @__PURE__ */ oidNist(1)
);
var sha512 = /* @__PURE__ */ createHasher(
  () => new _SHA512(),
  /* @__PURE__ */ oidNist(3)
);

// source/directory/src/e2ee/directoryCertificates.ts
var import_base64_js = __toESM(require_base64_js(), 1);

// source/directory/node_modules/@noble/curves/utils.js
var abytes2 = (value, length, title) => abytes(value, length, title);
var anumber2 = anumber;
var bytesToHex2 = bytesToHex;
var concatBytes2 = (...arrays) => concatBytes(...arrays);
var hexToBytes2 = (hex) => hexToBytes(hex);
var isBytes2 = isBytes;
var randomBytes2 = (bytesLength) => randomBytes(bytesLength);
var _0n = /* @__PURE__ */ BigInt(0);
var _1n = /* @__PURE__ */ BigInt(1);
function abool(value, title = "") {
  if (typeof value !== "boolean") {
    const prefix = title && `"${title}" `;
    throw new TypeError(prefix + "expected boolean, got type=" + typeof value);
  }
  return value;
}
function abignumber(n) {
  if (typeof n === "bigint") {
    if (!isPosBig(n))
      throw new RangeError("positive bigint expected, got " + n);
  } else
    anumber2(n);
  return n;
}
function asafenumber(value, title = "") {
  if (typeof value !== "number") {
    const prefix = title && `"${title}" `;
    throw new TypeError(prefix + "expected number, got type=" + typeof value);
  }
  if (!Number.isSafeInteger(value)) {
    const prefix = title && `"${title}" `;
    throw new RangeError(prefix + "expected safe integer, got " + value);
  }
}
function hexToNumber(hex) {
  if (typeof hex !== "string")
    throw new TypeError("hex string expected, got " + typeof hex);
  return hex === "" ? _0n : BigInt("0x" + hex);
}
function bytesToNumberBE(bytes) {
  return hexToNumber(bytesToHex(bytes));
}
function bytesToNumberLE(bytes) {
  return hexToNumber(bytesToHex(copyBytes(abytes(bytes)).reverse()));
}
function numberToBytesBE(n, len) {
  anumber(len);
  if (len === 0)
    throw new RangeError("zero length");
  n = abignumber(n);
  const hex = n.toString(16);
  if (hex.length > len * 2)
    throw new RangeError("number too large");
  return hexToBytes(hex.padStart(len * 2, "0"));
}
function numberToBytesLE(n, len) {
  return numberToBytesBE(n, len).reverse();
}
function equalBytes(a, b) {
  a = abytes2(a);
  b = abytes2(b);
  if (a.length !== b.length)
    return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++)
    diff |= a[i] ^ b[i];
  return diff === 0;
}
function copyBytes(bytes) {
  return Uint8Array.from(abytes2(bytes));
}
function asciiToBytes(ascii) {
  if (typeof ascii !== "string")
    throw new TypeError("ascii string expected, got " + typeof ascii);
  return Uint8Array.from(ascii, (c, i) => {
    const charCode = c.charCodeAt(0);
    if (c.length !== 1 || charCode > 127) {
      throw new RangeError(`string contains non-ASCII character "${ascii[i]}" with code ${charCode} at position ${i}`);
    }
    return charCode;
  });
}
var isPosBig = (n) => typeof n === "bigint" && _0n <= n;
function inRange(n, min, max) {
  return isPosBig(n) && isPosBig(min) && isPosBig(max) && min <= n && n < max;
}
function aInRange(title, n, min, max) {
  if (!inRange(n, min, max))
    throw new RangeError("expected valid " + title + ": " + min + " <= n < " + max + ", got " + n);
}
function bitLen(n) {
  if (n < _0n)
    throw new Error("expected non-negative bigint, got " + n);
  let len;
  for (len = 0; n > _0n; n >>= _1n, len += 1)
    ;
  return len;
}
var bitMask = (n) => (_1n << BigInt(n)) - _1n;
function validateObject(object3, fields = {}, optFields = {}) {
  if (Object.prototype.toString.call(object3) !== "[object Object]")
    throw new TypeError("expected valid options object");
  function checkField(fieldName, expectedType, isOpt) {
    if (!isOpt && expectedType !== "function" && !Object.hasOwn(object3, fieldName))
      throw new TypeError(`param "${fieldName}" is invalid: expected own property`);
    const val = object3[fieldName];
    if (isOpt && val === void 0)
      return;
    const current = typeof val;
    if (current !== expectedType || val === null)
      throw new TypeError(`param "${fieldName}" is invalid: expected ${expectedType}, got ${current}`);
  }
  const iter = (f, isOpt) => Object.entries(f).forEach(([k, v]) => checkField(k, v, isOpt));
  iter(fields, false);
  iter(optFields, true);
}
var notImplemented = () => {
  throw new Error("not implemented");
};

// source/directory/node_modules/@noble/curves/abstract/modular.js
var _0n2 = /* @__PURE__ */ BigInt(0);
var _1n2 = /* @__PURE__ */ BigInt(1);
var _2n = /* @__PURE__ */ BigInt(2);
var _3n = /* @__PURE__ */ BigInt(3);
var _4n = /* @__PURE__ */ BigInt(4);
var _5n = /* @__PURE__ */ BigInt(5);
var _7n = /* @__PURE__ */ BigInt(7);
var _8n = /* @__PURE__ */ BigInt(8);
var _9n = /* @__PURE__ */ BigInt(9);
var _16n = /* @__PURE__ */ BigInt(16);
function mod(a, b) {
  if (b <= _0n2)
    throw new Error("mod: expected positive modulus, got " + b);
  const result = a % b;
  return result >= _0n2 ? result : b + result;
}
function pow2(x, power, modulo) {
  if (power < _0n2)
    throw new Error("pow2: expected non-negative exponent, got " + power);
  let res = x;
  while (power-- > _0n2) {
    res *= res;
    res %= modulo;
  }
  return res;
}
function invert(number, modulo) {
  if (number === _0n2)
    throw new Error("invert: expected non-zero number");
  if (modulo <= _0n2)
    throw new Error("invert: expected positive modulus, got " + modulo);
  let a = mod(number, modulo);
  let b = modulo;
  let x = _0n2, y = _1n2, u = _1n2, v = _0n2;
  while (a !== _0n2) {
    const q = b / a;
    const r = b - a * q;
    const m = x - u * q;
    const n = y - v * q;
    b = a, a = r, x = u, y = v, u = m, v = n;
  }
  const gcd = b;
  if (gcd !== _1n2)
    throw new Error("invert: does not exist");
  return mod(x, modulo);
}
function assertIsSquare(Fp2, root, n) {
  const F = Fp2;
  if (!F.eql(F.sqr(root), n))
    throw new Error("Cannot find square root");
}
function sqrt3mod4(Fp2, n) {
  const F = Fp2;
  const p1div4 = (F.ORDER + _1n2) / _4n;
  const root = F.pow(n, p1div4);
  assertIsSquare(F, root, n);
  return root;
}
function sqrt5mod8(Fp2, n) {
  const F = Fp2;
  const p5div8 = (F.ORDER - _5n) / _8n;
  const n2 = F.mul(n, _2n);
  const v = F.pow(n2, p5div8);
  const nv = F.mul(n, v);
  const i = F.mul(F.mul(nv, _2n), v);
  const root = F.mul(nv, F.sub(i, F.ONE));
  assertIsSquare(F, root, n);
  return root;
}
function sqrt9mod16(P) {
  const Fp_ = Field(P);
  const tn = tonelliShanks(P);
  const c1 = tn(Fp_, Fp_.neg(Fp_.ONE));
  const c2 = tn(Fp_, c1);
  const c3 = tn(Fp_, Fp_.neg(c1));
  const c4 = (P + _7n) / _16n;
  return ((Fp2, n) => {
    const F = Fp2;
    let tv1 = F.pow(n, c4);
    let tv2 = F.mul(tv1, c1);
    const tv3 = F.mul(tv1, c2);
    const tv4 = F.mul(tv1, c3);
    const e1 = F.eql(F.sqr(tv2), n);
    const e2 = F.eql(F.sqr(tv3), n);
    tv1 = F.cmov(tv1, tv2, e1);
    tv2 = F.cmov(tv4, tv3, e2);
    const e3 = F.eql(F.sqr(tv2), n);
    const root = F.cmov(tv1, tv2, e3);
    assertIsSquare(F, root, n);
    return root;
  });
}
function tonelliShanks(P) {
  if (P < _3n)
    throw new Error("sqrt is not defined for small field");
  let Q = P - _1n2;
  let S = 0;
  while (Q % _2n === _0n2) {
    Q /= _2n;
    S++;
  }
  let Z = _2n;
  const _Fp = Field(P);
  while (FpLegendre(_Fp, Z) === 1) {
    if (Z++ > 1e3)
      throw new Error("Cannot find square root: probably non-prime P");
  }
  if (S === 1)
    return sqrt3mod4;
  let cc = _Fp.pow(Z, Q);
  const Q1div2 = (Q + _1n2) / _2n;
  return function tonelliSlow(Fp2, n) {
    const F = Fp2;
    if (F.is0(n))
      return n;
    if (FpLegendre(F, n) !== 1)
      throw new Error("Cannot find square root");
    let M = S;
    let c = F.mul(F.ONE, cc);
    let t = F.pow(n, Q);
    let R = F.pow(n, Q1div2);
    while (!F.eql(t, F.ONE)) {
      if (F.is0(t))
        return F.ZERO;
      let i = 1;
      let t_tmp = F.sqr(t);
      while (!F.eql(t_tmp, F.ONE)) {
        i++;
        t_tmp = F.sqr(t_tmp);
        if (i === M)
          throw new Error("Cannot find square root");
      }
      const exponent = _1n2 << BigInt(M - i - 1);
      const b = F.pow(c, exponent);
      M = i;
      c = F.sqr(b);
      t = F.mul(t, c);
      R = F.mul(R, b);
    }
    return R;
  };
}
function FpSqrt(P) {
  if (P % _4n === _3n)
    return sqrt3mod4;
  if (P % _8n === _5n)
    return sqrt5mod8;
  if (P % _16n === _9n)
    return sqrt9mod16(P);
  return tonelliShanks(P);
}
var isNegativeLE = (num, modulo) => (mod(num, modulo) & _1n2) === _1n2;
var FIELD_FIELDS = [
  "create",
  "isValid",
  "is0",
  "neg",
  "inv",
  "sqrt",
  "sqr",
  "eql",
  "add",
  "sub",
  "mul",
  "pow",
  "div",
  "addN",
  "subN",
  "mulN",
  "sqrN"
];
function validateField(field) {
  const initial = {
    ORDER: "bigint",
    BYTES: "number",
    BITS: "number"
  };
  const opts = FIELD_FIELDS.reduce((map, val) => {
    map[val] = "function";
    return map;
  }, initial);
  validateObject(field, opts);
  asafenumber(field.BYTES, "BYTES");
  asafenumber(field.BITS, "BITS");
  if (field.BYTES < 1 || field.BITS < 1)
    throw new Error("invalid field: expected BYTES/BITS > 0");
  if (field.ORDER <= _1n2)
    throw new Error("invalid field: expected ORDER > 1, got " + field.ORDER);
  return field;
}
function FpPow(Fp2, num, power) {
  const F = Fp2;
  if (power < _0n2)
    throw new Error("invalid exponent, negatives unsupported");
  if (power === _0n2)
    return F.ONE;
  if (power === _1n2)
    return num;
  let p = F.ONE;
  let d = num;
  while (power > _0n2) {
    if (power & _1n2)
      p = F.mul(p, d);
    d = F.sqr(d);
    power >>= _1n2;
  }
  return p;
}
function FpInvertBatch(Fp2, nums, passZero = false) {
  const F = Fp2;
  const inverted = new Array(nums.length).fill(passZero ? F.ZERO : void 0);
  const multipliedAcc = nums.reduce((acc, num, i) => {
    if (F.is0(num))
      return acc;
    inverted[i] = acc;
    return F.mul(acc, num);
  }, F.ONE);
  const invertedAcc = F.inv(multipliedAcc);
  nums.reduceRight((acc, num, i) => {
    if (F.is0(num))
      return acc;
    inverted[i] = F.mul(acc, inverted[i]);
    return F.mul(acc, num);
  }, invertedAcc);
  return inverted;
}
function FpLegendre(Fp2, n) {
  const F = Fp2;
  const p1mod2 = (F.ORDER - _1n2) / _2n;
  const powered = F.pow(n, p1mod2);
  const yes = F.eql(powered, F.ONE);
  const zero = F.eql(powered, F.ZERO);
  const no = F.eql(powered, F.neg(F.ONE));
  if (!yes && !zero && !no)
    throw new Error("invalid Legendre symbol result");
  return yes ? 1 : zero ? 0 : -1;
}
function nLength(n, nBitLength) {
  if (nBitLength !== void 0)
    anumber2(nBitLength);
  if (n <= _0n2)
    throw new Error("invalid n length: expected positive n, got " + n);
  if (nBitLength !== void 0 && nBitLength < 1)
    throw new Error("invalid n length: expected positive bit length, got " + nBitLength);
  const bits = bitLen(n);
  if (nBitLength !== void 0 && nBitLength < bits)
    throw new Error(`invalid n length: expected bit length (${bits}) >= n.length (${nBitLength})`);
  const _nBitLength = nBitLength !== void 0 ? nBitLength : bits;
  const nByteLength = Math.ceil(_nBitLength / 8);
  return { nBitLength: _nBitLength, nByteLength };
}
var FIELD_SQRT = /* @__PURE__ */ new WeakMap();
var _Field = class {
  ORDER;
  BITS;
  BYTES;
  isLE;
  ZERO = _0n2;
  ONE = _1n2;
  _lengths;
  _mod;
  constructor(ORDER, opts = {}) {
    if (ORDER <= _1n2)
      throw new Error("invalid field: expected ORDER > 1, got " + ORDER);
    let _nbitLength = void 0;
    this.isLE = false;
    if (opts != null && typeof opts === "object") {
      if (typeof opts.BITS === "number")
        _nbitLength = opts.BITS;
      if (typeof opts.sqrt === "function")
        Object.defineProperty(this, "sqrt", { value: opts.sqrt, enumerable: true });
      if (typeof opts.isLE === "boolean")
        this.isLE = opts.isLE;
      if (opts.allowedLengths)
        this._lengths = Object.freeze(opts.allowedLengths.slice());
      if (typeof opts.modFromBytes === "boolean")
        this._mod = opts.modFromBytes;
    }
    const { nBitLength, nByteLength } = nLength(ORDER, _nbitLength);
    if (nByteLength > 2048)
      throw new Error("invalid field: expected ORDER of <= 2048 bytes");
    this.ORDER = ORDER;
    this.BITS = nBitLength;
    this.BYTES = nByteLength;
    Object.freeze(this);
  }
  create(num) {
    return mod(num, this.ORDER);
  }
  isValid(num) {
    if (typeof num !== "bigint")
      throw new TypeError("invalid field element: expected bigint, got " + typeof num);
    return _0n2 <= num && num < this.ORDER;
  }
  is0(num) {
    return num === _0n2;
  }
  // is valid and invertible
  isValidNot0(num) {
    return !this.is0(num) && this.isValid(num);
  }
  isOdd(num) {
    return (num & _1n2) === _1n2;
  }
  neg(num) {
    return mod(-num, this.ORDER);
  }
  eql(lhs, rhs) {
    return lhs === rhs;
  }
  sqr(num) {
    return mod(num * num, this.ORDER);
  }
  add(lhs, rhs) {
    return mod(lhs + rhs, this.ORDER);
  }
  sub(lhs, rhs) {
    return mod(lhs - rhs, this.ORDER);
  }
  mul(lhs, rhs) {
    return mod(lhs * rhs, this.ORDER);
  }
  pow(num, power) {
    return FpPow(this, num, power);
  }
  div(lhs, rhs) {
    return mod(lhs * invert(rhs, this.ORDER), this.ORDER);
  }
  // Same as above, but doesn't normalize
  sqrN(num) {
    return num * num;
  }
  addN(lhs, rhs) {
    return lhs + rhs;
  }
  subN(lhs, rhs) {
    return lhs - rhs;
  }
  mulN(lhs, rhs) {
    return lhs * rhs;
  }
  inv(num) {
    return invert(num, this.ORDER);
  }
  sqrt(num) {
    let sqrt = FIELD_SQRT.get(this);
    if (!sqrt)
      FIELD_SQRT.set(this, sqrt = FpSqrt(this.ORDER));
    return sqrt(this, num);
  }
  toBytes(num) {
    return this.isLE ? numberToBytesLE(num, this.BYTES) : numberToBytesBE(num, this.BYTES);
  }
  fromBytes(bytes, skipValidation = false) {
    abytes2(bytes);
    const { _lengths: allowedLengths, BYTES, isLE, ORDER, _mod: modFromBytes } = this;
    if (allowedLengths) {
      if (bytes.length < 1 || !allowedLengths.includes(bytes.length) || bytes.length > BYTES) {
        throw new Error("Field.fromBytes: expected " + allowedLengths + " bytes, got " + bytes.length);
      }
      const padded = new Uint8Array(BYTES);
      padded.set(bytes, isLE ? 0 : padded.length - bytes.length);
      bytes = padded;
    }
    if (bytes.length !== BYTES)
      throw new Error("Field.fromBytes: expected " + BYTES + " bytes, got " + bytes.length);
    let scalar = isLE ? bytesToNumberLE(bytes) : bytesToNumberBE(bytes);
    if (modFromBytes)
      scalar = mod(scalar, ORDER);
    if (!skipValidation) {
      if (!this.isValid(scalar))
        throw new Error("invalid field element: outside of range 0..ORDER");
    }
    return scalar;
  }
  // TODO: we don't need it here, move out to separate fn
  invertBatch(lst) {
    return FpInvertBatch(this, lst);
  }
  // We can't move this out because Fp6, Fp12 implement it
  // and it's unclear what to return in there.
  cmov(a, b, condition) {
    abool(condition, "condition");
    return condition ? b : a;
  }
};
Object.freeze(_Field.prototype);
function Field(ORDER, opts = {}) {
  return new _Field(ORDER, opts);
}

// source/directory/node_modules/@noble/curves/abstract/curve.js
var _0n3 = /* @__PURE__ */ BigInt(0);
var _1n3 = /* @__PURE__ */ BigInt(1);
function negateCt(condition, item) {
  const neg = item.negate();
  return condition ? neg : item;
}
function normalizeZ(c, points) {
  const invertedZs = FpInvertBatch(c.Fp, points.map((p) => p.Z));
  return points.map((p, i) => c.fromAffine(p.toAffine(invertedZs[i])));
}
function validateW(W, bits) {
  if (!Number.isSafeInteger(W) || W <= 0 || W > bits)
    throw new Error("invalid window size, expected [1.." + bits + "], got W=" + W);
}
function calcWOpts(W, scalarBits) {
  validateW(W, scalarBits);
  const windows = Math.ceil(scalarBits / W) + 1;
  const windowSize = 2 ** (W - 1);
  const maxNumber = 2 ** W;
  const mask = bitMask(W);
  const shiftBy = BigInt(W);
  return { windows, windowSize, mask, maxNumber, shiftBy };
}
function calcOffsets(n, window, wOpts) {
  const { windowSize, mask, maxNumber, shiftBy } = wOpts;
  let wbits = Number(n & mask);
  let nextN = n >> shiftBy;
  if (wbits > windowSize) {
    wbits -= maxNumber;
    nextN += _1n3;
  }
  const offsetStart = window * windowSize;
  const offset = offsetStart + Math.abs(wbits) - 1;
  const isZero = wbits === 0;
  const isNeg = wbits < 0;
  const isNegF = window % 2 !== 0;
  const offsetF = offsetStart;
  return { nextN, offset, isZero, isNeg, isNegF, offsetF };
}
var pointPrecomputes = /* @__PURE__ */ new WeakMap();
var pointWindowSizes = /* @__PURE__ */ new WeakMap();
function getW(P) {
  return pointWindowSizes.get(P) || 1;
}
function assert0(n) {
  if (n !== _0n3)
    throw new Error("invalid wNAF");
}
var wNAF = class {
  BASE;
  ZERO;
  Fn;
  bits;
  // Parametrized with a given Point class (not individual point)
  constructor(Point, bits) {
    this.BASE = Point.BASE;
    this.ZERO = Point.ZERO;
    this.Fn = Point.Fn;
    this.bits = bits;
  }
  // non-const time multiplication ladder
  _unsafeLadder(elm, n, p = this.ZERO) {
    let d = elm;
    while (n > _0n3) {
      if (n & _1n3)
        p = p.add(d);
      d = d.double();
      n >>= _1n3;
    }
    return p;
  }
  /**
   * Creates a wNAF precomputation window. Used for caching.
   * Default window size is set by `utils.precompute()` and is equal to 8.
   * Number of precomputed points depends on the curve size:
   * 2^(𝑊−1) * (Math.ceil(𝑛 / 𝑊) + 1), where:
   * - 𝑊 is the window size
   * - 𝑛 is the bitlength of the curve order.
   * For a 256-bit curve and window size 8, the number of precomputed points is 128 * 33 = 4224.
   * @param point - Point instance
   * @param W - window size
   * @returns precomputed point tables flattened to a single array
   */
  precomputeWindow(point, W) {
    const { windows, windowSize } = calcWOpts(W, this.bits);
    const points = [];
    let p = point;
    let base = p;
    for (let window = 0; window < windows; window++) {
      base = p;
      points.push(base);
      for (let i = 1; i < windowSize; i++) {
        base = base.add(p);
        points.push(base);
      }
      p = base.double();
    }
    return points;
  }
  /**
   * Implements ec multiplication using precomputed tables and w-ary non-adjacent form.
   * More compact implementation:
   * https://github.com/paulmillr/noble-secp256k1/blob/47cb1669b6e506ad66b35fe7d76132ae97465da2/index.ts#L502-L541
   * @returns real and fake (for const-time) points
   */
  wNAF(W, precomputes, n) {
    if (!this.Fn.isValid(n))
      throw new Error("invalid scalar");
    let p = this.ZERO;
    let f = this.BASE;
    const wo = calcWOpts(W, this.bits);
    for (let window = 0; window < wo.windows; window++) {
      const { nextN, offset, isZero, isNeg, isNegF, offsetF } = calcOffsets(n, window, wo);
      n = nextN;
      if (isZero) {
        f = f.add(negateCt(isNegF, precomputes[offsetF]));
      } else {
        p = p.add(negateCt(isNeg, precomputes[offset]));
      }
    }
    assert0(n);
    return { p, f };
  }
  /**
   * Implements unsafe EC multiplication using precomputed tables
   * and w-ary non-adjacent form.
   * @param acc - accumulator point to add result of multiplication
   * @returns point
   */
  wNAFUnsafe(W, precomputes, n, acc = this.ZERO) {
    const wo = calcWOpts(W, this.bits);
    for (let window = 0; window < wo.windows; window++) {
      if (n === _0n3)
        break;
      const { nextN, offset, isZero, isNeg } = calcOffsets(n, window, wo);
      n = nextN;
      if (isZero) {
        continue;
      } else {
        const item = precomputes[offset];
        acc = acc.add(isNeg ? item.negate() : item);
      }
    }
    assert0(n);
    return acc;
  }
  getPrecomputes(W, point, transform) {
    let comp = pointPrecomputes.get(point);
    if (!comp) {
      comp = this.precomputeWindow(point, W);
      if (W !== 1) {
        if (typeof transform === "function")
          comp = transform(comp);
        pointPrecomputes.set(point, comp);
      }
    }
    return comp;
  }
  cached(point, scalar, transform) {
    const W = getW(point);
    return this.wNAF(W, this.getPrecomputes(W, point, transform), scalar);
  }
  unsafe(point, scalar, transform, prev) {
    const W = getW(point);
    if (W === 1)
      return this._unsafeLadder(point, scalar, prev);
    return this.wNAFUnsafe(W, this.getPrecomputes(W, point, transform), scalar, prev);
  }
  // We calculate precomputes for elliptic curve point multiplication
  // using windowed method. This specifies window size and
  // stores precomputed values. Usually only base point would be precomputed.
  createCache(P, W) {
    validateW(W, this.bits);
    pointWindowSizes.set(P, W);
    pointPrecomputes.delete(P);
  }
  hasCache(elm) {
    return getW(elm) !== 1;
  }
};
function createField(order, field, isLE) {
  if (field) {
    if (field.ORDER !== order)
      throw new Error("Field.ORDER must match order: Fp == p, Fn == n");
    validateField(field);
    return field;
  } else {
    return Field(order, { isLE });
  }
}
function createCurveFields(type, CURVE, curveOpts = {}, FpFnLE) {
  if (FpFnLE === void 0)
    FpFnLE = type === "edwards";
  if (!CURVE || typeof CURVE !== "object")
    throw new Error(`expected valid ${type} CURVE object`);
  for (const p of ["p", "n", "h"]) {
    const val = CURVE[p];
    if (!(typeof val === "bigint" && val > _0n3))
      throw new Error(`CURVE.${p} must be positive bigint`);
  }
  const Fp2 = createField(CURVE.p, curveOpts.Fp, FpFnLE);
  const Fn2 = createField(CURVE.n, curveOpts.Fn, FpFnLE);
  const _b = type === "weierstrass" ? "b" : "d";
  const params = ["Gx", "Gy", "a", _b];
  for (const p of params) {
    if (!Fp2.isValid(CURVE[p]))
      throw new Error(`CURVE.${p} must be valid field element of CURVE.Fp`);
  }
  CURVE = Object.freeze(Object.assign({}, CURVE));
  return { CURVE, Fp: Fp2, Fn: Fn2 };
}
function createKeygen(randomSecretKey, getPublicKey) {
  return function keygen(seed) {
    const secretKey = randomSecretKey(seed);
    return { secretKey, publicKey: getPublicKey(secretKey) };
  };
}

// source/directory/node_modules/@noble/curves/abstract/edwards.js
var _0n4 = /* @__PURE__ */ BigInt(0);
var _1n4 = /* @__PURE__ */ BigInt(1);
var _2n2 = /* @__PURE__ */ BigInt(2);
var _8n2 = /* @__PURE__ */ BigInt(8);
function isEdValidXY(Fp2, CURVE, x, y) {
  const x2 = Fp2.sqr(x);
  const y2 = Fp2.sqr(y);
  const left = Fp2.add(Fp2.mul(CURVE.a, x2), y2);
  const right = Fp2.add(Fp2.ONE, Fp2.mul(CURVE.d, Fp2.mul(x2, y2)));
  return Fp2.eql(left, right);
}
function edwards(params, extraOpts = {}) {
  const opts = extraOpts;
  const validated = createCurveFields("edwards", params, opts, opts.FpFnLE);
  const { Fp: Fp2, Fn: Fn2 } = validated;
  let CURVE = validated.CURVE;
  const { h: cofactor } = CURVE;
  validateObject(opts, {}, { uvRatio: "function" });
  const MASK = _2n2 << BigInt(Fn2.BYTES * 8) - _1n4;
  const modP = (n) => Fp2.create(n);
  const uvRatio2 = opts.uvRatio === void 0 ? (u, v) => {
    try {
      return { isValid: true, value: Fp2.sqrt(Fp2.div(u, v)) };
    } catch (e) {
      return { isValid: false, value: _0n4 };
    }
  } : opts.uvRatio;
  if (!isEdValidXY(Fp2, CURVE, CURVE.Gx, CURVE.Gy))
    throw new Error("bad curve params: generator point");
  function acoord(title, n, banZero = false) {
    const min = banZero ? _1n4 : _0n4;
    aInRange("coordinate " + title, n, min, MASK);
    return n;
  }
  function aedpoint(other) {
    if (!(other instanceof Point))
      throw new Error("EdwardsPoint expected");
  }
  class Point {
    // base / generator point
    static BASE = new Point(CURVE.Gx, CURVE.Gy, _1n4, modP(CURVE.Gx * CURVE.Gy));
    // zero / infinity / identity point
    static ZERO = new Point(_0n4, _1n4, _1n4, _0n4);
    // 0, 1, 1, 0
    // math field
    static Fp = Fp2;
    // scalar field
    static Fn = Fn2;
    X;
    Y;
    Z;
    T;
    constructor(X, Y, Z, T) {
      this.X = acoord("x", X);
      this.Y = acoord("y", Y);
      this.Z = acoord("z", Z, true);
      this.T = acoord("t", T);
      Object.freeze(this);
    }
    static CURVE() {
      return CURVE;
    }
    /**
     * Create one extended Edwards point from affine coordinates.
     * Does NOT validate that the point is on-curve or torsion-free.
     * Use `.assertValidity()` on adversarial inputs.
     */
    static fromAffine(p) {
      if (p instanceof Point)
        throw new Error("extended point not allowed");
      const { x, y } = p || {};
      acoord("x", x);
      acoord("y", y);
      return new Point(x, y, _1n4, modP(x * y));
    }
    // Uses algo from RFC8032 5.1.3.
    static fromBytes(bytes, zip215 = false) {
      const len = Fp2.BYTES;
      const { a, d } = CURVE;
      bytes = copyBytes(abytes2(bytes, len, "point"));
      abool(zip215, "zip215");
      const normed = copyBytes(bytes);
      const lastByte = bytes[len - 1];
      normed[len - 1] = lastByte & ~128;
      const y = bytesToNumberLE(normed);
      const max = zip215 ? MASK : Fp2.ORDER;
      aInRange("point.y", y, _0n4, max);
      const y2 = modP(y * y);
      const u = modP(y2 - _1n4);
      const v = modP(d * y2 - a);
      let { isValid, value: x } = uvRatio2(u, v);
      if (!isValid)
        throw new Error("bad point: invalid y coordinate");
      const isXOdd = (x & _1n4) === _1n4;
      const isLastByteOdd = (lastByte & 128) !== 0;
      if (!zip215 && x === _0n4 && isLastByteOdd)
        throw new Error("bad point: x=0 and x_0=1");
      if (isLastByteOdd !== isXOdd)
        x = modP(-x);
      return Point.fromAffine({ x, y });
    }
    static fromHex(hex, zip215 = false) {
      return Point.fromBytes(hexToBytes2(hex), zip215);
    }
    get x() {
      return this.toAffine().x;
    }
    get y() {
      return this.toAffine().y;
    }
    precompute(windowSize = 8, isLazy = true) {
      wnaf.createCache(this, windowSize);
      if (!isLazy)
        this.multiply(_2n2);
      return this;
    }
    // Useful in fromAffine() - not for fromBytes(), which always created valid points.
    assertValidity() {
      const p = this;
      const { a, d } = CURVE;
      if (p.is0())
        throw new Error("bad point: ZERO");
      const { X, Y, Z, T } = p;
      const X2 = modP(X * X);
      const Y2 = modP(Y * Y);
      const Z2 = modP(Z * Z);
      const Z4 = modP(Z2 * Z2);
      const aX2 = modP(X2 * a);
      const left = modP(Z2 * modP(aX2 + Y2));
      const right = modP(Z4 + modP(d * modP(X2 * Y2)));
      if (left !== right)
        throw new Error("bad point: equation left != right (1)");
      const XY = modP(X * Y);
      const ZT = modP(Z * T);
      if (XY !== ZT)
        throw new Error("bad point: equation left != right (2)");
    }
    // Compare one point to another.
    equals(other) {
      aedpoint(other);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const { X: X2, Y: Y2, Z: Z2 } = other;
      const X1Z2 = modP(X1 * Z2);
      const X2Z1 = modP(X2 * Z1);
      const Y1Z2 = modP(Y1 * Z2);
      const Y2Z1 = modP(Y2 * Z1);
      return X1Z2 === X2Z1 && Y1Z2 === Y2Z1;
    }
    is0() {
      return this.equals(Point.ZERO);
    }
    negate() {
      return new Point(modP(-this.X), this.Y, this.Z, modP(-this.T));
    }
    // Fast algo for doubling Extended Point.
    // https://hyperelliptic.org/EFD/g1p/auto-twisted-extended.html#doubling-dbl-2008-hwcd
    // Cost: 4M + 4S + 1*a + 6add + 1*2.
    double() {
      const { a } = CURVE;
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const A = modP(X1 * X1);
      const B = modP(Y1 * Y1);
      const C = modP(_2n2 * modP(Z1 * Z1));
      const D = modP(a * A);
      const x1y1 = X1 + Y1;
      const E = modP(modP(x1y1 * x1y1) - A - B);
      const G = D + B;
      const F = G - C;
      const H = D - B;
      const X3 = modP(E * F);
      const Y3 = modP(G * H);
      const T3 = modP(E * H);
      const Z3 = modP(F * G);
      return new Point(X3, Y3, Z3, T3);
    }
    // Fast algo for adding 2 Extended Points.
    // https://hyperelliptic.org/EFD/g1p/auto-twisted-extended.html#addition-add-2008-hwcd
    // Cost: 9M + 1*a + 1*d + 7add.
    add(other) {
      aedpoint(other);
      const { a, d } = CURVE;
      const { X: X1, Y: Y1, Z: Z1, T: T1 } = this;
      const { X: X2, Y: Y2, Z: Z2, T: T2 } = other;
      const A = modP(X1 * X2);
      const B = modP(Y1 * Y2);
      const C = modP(T1 * d * T2);
      const D = modP(Z1 * Z2);
      const E = modP((X1 + Y1) * (X2 + Y2) - A - B);
      const F = D - C;
      const G = D + C;
      const H = modP(B - a * A);
      const X3 = modP(E * F);
      const Y3 = modP(G * H);
      const T3 = modP(E * H);
      const Z3 = modP(F * G);
      return new Point(X3, Y3, Z3, T3);
    }
    subtract(other) {
      aedpoint(other);
      return this.add(other.negate());
    }
    // Constant-time multiplication.
    multiply(scalar) {
      if (!Fn2.isValidNot0(scalar))
        throw new RangeError("invalid scalar: expected 1 <= sc < curve.n");
      const { p, f } = wnaf.cached(this, scalar, (p2) => normalizeZ(Point, p2));
      return normalizeZ(Point, [p, f])[0];
    }
    // Non-constant-time multiplication. Uses double-and-add algorithm.
    // It's faster, but should only be used when you don't care about
    // an exposed private key e.g. sig verification.
    // Keeps the same subgroup-scalar contract: 0 is allowed for public-scalar callers, but
    // n and larger values are rejected instead of being reduced mod n to the identity point.
    multiplyUnsafe(scalar) {
      if (!Fn2.isValid(scalar))
        throw new RangeError("invalid scalar: expected 0 <= sc < curve.n");
      if (scalar === _0n4)
        return Point.ZERO;
      if (this.is0() || scalar === _1n4)
        return this;
      return wnaf.unsafe(this, scalar, (p) => normalizeZ(Point, p));
    }
    // Checks if point is of small order.
    // If you add something to small order point, you will have "dirty"
    // point with torsion component.
    // Clears cofactor and checks if the result is 0.
    isSmallOrder() {
      return this.clearCofactor().is0();
    }
    // Multiplies point by curve order and checks if the result is 0.
    // Returns `false` is the point is dirty.
    isTorsionFree() {
      return wnaf.unsafe(this, CURVE.n).is0();
    }
    // Converts Extended point to default (x, y) coordinates.
    // Can accept precomputed Z^-1 - for example, from invertBatch.
    toAffine(invertedZ) {
      const p = this;
      let iz = invertedZ;
      const { X, Y, Z } = p;
      const is0 = p.is0();
      if (iz == null)
        iz = is0 ? _8n2 : Fp2.inv(Z);
      const x = modP(X * iz);
      const y = modP(Y * iz);
      const zz = Fp2.mul(Z, iz);
      if (is0)
        return { x: _0n4, y: _1n4 };
      if (zz !== _1n4)
        throw new Error("invZ was invalid");
      return { x, y };
    }
    clearCofactor() {
      if (cofactor === _1n4)
        return this;
      return this.multiplyUnsafe(cofactor);
    }
    toBytes() {
      const { x, y } = this.toAffine();
      const bytes = Fp2.toBytes(y);
      bytes[bytes.length - 1] |= x & _1n4 ? 128 : 0;
      return bytes;
    }
    toHex() {
      return bytesToHex2(this.toBytes());
    }
    toString() {
      return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
    }
  }
  const wnaf = new wNAF(Point, Fn2.BITS);
  if (Fn2.BITS >= 8)
    Point.BASE.precompute(8);
  Object.freeze(Point.prototype);
  Object.freeze(Point);
  return Point;
}
var PrimeEdwardsPoint = class {
  static BASE;
  static ZERO;
  static Fp;
  static Fn;
  ep;
  /**
   * Wrap one internal Edwards representative directly.
   * This is not a canonical encoding boundary: alternate Edwards
   * representatives may still describe the same abstract wrapper element.
   */
  constructor(ep) {
    this.ep = ep;
  }
  // Static methods that must be implemented by subclasses
  static fromBytes(_bytes) {
    notImplemented();
  }
  static fromHex(_hex) {
    notImplemented();
  }
  get x() {
    return this.toAffine().x;
  }
  get y() {
    return this.toAffine().y;
  }
  // Common implementations
  clearCofactor() {
    return this;
  }
  assertValidity() {
    this.ep.assertValidity();
  }
  /**
   * Return affine coordinates of the current internal Edwards representative.
   * This is a convenience helper, not a canonical Ristretto/Decaf encoding.
   * Equal abstract elements may expose different `x` / `y`; use
   * `toBytes()` / `fromBytes()` for canonical roundtrips.
   */
  toAffine(invertedZ) {
    return this.ep.toAffine(invertedZ);
  }
  toHex() {
    return bytesToHex2(this.toBytes());
  }
  toString() {
    return this.toHex();
  }
  isTorsionFree() {
    return true;
  }
  isSmallOrder() {
    return false;
  }
  add(other) {
    this.assertSame(other);
    return this.init(this.ep.add(other.ep));
  }
  subtract(other) {
    this.assertSame(other);
    return this.init(this.ep.subtract(other.ep));
  }
  multiply(scalar) {
    return this.init(this.ep.multiply(scalar));
  }
  multiplyUnsafe(scalar) {
    return this.init(this.ep.multiplyUnsafe(scalar));
  }
  double() {
    return this.init(this.ep.double());
  }
  negate() {
    return this.init(this.ep.negate());
  }
  precompute(windowSize, isLazy) {
    this.ep.precompute(windowSize, isLazy);
    return this;
  }
};
function eddsa(Point, cHash, eddsaOpts = {}) {
  if (typeof cHash !== "function")
    throw new Error('"hash" function param is required');
  const hash = cHash;
  const opts = eddsaOpts;
  validateObject(opts, {}, {
    adjustScalarBytes: "function",
    randomBytes: "function",
    domain: "function",
    prehash: "function",
    zip215: "boolean",
    mapToCurve: "function"
  });
  const { prehash } = opts;
  const { BASE, Fp: Fp2, Fn: Fn2 } = Point;
  const outputLen = hash.outputLen;
  const expectedLen = 2 * Fp2.BYTES;
  if (outputLen !== void 0) {
    asafenumber(outputLen, "hash.outputLen");
    if (outputLen !== expectedLen)
      throw new Error(`hash.outputLen must be ${expectedLen}, got ${outputLen}`);
  }
  const randomBytes3 = opts.randomBytes === void 0 ? randomBytes2 : opts.randomBytes;
  const adjustScalarBytes2 = opts.adjustScalarBytes === void 0 ? (bytes) => bytes : opts.adjustScalarBytes;
  const domain = opts.domain === void 0 ? (data, ctx, phflag) => {
    abool(phflag, "phflag");
    if (ctx.length || phflag)
      throw new Error("Contexts/pre-hash are not supported");
    return data;
  } : opts.domain;
  function modN_LE(hash2) {
    return Fn2.create(bytesToNumberLE(hash2));
  }
  function getPrivateScalar(key) {
    const len = lengths.secretKey;
    abytes2(key, lengths.secretKey, "secretKey");
    const hashed = abytes2(hash(key), 2 * len, "hashedSecretKey");
    const head = adjustScalarBytes2(hashed.slice(0, len));
    const prefix = hashed.slice(len, 2 * len);
    const scalar = modN_LE(head);
    return { head, prefix, scalar };
  }
  function getExtendedPublicKey(secretKey) {
    const { head, prefix, scalar } = getPrivateScalar(secretKey);
    const point = BASE.multiply(scalar);
    const pointBytes = point.toBytes();
    return { head, prefix, scalar, point, pointBytes };
  }
  function getPublicKey(secretKey) {
    return getExtendedPublicKey(secretKey).pointBytes;
  }
  function hashDomainToScalar(context = Uint8Array.of(), ...msgs) {
    const msg = concatBytes2(...msgs);
    return modN_LE(hash(domain(msg, abytes2(context, void 0, "context"), !!prehash)));
  }
  function sign(msg, secretKey, options = {}) {
    msg = abytes2(msg, void 0, "message");
    if (prehash)
      msg = prehash(msg);
    const { prefix, scalar, pointBytes } = getExtendedPublicKey(secretKey);
    const r = hashDomainToScalar(options.context, prefix, msg);
    const R = BASE.multiply(r).toBytes();
    const k = hashDomainToScalar(options.context, R, pointBytes, msg);
    const s = Fn2.create(r + k * scalar);
    if (!Fn2.isValid(s))
      throw new Error("sign failed: invalid s");
    const rs = concatBytes2(R, Fn2.toBytes(s));
    return abytes2(rs, lengths.signature, "result");
  }
  const verifyOpts = {
    zip215: opts.zip215
  };
  function verify(sig, msg, publicKey, options = verifyOpts) {
    const { context } = options;
    const zip215 = options.zip215 === void 0 ? !!verifyOpts.zip215 : options.zip215;
    const len = lengths.signature;
    sig = abytes2(sig, len, "signature");
    msg = abytes2(msg, void 0, "message");
    publicKey = abytes2(publicKey, lengths.publicKey, "publicKey");
    if (zip215 !== void 0)
      abool(zip215, "zip215");
    if (prehash)
      msg = prehash(msg);
    const mid = len / 2;
    const r = sig.subarray(0, mid);
    const s = bytesToNumberLE(sig.subarray(mid, len));
    let A, R, SB;
    try {
      A = Point.fromBytes(publicKey, zip215);
      R = Point.fromBytes(r, zip215);
      SB = BASE.multiplyUnsafe(s);
    } catch (error) {
      return false;
    }
    if (!zip215 && A.isSmallOrder())
      return false;
    const k = hashDomainToScalar(context, r, publicKey, msg);
    const RkA = R.add(A.multiplyUnsafe(k));
    return RkA.subtract(SB).clearCofactor().is0();
  }
  const _size = Fp2.BYTES;
  const lengths = {
    secretKey: _size,
    publicKey: _size,
    signature: 2 * _size,
    seed: _size
  };
  function randomSecretKey(seed) {
    seed = seed === void 0 ? randomBytes3(lengths.seed) : seed;
    return abytes2(seed, lengths.seed, "seed");
  }
  function isValidSecretKey(key) {
    return isBytes2(key) && key.length === lengths.secretKey;
  }
  function isValidPublicKey(key, zip215) {
    try {
      return !!Point.fromBytes(key, zip215 === void 0 ? verifyOpts.zip215 : zip215);
    } catch (error) {
      return false;
    }
  }
  const utils = {
    getExtendedPublicKey,
    randomSecretKey,
    isValidSecretKey,
    isValidPublicKey,
    /**
     * Converts ed public key to x public key. Uses formula:
     * - ed25519:
     *   - `(u, v) = ((1+y)/(1-y), sqrt(-486664)*u/x)`
     *   - `(x, y) = (sqrt(-486664)*u/v, (u-1)/(u+1))`
     * - ed448:
     *   - `(u, v) = ((y-1)/(y+1), sqrt(156324)*u/x)`
     *   - `(x, y) = (sqrt(156324)*u/v, (1+u)/(1-u))`
     */
    toMontgomery(publicKey) {
      const { y } = Point.fromBytes(publicKey);
      const size = lengths.publicKey;
      const is25519 = size === 32;
      if (!is25519 && size !== 57)
        throw new Error("only defined for 25519 and 448");
      const u = is25519 ? Fp2.div(_1n4 + y, _1n4 - y) : Fp2.div(y - _1n4, y + _1n4);
      return Fp2.toBytes(u);
    },
    toMontgomerySecret(secretKey) {
      const size = lengths.secretKey;
      abytes2(secretKey, size);
      const hashed = hash(secretKey.subarray(0, size));
      return adjustScalarBytes2(hashed).subarray(0, size);
    }
  };
  Object.freeze(lengths);
  Object.freeze(utils);
  return Object.freeze({
    keygen: createKeygen(randomSecretKey, getPublicKey),
    getPublicKey,
    sign,
    verify,
    utils,
    Point,
    lengths
  });
}

// source/directory/node_modules/@noble/curves/abstract/hash-to-curve.js
function i2osp(value, length) {
  asafenumber(value);
  asafenumber(length);
  if (length < 0 || length > 4)
    throw new Error("invalid I2OSP length: " + length);
  if (value < 0 || value > 2 ** (8 * length) - 1)
    throw new Error("invalid I2OSP input: " + value);
  const res = Array.from({ length }).fill(0);
  for (let i = length - 1; i >= 0; i--) {
    res[i] = value & 255;
    value >>>= 8;
  }
  return new Uint8Array(res);
}
function strxor(a, b) {
  const arr = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) {
    arr[i] = a[i] ^ b[i];
  }
  return arr;
}
function normDST(DST) {
  if (!isBytes2(DST) && typeof DST !== "string")
    throw new Error("DST must be Uint8Array or ascii string");
  const dst = typeof DST === "string" ? asciiToBytes(DST) : DST;
  if (dst.length === 0)
    throw new Error("DST must be non-empty");
  return dst;
}
function expand_message_xmd(msg, DST, lenInBytes, H) {
  abytes2(msg);
  asafenumber(lenInBytes);
  DST = normDST(DST);
  if (DST.length > 255)
    DST = H(concatBytes2(asciiToBytes("H2C-OVERSIZE-DST-"), DST));
  const { outputLen: b_in_bytes, blockLen: r_in_bytes } = H;
  const ell = Math.ceil(lenInBytes / b_in_bytes);
  if (lenInBytes > 65535 || ell > 255)
    throw new Error("expand_message_xmd: invalid lenInBytes");
  const DST_prime = concatBytes2(DST, i2osp(DST.length, 1));
  const Z_pad = new Uint8Array(r_in_bytes);
  const l_i_b_str = i2osp(lenInBytes, 2);
  const b = new Array(ell);
  const b_0 = H(concatBytes2(Z_pad, msg, l_i_b_str, i2osp(0, 1), DST_prime));
  b[0] = H(concatBytes2(b_0, i2osp(1, 1), DST_prime));
  for (let i = 1; i < ell; i++) {
    const args = [strxor(b_0, b[i - 1]), i2osp(i + 1, 1), DST_prime];
    b[i] = H(concatBytes2(...args));
  }
  const pseudo_random_bytes = concatBytes2(...b);
  return pseudo_random_bytes.slice(0, lenInBytes);
}
var _DST_scalar = "HashToScalar-";

// source/directory/node_modules/@noble/curves/abstract/montgomery.js
var _0n5 = BigInt(0);
var _1n5 = BigInt(1);
var _2n3 = BigInt(2);
function validateOpts(curve) {
  validateObject(curve, {
    P: "bigint",
    type: "string",
    adjustScalarBytes: "function",
    powPminus2: "function"
  }, {
    randomBytes: "function"
  });
  return Object.freeze({ ...curve });
}
function montgomery(curveDef) {
  const CURVE = validateOpts(curveDef);
  const { P, type, adjustScalarBytes: adjustScalarBytes2, powPminus2, randomBytes: rand } = CURVE;
  const is25519 = type === "x25519";
  if (!is25519 && type !== "x448")
    throw new Error("invalid type");
  const randomBytes_ = rand === void 0 ? randomBytes2 : rand;
  const montgomeryBits = is25519 ? 255 : 448;
  const fieldLen = is25519 ? 32 : 56;
  const Gu = is25519 ? BigInt(9) : BigInt(5);
  const a24 = is25519 ? BigInt(121665) : BigInt(39081);
  const minScalar = is25519 ? _2n3 ** BigInt(254) : _2n3 ** BigInt(447);
  const maxAdded = is25519 ? BigInt(8) * _2n3 ** BigInt(251) - _1n5 : BigInt(4) * _2n3 ** BigInt(445) - _1n5;
  const maxScalar = minScalar + maxAdded + _1n5;
  const modP = (n) => mod(n, P);
  const GuBytes = encodeU(Gu);
  function encodeU(u) {
    return numberToBytesLE(modP(u), fieldLen);
  }
  function decodeU(u) {
    const _u = copyBytes(abytes2(u, fieldLen, "uCoordinate"));
    if (is25519)
      _u[31] &= 127;
    return modP(bytesToNumberLE(_u));
  }
  function decodeScalar(scalar) {
    return bytesToNumberLE(adjustScalarBytes2(copyBytes(abytes2(scalar, fieldLen, "scalar"))));
  }
  function scalarMult(scalar, u) {
    const pu = montgomeryLadder(decodeU(u), decodeScalar(scalar));
    if (pu === _0n5)
      throw new Error("invalid private or public key received");
    return encodeU(pu);
  }
  function scalarMultBase(scalar) {
    return scalarMult(scalar, GuBytes);
  }
  const getPublicKey = scalarMultBase;
  const getSharedSecret = scalarMult;
  function cswap(swap, x_2, x_3) {
    const dummy = modP(swap * (x_2 - x_3));
    x_2 = modP(x_2 - dummy);
    x_3 = modP(x_3 + dummy);
    return { x_2, x_3 };
  }
  function montgomeryLadder(u, scalar) {
    aInRange("u", u, _0n5, P);
    aInRange("scalar", scalar, minScalar, maxScalar);
    const k = scalar;
    const x_1 = u;
    let x_2 = _1n5;
    let z_2 = _0n5;
    let x_3 = u;
    let z_3 = _1n5;
    let swap = _0n5;
    for (let t = BigInt(montgomeryBits - 1); t >= _0n5; t--) {
      const k_t = k >> t & _1n5;
      swap ^= k_t;
      ({ x_2, x_3 } = cswap(swap, x_2, x_3));
      ({ x_2: z_2, x_3: z_3 } = cswap(swap, z_2, z_3));
      swap = k_t;
      const A = x_2 + z_2;
      const AA = modP(A * A);
      const B = x_2 - z_2;
      const BB = modP(B * B);
      const E = AA - BB;
      const C = x_3 + z_3;
      const D = x_3 - z_3;
      const DA = modP(D * A);
      const CB = modP(C * B);
      const dacb = DA + CB;
      const da_cb = DA - CB;
      x_3 = modP(dacb * dacb);
      z_3 = modP(x_1 * modP(da_cb * da_cb));
      x_2 = modP(AA * BB);
      z_2 = modP(E * (AA + modP(a24 * E)));
    }
    ({ x_2, x_3 } = cswap(swap, x_2, x_3));
    ({ x_2: z_2, x_3: z_3 } = cswap(swap, z_2, z_3));
    const z2 = powPminus2(z_2);
    return modP(x_2 * z2);
  }
  const lengths = {
    secretKey: fieldLen,
    publicKey: fieldLen,
    seed: fieldLen
  };
  const randomSecretKey = (seed) => {
    seed = seed === void 0 ? randomBytes_(fieldLen) : seed;
    abytes2(seed, lengths.seed, "seed");
    return seed;
  };
  const utils = { randomSecretKey };
  Object.freeze(lengths);
  Object.freeze(utils);
  return Object.freeze({
    keygen: createKeygen(randomSecretKey, getPublicKey),
    getSharedSecret,
    getPublicKey,
    scalarMult,
    scalarMultBase,
    utils,
    GuBytes: GuBytes.slice(),
    lengths
  });
}

// source/directory/node_modules/@noble/curves/ed25519.js
var _0n6 = /* @__PURE__ */ BigInt(0);
var _1n6 = /* @__PURE__ */ BigInt(1);
var _2n4 = /* @__PURE__ */ BigInt(2);
var _3n2 = /* @__PURE__ */ BigInt(3);
var _5n2 = /* @__PURE__ */ BigInt(5);
var _8n3 = /* @__PURE__ */ BigInt(8);
var ed25519_CURVE_p = /* @__PURE__ */ BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffed");
var ed25519_CURVE = /* @__PURE__ */ (() => ({
  p: ed25519_CURVE_p,
  n: BigInt("0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed"),
  h: _8n3,
  a: BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffec"),
  d: BigInt("0x52036cee2b6ffe738cc740797779e89800700a4d4141d8ab75eb4dca135978a3"),
  Gx: BigInt("0x216936d3cd6e53fec0a4e231fdd6dc5c692cc7609525a7b2c9562d608f25d51a"),
  Gy: BigInt("0x6666666666666666666666666666666666666666666666666666666666666658")
}))();
function ed25519_pow_2_252_3(x) {
  const _10n = BigInt(10), _20n = BigInt(20), _40n = BigInt(40), _80n = BigInt(80);
  const P = ed25519_CURVE_p;
  const x2 = x * x % P;
  const b2 = x2 * x % P;
  const b4 = pow2(b2, _2n4, P) * b2 % P;
  const b5 = pow2(b4, _1n6, P) * x % P;
  const b10 = pow2(b5, _5n2, P) * b5 % P;
  const b20 = pow2(b10, _10n, P) * b10 % P;
  const b40 = pow2(b20, _20n, P) * b20 % P;
  const b80 = pow2(b40, _40n, P) * b40 % P;
  const b160 = pow2(b80, _80n, P) * b80 % P;
  const b240 = pow2(b160, _80n, P) * b80 % P;
  const b250 = pow2(b240, _10n, P) * b10 % P;
  const pow_p_5_8 = pow2(b250, _2n4, P) * x % P;
  return { pow_p_5_8, b2 };
}
function adjustScalarBytes(bytes) {
  bytes[0] &= 248;
  bytes[31] &= 127;
  bytes[31] |= 64;
  return bytes;
}
var ED25519_SQRT_M1 = /* @__PURE__ */ BigInt("19681161376707505956807079304988542015446066515923890162744021073123829784752");
function uvRatio(u, v) {
  const P = ed25519_CURVE_p;
  const v3 = mod(v * v * v, P);
  const v7 = mod(v3 * v3 * v, P);
  const pow = ed25519_pow_2_252_3(u * v7).pow_p_5_8;
  let x = mod(u * v3 * pow, P);
  const vx2 = mod(v * x * x, P);
  const root1 = x;
  const root2 = mod(x * ED25519_SQRT_M1, P);
  const useRoot1 = vx2 === u;
  const useRoot2 = vx2 === mod(-u, P);
  const noRoot = vx2 === mod(-u * ED25519_SQRT_M1, P);
  if (useRoot1)
    x = root1;
  if (useRoot2 || noRoot)
    x = root2;
  if (isNegativeLE(x, P))
    x = mod(-x, P);
  return { isValid: useRoot1 || useRoot2, value: x };
}
var ed25519_Point = /* @__PURE__ */ edwards(ed25519_CURVE, { uvRatio });
var Fp = /* @__PURE__ */ (() => ed25519_Point.Fp)();
var Fn = /* @__PURE__ */ (() => ed25519_Point.Fn)();
function ed(opts) {
  return eddsa(ed25519_Point, sha512, Object.assign({ adjustScalarBytes, zip215: true }, opts));
}
var ed25519 = /* @__PURE__ */ ed({});
var x25519 = /* @__PURE__ */ (() => {
  const P = ed25519_CURVE_p;
  return montgomery({
    P,
    type: "x25519",
    powPminus2: (x) => {
      const { pow_p_5_8, b2 } = ed25519_pow_2_252_3(x);
      return mod(pow2(pow_p_5_8, _3n2, P) * b2, P);
    },
    adjustScalarBytes
  });
})();
var SQRT_M1 = ED25519_SQRT_M1;
var SQRT_AD_MINUS_ONE = /* @__PURE__ */ BigInt("25063068953384623474111414158702152701244531502492656460079210482610430750235");
var INVSQRT_A_MINUS_D = /* @__PURE__ */ BigInt("54469307008909316920995813868745141605393597292927456921205312896311721017578");
var ONE_MINUS_D_SQ = /* @__PURE__ */ BigInt("1159843021668779879193775521855586647937357759715417654439879720876111806838");
var D_MINUS_ONE_SQ = /* @__PURE__ */ BigInt("40440834346308536858101042469323190826248399146238708352240133220865137265952");
var invertSqrt = (number) => uvRatio(_1n6, number);
var MAX_255B = /* @__PURE__ */ BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
var bytes255ToNumberLE = (bytes) => Fp.create(bytesToNumberLE(bytes) & MAX_255B);
function calcElligatorRistrettoMap(r0) {
  const { d } = ed25519_CURVE;
  const P = ed25519_CURVE_p;
  const mod2 = (n) => Fp.create(n);
  const r = mod2(SQRT_M1 * r0 * r0);
  const Ns = mod2((r + _1n6) * ONE_MINUS_D_SQ);
  let c = BigInt(-1);
  const D = mod2((c - d * r) * mod2(r + d));
  let { isValid: Ns_D_is_sq, value: s } = uvRatio(Ns, D);
  let s_ = mod2(s * r0);
  if (!isNegativeLE(s_, P))
    s_ = mod2(-s_);
  if (!Ns_D_is_sq)
    s = s_;
  if (!Ns_D_is_sq)
    c = r;
  const Nt = mod2(c * (r - _1n6) * D_MINUS_ONE_SQ - D);
  const s2 = s * s;
  const W0 = mod2((s + s) * D);
  const W1 = mod2(Nt * SQRT_AD_MINUS_ONE);
  const W2 = mod2(_1n6 - s2);
  const W3 = mod2(_1n6 + s2);
  return new ed25519_Point(mod2(W0 * W3), mod2(W2 * W1), mod2(W1 * W3), mod2(W0 * W2));
}
var _RistrettoPoint = class __RistrettoPoint extends PrimeEdwardsPoint {
  // Do NOT change syntax: the following gymnastics is done,
  // because typescript strips comments, which makes bundlers disable tree-shaking.
  // prettier-ignore
  static BASE = /* @__PURE__ */ (() => new __RistrettoPoint(ed25519_Point.BASE))();
  // prettier-ignore
  static ZERO = /* @__PURE__ */ (() => new __RistrettoPoint(ed25519_Point.ZERO))();
  // prettier-ignore
  static Fp = /* @__PURE__ */ (() => Fp)();
  // prettier-ignore
  static Fn = /* @__PURE__ */ (() => Fn)();
  constructor(ep) {
    super(ep);
  }
  /**
   * Create one Ristretto255 point from affine Edwards coordinates.
   * This wraps the internal Edwards representative directly and is not a
   * canonical ristretto255 decoding path.
   * Use `toBytes()` / `fromBytes()` if canonical ristretto255 bytes matter.
   */
  static fromAffine(ap) {
    return new __RistrettoPoint(ed25519_Point.fromAffine(ap));
  }
  assertSame(other) {
    if (!(other instanceof __RistrettoPoint))
      throw new Error("RistrettoPoint expected");
  }
  init(ep) {
    return new __RistrettoPoint(ep);
  }
  static fromBytes(bytes) {
    abytes(bytes, 32);
    const { a, d } = ed25519_CURVE;
    const P = ed25519_CURVE_p;
    const mod2 = (n) => Fp.create(n);
    const s = bytes255ToNumberLE(bytes);
    if (!equalBytes(Fp.toBytes(s), bytes) || isNegativeLE(s, P))
      throw new Error("invalid ristretto255 encoding 1");
    const s2 = mod2(s * s);
    const u1 = mod2(_1n6 + a * s2);
    const u2 = mod2(_1n6 - a * s2);
    const u1_2 = mod2(u1 * u1);
    const u2_2 = mod2(u2 * u2);
    const v = mod2(a * d * u1_2 - u2_2);
    const { isValid, value: I } = invertSqrt(mod2(v * u2_2));
    const Dx = mod2(I * u2);
    const Dy = mod2(I * Dx * v);
    let x = mod2((s + s) * Dx);
    if (isNegativeLE(x, P))
      x = mod2(-x);
    const y = mod2(u1 * Dy);
    const t = mod2(x * y);
    if (!isValid || isNegativeLE(t, P) || y === _0n6)
      throw new Error("invalid ristretto255 encoding 2");
    return new __RistrettoPoint(new ed25519_Point(x, y, _1n6, t));
  }
  /**
   * Converts ristretto-encoded string to ristretto point.
   * Described in [RFC9496](https://www.rfc-editor.org/rfc/rfc9496#name-decode).
   * @param hex - Ristretto-encoded 32 bytes. Not every 32-byte string is valid ristretto encoding
   */
  static fromHex(hex) {
    return __RistrettoPoint.fromBytes(hexToBytes(hex));
  }
  /**
   * Encodes ristretto point to Uint8Array.
   * Described in [RFC9496](https://www.rfc-editor.org/rfc/rfc9496#name-encode).
   */
  toBytes() {
    let { X, Y, Z, T } = this.ep;
    const P = ed25519_CURVE_p;
    const mod2 = (n) => Fp.create(n);
    const u1 = mod2(mod2(Z + Y) * mod2(Z - Y));
    const u2 = mod2(X * Y);
    const u2sq = mod2(u2 * u2);
    const { value: invsqrt } = invertSqrt(mod2(u1 * u2sq));
    const D1 = mod2(invsqrt * u1);
    const D2 = mod2(invsqrt * u2);
    const zInv = mod2(D1 * D2 * T);
    let D;
    if (isNegativeLE(T * zInv, P)) {
      let _x = mod2(Y * SQRT_M1);
      let _y = mod2(X * SQRT_M1);
      X = _x;
      Y = _y;
      D = mod2(D1 * INVSQRT_A_MINUS_D);
    } else {
      D = D2;
    }
    if (isNegativeLE(X * zInv, P))
      Y = mod2(-Y);
    let s = mod2((Z - Y) * D);
    if (isNegativeLE(s, P))
      s = mod2(-s);
    return Fp.toBytes(s);
  }
  /**
   * Compares two Ristretto points.
   * Described in [RFC9496](https://www.rfc-editor.org/rfc/rfc9496#name-equals).
   */
  equals(other) {
    this.assertSame(other);
    const { X: X1, Y: Y1 } = this.ep;
    const { X: X2, Y: Y2 } = other.ep;
    const mod2 = (n) => Fp.create(n);
    const one = mod2(X1 * Y2) === mod2(Y1 * X2);
    const two = mod2(Y1 * Y2) === mod2(X1 * X2);
    return one || two;
  }
  is0() {
    return this.equals(__RistrettoPoint.ZERO);
  }
};
Object.freeze(_RistrettoPoint.BASE);
Object.freeze(_RistrettoPoint.ZERO);
Object.freeze(_RistrettoPoint.prototype);
Object.freeze(_RistrettoPoint);
var ristretto255_hasher = Object.freeze({
  Point: _RistrettoPoint,
  /**
  * Spec: https://www.rfc-editor.org/rfc/rfc9380.html#name-hashing-to-ristretto255. Caveats:
  * * There are no test vectors
  * * encodeToCurve / mapToCurve is undefined
  * * mapToCurve would be `calcElligatorRistrettoMap(scalars[0])`, not ristretto255_map!
  * * hashToScalar is undefined too, so we just use OPRF implementation
  * * We cannot re-use 'createHasher', because ristretto255_map is different algorithm/RFC
    (os2ip -> bytes255ToNumberLE)
  * * mapToCurve == calcElligatorRistrettoMap, hashToCurve == ristretto255_map
  * * hashToScalar is undefined in RFC9380 for ristretto, so we use the OPRF
    version here. Using `bytes255ToNumblerLE` will create a different result
    if we use `bytes255ToNumberLE` as os2ip
  * * current version is closest to spec.
  */
  hashToCurve(msg, options) {
    const DST = options?.DST === void 0 ? "ristretto255_XMD:SHA-512_R255MAP_RO_" : options.DST;
    const xmd = expand_message_xmd(msg, DST, 64, sha512);
    return ristretto255_hasher.deriveToCurve(xmd);
  },
  hashToScalar(msg, options = { DST: _DST_scalar }) {
    const xmd = expand_message_xmd(msg, options.DST, 64, sha512);
    return Fn.create(bytesToNumberLE(xmd));
  },
  /**
   * HashToCurve-like construction based on RFC 9496 (Element Derivation).
   * Converts 64 uniform random bytes into a curve point.
   *
   * WARNING: This represents an older hash-to-curve construction from before
   * RFC 9380 was finalized.
   * It was later reused as a component in the newer
   * `hash_to_ristretto255` function defined in RFC 9380.
   */
  deriveToCurve(bytes) {
    abytes(bytes, 64);
    const r1 = bytes255ToNumberLE(bytes.subarray(0, 32));
    const R1 = calcElligatorRistrettoMap(r1);
    const r2 = bytes255ToNumberLE(bytes.subarray(32, 64));
    const R2 = calcElligatorRistrettoMap(r2);
    return new _RistrettoPoint(R1.add(R2));
  }
});

// source/directory/src/e2ee/directoryCertificates.ts
var DIRECTORY_CERTIFICATE_PREFIX = "orizo-message-directory-certificate-v1\n";
var DIRECTORY_POSSESSION_PREFIX = "orizo-message-directory-possession-v1\n";
var MAX_DIRECTORY_CHAIN_DEPTH = 16;
var MAX_DIRECTORY_CERTIFICATES = 1536;
var DIGEST = /^[0-9a-f]{64}$/;
var COMMON = ["version", "purpose", "userId", "accountSigningKey", "issuerCertificateId", "canApprove"];
var DEVICE = ["deviceId", "identityKey", "signingKey", "notificationKeyHash"];
var RECOVERY = ["vaultId", "epoch", "recoveryPublicKey", "approvalSigningKey"];
var validSigningPoints = /* @__PURE__ */ new Set();
var DirectoryCertificateError = class extends Error {
  constructor() {
    super("Invalid public directory certificate.");
  }
};
var invalid = () => {
  throw new DirectoryCertificateError();
};
function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value;
}
function positiveInteger(value) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return invalid();
  return value;
}
function encoded(value, length, empty = false) {
  if (empty && value === "") return "";
  if (typeof value !== "string" || value.length > 256 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return invalid();
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
    if (normalized.length % 4 === 1) return invalid();
    const bytes = (0, import_base64_js.toByteArray)(normalized + "=".repeat((4 - normalized.length % 4) % 4));
    if (bytes.length !== length) return invalid();
    return (0, import_base64_js.fromByteArray)(bytes);
  } catch {
    return invalid();
  }
}
function signingKey(value) {
  const key = encoded(value, 32);
  if (validSigningPoints.has(key)) return key;
  try {
    const point = ed25519.Point.fromBytes((0, import_base64_js.toByteArray)(key), false);
    if (point.isSmallOrder() || !point.isTorsionFree()) return invalid();
    if (validSigningPoints.size >= 512) validSigningPoints.delete(validSigningPoints.values().next().value);
    validSigningPoints.add(key);
    return key;
  } catch {
    return invalid();
  }
}
function canonicalDirectorySigningKey(value) {
  return signingKey(value);
}
function canonicalDirectoryCertificateBody(value) {
  const body = object(value);
  const extras = body.purpose === "device" ? DEVICE : body.purpose === "recovery" ? RECOVERY : invalid();
  const fields = [...COMMON, ...extras].sort();
  if (Object.keys(body).sort().join(",") !== fields.join(",") || body.version !== 1 || typeof body.canApprove !== "boolean" || body.issuerCertificateId !== null && (typeof body.issuerCertificateId !== "string" || !DIGEST.test(body.issuerCertificateId))) return invalid();
  const common = {
    version: 1,
    userId: positiveInteger(body.userId),
    accountSigningKey: signingKey(body.accountSigningKey),
    issuerCertificateId: body.issuerCertificateId,
    canApprove: body.canApprove
  };
  if (body.purpose === "device") {
    const id = body.deviceId;
    if (typeof id !== "string" || Array.from(id).length < 1 || Array.from(id).length > 128 || id !== id.trim() || !/^[\p{L}\p{M}\p{N}\p{P}\p{S} ]+$/u.test(id)) return invalid();
    return {
      ...common,
      purpose: "device",
      deviceId: id,
      identityKey: encoded(body.identityKey, 32),
      signingKey: signingKey(body.signingKey),
      notificationKeyHash: encoded(body.notificationKeyHash, 32)
    };
  }
  if (typeof body.vaultId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(body.vaultId)) return invalid();
  return {
    ...common,
    purpose: "recovery",
    vaultId: body.vaultId,
    epoch: positiveInteger(body.epoch),
    recoveryPublicKey: encoded(body.recoveryPublicKey, 32),
    approvalSigningKey: signingKey(body.approvalSigningKey)
  };
}
function directoryCertificateAuthorization(value) {
  const body = canonicalDirectoryCertificateBody(value);
  const sorted2 = Object.fromEntries(Object.entries(body).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  return DIRECTORY_CERTIFICATE_PREFIX + JSON.stringify(sorted2);
}
function directoryCertificateId(body) {
  return bytesToHex(sha256(utf8ToBytes(directoryCertificateAuthorization(body))));
}
function canonicalDirectoryCertificatePacket(value) {
  const packet = object(value);
  if (Object.keys(packet).sort().join(",") !== "body,id,signature") return invalid();
  const body = canonicalDirectoryCertificateBody(packet.body);
  if (packet.id !== directoryCertificateId(body)) return invalid();
  return { id: packet.id, body, signature: encoded(packet.signature, 64) };
}
function directoryCertificateSigningKey(body) {
  return body.purpose === "device" ? body.signingKey : body.approvalSigningKey;
}
function directoryCertificatePossessionAuthorization(identifier) {
  if (typeof identifier !== "string" || !DIGEST.test(identifier)) return invalid();
  return DIRECTORY_POSSESSION_PREFIX + identifier;
}
function verifyDirectoryCertificatePossession(certificate, signature) {
  const packet = canonicalDirectoryCertificatePacket(certificate), normalized = encoded(signature, 64);
  try {
    if (!ed25519.verify(
      (0, import_base64_js.toByteArray)(normalized),
      utf8ToBytes(directoryCertificatePossessionAuthorization(packet.id)),
      (0, import_base64_js.toByteArray)(directoryCertificateSigningKey(packet.body)),
      { zip215: false }
    )) return invalid();
  } catch {
    return invalid();
  }
  return normalized;
}
function verifyDirectoryCertificateChain(identifier, certificates, input) {
  positiveInteger(input.userId);
  const pool = object(certificates);
  if (Object.keys(pool).length > MAX_DIRECTORY_CERTIFICATES) return invalid();
  const pin = input.pinnedAccountKey == null ? null : signingKey(input.pinnedAccountKey);
  const visiting = /* @__PURE__ */ new Set(), verified = /* @__PURE__ */ new Map();
  function verify(id, depth) {
    if (depth > MAX_DIRECTORY_CHAIN_DEPTH || typeof id !== "string" || !DIGEST.test(id) || visiting.has(id)) return invalid();
    const cached = verified.get(id);
    if (cached) return cached;
    if (!Object.hasOwn(pool, id)) return invalid();
    const packet = object(pool[id]);
    if (Object.keys(packet).sort().join(",") !== "body,id,signature" || packet.id !== id) return invalid();
    const body = canonicalDirectoryCertificateBody(packet.body);
    if (body.userId !== input.userId || directoryCertificateId(body) !== id || pin && body.accountSigningKey !== pin) return invalid();
    visiting.add(id);
    let key;
    if (body.issuerCertificateId === null) {
      if (body.purpose !== "device" || !body.canApprove || body.signingKey !== body.accountSigningKey) return invalid();
      key = body.accountSigningKey;
    } else {
      const parent = verify(body.issuerCertificateId, depth + 1);
      if (!parent.canApprove || parent.accountSigningKey !== body.accountSigningKey) return invalid();
      key = directoryCertificateSigningKey(parent);
    }
    try {
      if (!ed25519.verify((0, import_base64_js.toByteArray)(encoded(packet.signature, 64)), utf8ToBytes(directoryCertificateAuthorization(body)), (0, import_base64_js.toByteArray)(key), { zip215: false })) return invalid();
    } catch {
      return invalid();
    }
    visiting.delete(id);
    verified.set(id, body);
    return body;
  }
  return verify(identifier, 1);
}

// source/directory/src/e2ee/directoryIdentity.ts
var DirectoryIdentityApprovalRequired = class extends Error {
  code = "message_directory_approval_required";
  constructor() {
    super("Approve this messaging identity on an already trusted device.");
  }
};
function directoryNotificationKeyHash(key) {
  const normalized = key.replace(/-/g, "+").replace(/_/g, "/");
  return (0, import_base64_js2.fromByteArray)(sha256(key ? (0, import_base64_js2.toByteArray)(normalized + "=".repeat((4 - normalized.length % 4) % 4)) : new Uint8Array()));
}
function directoryDeviceMatches(body, state, includeNotification = true) {
  if (body.purpose !== "device") return false;
  const expected = canonicalDirectoryCertificateBody({
    ...body,
    userId: state.userId,
    deviceId: state.deviceId,
    identityKey: state.identityKey,
    signingKey: state.signingKey,
    notificationKeyHash: directoryNotificationKeyHash(state.notificationPublicKey)
  });
  return expected.purpose === "device" && body.userId === expected.userId && body.deviceId === expected.deviceId && body.identityKey === expected.identityKey && body.signingKey === expected.signingKey && (!includeNotification || body.notificationKeyHash === expected.notificationKeyHash);
}
async function signDirectoryDevice(input) {
  const body = canonicalDirectoryCertificateBody({
    version: 1,
    purpose: "device",
    userId: input.state.userId,
    accountSigningKey: input.accountSigningKey,
    issuerCertificateId: input.issuerCertificateId,
    canApprove: true,
    deviceId: input.state.deviceId,
    identityKey: input.state.identityKey,
    signingKey: input.state.signingKey,
    notificationKeyHash: directoryNotificationKeyHash(input.state.notificationPublicKey)
  });
  return canonicalDirectoryCertificatePacket({ id: directoryCertificateId(body), body, signature: await input.sign(directoryCertificateAuthorization(body)) });
}
function publicDirectoryCertificatePool(value) {
  if (!Array.isArray(value) || value.length > MAX_DIRECTORY_CERTIFICATES) throw new DirectoryCertificateError();
  const result = /* @__PURE__ */ Object.create(null);
  for (const packet of value) {
    if (!packet || typeof packet !== "object" || typeof packet.id !== "string" || !/^[a-f0-9]{64}$/.test(packet.id) || Object.hasOwn(result, packet.id)) throw new DirectoryCertificateError();
    result[packet.id] = packet;
  }
  return result;
}
function publicDirectoryPossessionProofs(value, certificates) {
  if (!Array.isArray(value) || value.length > MAX_DIRECTORY_CERTIFICATES) throw new DirectoryCertificateError();
  const result = /* @__PURE__ */ Object.create(null);
  for (const proof of value) {
    if (!proof || typeof proof !== "object" || Object.keys(proof).sort().join(",") !== "certificateId,signature" || typeof proof.certificateId !== "string" || !Object.hasOwn(certificates, proof.certificateId) || Object.hasOwn(result, proof.certificateId) || typeof proof.signature !== "string" || proof.signature.length > 256) throw new DirectoryCertificateError();
    result[proof.certificateId] = proof.signature;
  }
  return result;
}
function snapshot(value) {
  if (!value || typeof value !== "object") throw new DirectoryCertificateError();
  const data = value;
  if (data.version !== 1 || data.accountSigningKey !== null && typeof data.accountSigningKey !== "string" || data.rootCertificateId !== null && typeof data.rootCertificateId !== "string") throw new DirectoryCertificateError();
  publicDirectoryPossessionProofs(data.possessionProofs, publicDirectoryCertificatePool(data.certificates));
  return data;
}
function createDirectoryIdentityEnrollment(input) {
  let inFlight = null;
  const current = () => input.assertCurrent();
  async function publishOwn(certificate) {
    current();
    const raw = await input.sign(directoryCertificatePossessionAuthorization(certificate.id));
    current();
    const proof = verifyDirectoryCertificatePossession(certificate, raw);
    await input.publish(certificate, proof);
    current();
    return proof;
  }
  async function ensure() {
    current();
    const pin = await input.readPin();
    current();
    if (pin !== null && (typeof pin !== "string" || !pin)) throw new DirectoryCertificateError();
    let anchor = pin, bootstrapRootId = null;
    let data = snapshot(await input.fetch());
    current();
    let pool = publicDirectoryCertificatePool(data.certificates);
    if (data.accountSigningKey === null || data.rootCertificateId === null) {
      if (pin || data.accountSigningKey !== null || data.rootCertificateId !== null || data.certificates.length) throw new DirectoryCertificateError();
      const root2 = await signDirectoryDevice({ state: input.state, accountSigningKey: input.state.signingKey, issuerCertificateId: null, sign: input.sign });
      current();
      verifyDirectoryCertificateChain(root2.id, { [root2.id]: root2 }, { userId: input.state.userId, pinnedAccountKey: input.state.signingKey });
      anchor = root2.body.accountSigningKey;
      bootstrapRootId = root2.id;
      await publishOwn(root2);
      current();
      data = snapshot(await input.fetch());
      current();
      pool = publicDirectoryCertificatePool(data.certificates);
    }
    if (!data.rootCertificateId || !data.accountSigningKey) throw new DirectoryCertificateError();
    if (bootstrapRootId && data.rootCertificateId !== bootstrapRootId) throw new DirectoryCertificateError();
    const root = verifyDirectoryCertificateChain(data.rootCertificateId, pool, { userId: input.state.userId, pinnedAccountKey: anchor });
    if (root.issuerCertificateId !== null || root.accountSigningKey !== data.accountSigningKey) throw new DirectoryCertificateError();
    const localRoot = canonicalDirectoryCertificateBody({ ...root, signingKey: input.state.signingKey });
    let trustedRoot = Boolean(anchor) || localRoot.purpose === "device" && localRoot.signingKey === root.accountSigningKey;
    const proofs = publicDirectoryPossessionProofs(data.possessionProofs, publicDirectoryCertificatePool(data.certificates));
    let certificate;
    let renewal;
    let possessionSignature;
    for (const packet of [...data.certificates].reverse()) {
      if (packet.body?.purpose !== "device" || packet.body.deviceId !== input.state.deviceId) continue;
      const body = verifyDirectoryCertificateChain(packet.id, pool, { userId: input.state.userId, pinnedAccountKey: root.accountSigningKey });
      const matchesOwner = directoryDeviceMatches(body, input.state, false);
      if (matchesOwner && proofs[packet.id] !== void 0) {
        verifyDirectoryCertificatePossession(packet, proofs[packet.id]);
        trustedRoot = true;
      }
      if (!certificate && directoryDeviceMatches(body, input.state)) certificate = packet;
      if (!renewal && body.canApprove && matchesOwner) renewal = packet;
    }
    if (!trustedRoot) throw new DirectoryIdentityApprovalRequired();
    if (!certificate && renewal) {
      certificate = await signDirectoryDevice({
        state: input.state,
        accountSigningKey: root.accountSigningKey,
        issuerCertificateId: renewal.id,
        sign: input.sign
      });
      current();
      pool = { ...pool, [certificate.id]: certificate };
      verifyDirectoryCertificateChain(certificate.id, pool, { userId: input.state.userId, pinnedAccountKey: root.accountSigningKey });
      possessionSignature = await publishOwn(certificate);
      current();
    }
    if (!certificate) throw new DirectoryIdentityApprovalRequired();
    if (!possessionSignature) {
      const existing = proofs[certificate.id];
      possessionSignature = existing === void 0 ? await publishOwn(certificate) : verifyDirectoryCertificatePossession(certificate, existing);
      current();
    }
    if (!pin) {
      current();
      await input.savePin(root.accountSigningKey);
      current();
    }
    return { accountSigningKey: root.accountSigningKey, certificate, certificates: pool, possessionSignature };
  }
  return { ensure: () => {
    if (!inFlight) {
      const operation = ensure();
      inFlight = operation;
      void operation.finally(() => {
        if (inFlight === operation) inFlight = null;
      }).catch(() => void 0);
    }
    return inFlight;
  } };
}

// source/directory/src/e2ee/recoveryDirectoryCertificates.ts
var import_base64_js3 = __toESM(require_base64_js(), 1);
function requireRecoveryDirectorySupport(value) {
  if (!value || typeof value !== "object" || value.version !== 1 || value.recoveryCertificatesVersion !== 1 || !Number.isSafeInteger(value.certificateBatchLimit) || value.certificateBatchLimit < 2) throw new DirectoryCertificateError();
}
function requireRecoveryDirectoryAcknowledgement(data, certificate) {
  if ((data?.directoryProofVersion ?? data?.directory_proof_version) !== 1 || (data?.directoryCertificateId ?? data?.directory_certificate_id) !== certificate.id) throw new DirectoryCertificateError();
}
function requireRecoveryDirectoryRecord(record2, certificate) {
  const body = certificate.body;
  if (body.purpose !== "recovery" || body.vaultId !== record2.vaultId || body.epoch !== record2.epoch || body.recoveryPublicKey !== record2.recoveryPublicKey || body.approvalSigningKey !== record2.approvalSigningKey) throw new DirectoryCertificateError();
}
var unlockedVault = Symbol("validated recovery directory vault");
function bytes32(value) {
  if (typeof value !== "string" || value.length > 256 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) throw new DirectoryCertificateError();
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const bytes = (0, import_base64_js3.toByteArray)(normalized + "=".repeat((4 - normalized.length % 4) % 4));
    if (bytes.length !== 32) throw new DirectoryCertificateError();
    return bytes;
  } catch {
    throw new DirectoryCertificateError();
  }
}
function recoveryDirectoryVaultFromUnlocked(record2, bundle) {
  if (!record2 || typeof record2 !== "object" || !bundle || typeof bundle !== "object" || typeof record2.vaultId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(record2.vaultId) || !Number.isSafeInteger(record2.epoch) || record2.epoch <= 0 || !Array.isArray(bundle.keys) || !bundle.keys.length || bundle.keys.length > 32) throw new DirectoryCertificateError();
  const recoveryPublicKey = (0, import_base64_js3.fromByteArray)(bytes32(record2.recoveryPublicKey));
  const approvalSigningKey = canonicalDirectorySigningKey(record2.approvalSigningKey);
  const key = bundle.keys.find((candidate) => {
    if (!candidate || typeof candidate !== "object") throw new DirectoryCertificateError();
    return (0, import_base64_js3.fromByteArray)(bytes32(candidate.publicKey)) === recoveryPublicKey;
  });
  if (!key) throw new DirectoryCertificateError();
  const privateKey = bytes32(key.privateKey);
  let approvalSeed;
  try {
    approvalSeed = bytes32(bundle.approvalSigningSeed);
    if ((0, import_base64_js3.fromByteArray)(x25519.getPublicKey(privateKey)) !== recoveryPublicKey || (0, import_base64_js3.fromByteArray)(ed25519.getPublicKey(approvalSeed)) !== approvalSigningKey) throw new DirectoryCertificateError();
  } finally {
    privateKey.fill(0);
    approvalSeed?.fill(0);
  }
  const result = { vaultId: record2.vaultId, epoch: record2.epoch, recoveryPublicKey, approvalSigningKey };
  Object.defineProperty(result, unlockedVault, { value: true, enumerable: false, writable: false });
  return Object.freeze(result);
}
function requireUnlocked(vault) {
  if (vault?.[unlockedVault] !== true) throw new DirectoryCertificateError();
}
async function signRecoveryDirectoryCertificate(input) {
  requireUnlocked(input.vault);
  const body = canonicalDirectoryCertificateBody({
    version: 1,
    purpose: "recovery",
    userId: input.userId,
    accountSigningKey: input.accountSigningKey,
    issuerCertificateId: input.issuerCertificateId,
    canApprove: true,
    vaultId: input.vault.vaultId,
    epoch: input.vault.epoch,
    recoveryPublicKey: input.vault.recoveryPublicKey,
    approvalSigningKey: input.vault.approvalSigningKey
  });
  const certificate = canonicalDirectoryCertificatePacket({
    id: directoryCertificateId(body),
    body,
    signature: await input.signIssuer(directoryCertificateAuthorization(body))
  });
  const possessionSignature = verifyDirectoryCertificatePossession(
    certificate,
    await input.signRecovery(directoryCertificatePossessionAuthorization(certificate.id))
  );
  return { certificate, possessionSignature };
}
function authenticateRecoveryDirectoryAuthority(input) {
  requireUnlocked(input.vault);
  if (!input.data || typeof input.data !== "object") throw new DirectoryCertificateError();
  const data = input.data;
  if (data.version !== 1 || data.recoveryCertificatesVersion !== 1) throw new DirectoryCertificateError();
  const certificates = publicDirectoryCertificatePool(data.certificates);
  const proofs = publicDirectoryPossessionProofs(data.possessionProofs, certificates);
  if (data.accountSigningKey === null && data.rootCertificateId === null) {
    if (input.pinnedAccountKey !== null || Object.keys(certificates).length || Object.keys(proofs).length) throw new DirectoryCertificateError();
    return null;
  }
  if (typeof data.rootCertificateId !== "string" || typeof data.accountSigningKey !== "string") throw new DirectoryCertificateError();
  const root = verifyDirectoryCertificateChain(data.rootCertificateId, certificates, { userId: input.userId, pinnedAccountKey: input.pinnedAccountKey });
  if (root.issuerCertificateId !== null || root.accountSigningKey !== data.accountSigningKey) throw new DirectoryCertificateError();
  for (const certificate of Object.values(certificates).reverse()) {
    if (certificate.body?.purpose !== "recovery" || certificate.body.vaultId !== input.vault.vaultId) continue;
    const body = verifyDirectoryCertificateChain(certificate.id, certificates, { userId: input.userId, pinnedAccountKey: root.accountSigningKey });
    if (body.purpose !== "recovery") throw new DirectoryCertificateError();
    const expected = canonicalDirectoryCertificateBody({
      ...body,
      userId: input.userId,
      vaultId: input.vault.vaultId,
      epoch: input.vault.epoch,
      recoveryPublicKey: input.vault.recoveryPublicKey,
      approvalSigningKey: input.vault.approvalSigningKey
    });
    if (expected.purpose !== "recovery" || body.userId !== expected.userId || body.epoch !== expected.epoch || body.recoveryPublicKey !== expected.recoveryPublicKey || body.approvalSigningKey !== expected.approvalSigningKey || !body.canApprove) continue;
    const proof = proofs[certificate.id];
    if (proof === void 0 && input.pinnedAccountKey === null) throw new DirectoryIdentityApprovalRequired();
    return {
      accountSigningKey: root.accountSigningKey,
      certificate,
      certificates,
      possessionSignature: proof === void 0 ? null : verifyDirectoryCertificatePossession(certificate, proof)
    };
  }
  throw new DirectoryIdentityApprovalRequired();
}

// source/directory/src/e2ee/directoryHeads.ts
var import_base64_js4 = __toESM(require_base64_js(), 1);
var DIRECTORY_HEAD_PREFIX = "orizo-message-directory-head-v1\n";
var MAX_HEAD_ACTIVE = 128;
var MAX_HEAD_REVOKED = 512;
var DIRECTORY_HEAD_STALE_SECONDS = 45 * 86400;
var DIGEST2 = /^[0-9a-f]{64}$/;
var KEYS = [
  "version",
  "userId",
  "accountSigningKey",
  "epoch",
  "previousHeadId",
  "issuedAt",
  "issuerCertificateId",
  "activeCertificateIds",
  "revokedCertificateIds"
].sort();
var DirectoryHeadError = class extends Error {
  code = "message_directory_head_invalid";
  constructor() {
    super("This contact\u2019s device list could not be confirmed. Ask them to open Orizo on a trusted device.");
  }
};
var invalid2 = () => {
  throw new DirectoryHeadError();
};
var idList = (value, limit) => {
  if (!Array.isArray(value) || value.length > limit) return invalid2();
  const sorted2 = [...value].sort();
  if (sorted2.some((id, i) => typeof id !== "string" || !DIGEST2.test(id) || i > 0 && sorted2[i - 1] === id)) return invalid2();
  if (sorted2.some((id, i) => id !== value[i])) return invalid2();
  return sorted2;
};
function canonicalDirectoryHeadBody(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid2();
  const body = value;
  if (Object.keys(body).sort().join(",") !== KEYS.join(",") || body.version !== 1) return invalid2();
  const positive2 = (n) => typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : invalid2();
  const epoch = positive2(body.epoch);
  const previous = body.previousHeadId;
  if (epoch === 1 ? previous !== null : typeof previous !== "string" || !DIGEST2.test(previous)) return invalid2();
  if (typeof body.issuerCertificateId !== "string" || !DIGEST2.test(body.issuerCertificateId)) return invalid2();
  const active = idList(body.activeCertificateIds, MAX_HEAD_ACTIVE);
  const revoked = idList(body.revokedCertificateIds, MAX_HEAD_REVOKED);
  if (active.some((id) => revoked.includes(id))) return invalid2();
  if (revoked.includes(body.issuerCertificateId)) return invalid2();
  let accountSigningKey;
  try {
    accountSigningKey = canonicalDirectorySigningKey(body.accountSigningKey);
  } catch {
    return invalid2();
  }
  return {
    version: 1,
    userId: positive2(body.userId),
    accountSigningKey,
    epoch,
    previousHeadId: previous,
    issuedAt: positive2(body.issuedAt),
    issuerCertificateId: body.issuerCertificateId,
    activeCertificateIds: active,
    revokedCertificateIds: revoked
  };
}
function directoryHeadAuthorization(body) {
  const canonical = canonicalDirectoryHeadBody(body);
  const sorted2 = Object.fromEntries(Object.entries(canonical).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  return DIRECTORY_HEAD_PREFIX + JSON.stringify(sorted2);
}
var directoryHeadId = (body) => bytesToHex(sha256(utf8ToBytes(directoryHeadAuthorization(body))));
function verifyDirectoryHead(packet, pool, input) {
  if (!packet || typeof packet !== "object") return invalid2();
  const raw = packet;
  if (Object.keys(raw).sort().join(",") !== "body,id,signature") return invalid2();
  const body = canonicalDirectoryHeadBody(raw.body);
  if (body.userId !== input.userId || body.accountSigningKey !== input.accountSigningKey || raw.id !== directoryHeadId(body)) return invalid2();
  let issuer;
  try {
    issuer = verifyDirectoryCertificateChain(body.issuerCertificateId, pool, { userId: input.userId, pinnedAccountKey: input.accountSigningKey });
  } catch (error) {
    if (error instanceof DirectoryCertificateError) return invalid2();
    throw error;
  }
  if (!issuer.canApprove) return invalid2();
  const isRoot = issuer.issuerCertificateId === null;
  if (!isRoot && !body.activeCertificateIds.includes(body.issuerCertificateId)) return invalid2();
  const signature = typeof raw.signature === "string" ? raw.signature : invalid2();
  try {
    const sig = (0, import_base64_js4.toByteArray)(signature.replace(/=+$/, "") + "=".repeat((4 - signature.replace(/=+$/, "").length % 4) % 4));
    if (sig.length !== 64 || !ed25519.verify(
      sig,
      utf8ToBytes(directoryHeadAuthorization(body)),
      (0, import_base64_js4.toByteArray)(directoryCertificateSigningKey(issuer)),
      { zip215: false }
    )) return invalid2();
  } catch {
    return invalid2();
  }
  return { id: raw.id, body, signature };
}
function advanceDirectoryHeadPin(head, pin) {
  if (pin) {
    if (head.body.epoch < pin.epoch) return invalid2();
    if (head.body.epoch === pin.epoch && head.id !== pin.headId) return invalid2();
  }
  return { epoch: head.body.epoch, headId: head.id };
}
function headAllows(head, certificateId) {
  return head.body.activeCertificateIds.includes(certificateId) && !head.body.revokedCertificateIds.includes(certificateId);
}
var directoryHeadIsStale = (head, nowSeconds = Math.floor(Date.now() / 1e3)) => nowSeconds - head.body.issuedAt > DIRECTORY_HEAD_STALE_SECONDS;
function nextDirectoryHeadBody(input) {
  const revoked = /* @__PURE__ */ new Set([...input.previous?.body.revokedCertificateIds ?? [], ...input.revoke ?? []]);
  const active = [...new Set(input.active)].filter((id) => !revoked.has(id)).sort();
  return canonicalDirectoryHeadBody({
    version: 1,
    userId: input.userId,
    accountSigningKey: input.accountSigningKey,
    epoch: (input.previous?.body.epoch ?? 0) + 1,
    previousHeadId: input.previous?.id ?? null,
    issuedAt: Math.max(input.nowSeconds ?? Math.floor(Date.now() / 1e3), (input.previous?.body.issuedAt ?? 0) + 1),
    issuerCertificateId: input.issuerCertificateId,
    activeCertificateIds: active,
    revokedCertificateIds: [...revoked].sort()
  });
}
var encodeSignature = (bytes) => (0, import_base64_js4.fromByteArray)(bytes);
function checkDirectoryHeads(input) {
  const data = input.payload && typeof input.payload === "object" ? input.payload : { version: 1, heads: [], certificates: [] };
  if (data.version !== 1 || !Array.isArray(data.heads) || !Array.isArray(data.certificates) || data.heads.length > 64) return invalid2();
  const pool = {};
  for (const certificate of data.certificates) {
    if (!certificate || typeof certificate.id !== "string") return invalid2();
    pool[certificate.id] = certificate;
  }
  const headsByUser = /* @__PURE__ */ new Map();
  for (const head of data.heads) {
    const userId = head?.body?.userId;
    if (typeof userId !== "number" || headsByUser.has(userId)) return invalid2();
    headsByUser.set(userId, head);
  }
  const pins = [];
  const stale = [];
  const users = [...new Set(input.bindings.map((binding) => binding.userId))];
  for (const userId of users) {
    const raw = headsByUser.get(userId);
    const pin = input.pins.get(userId) ?? null;
    if (raw === void 0) {
      if (pin) return invalid2();
      continue;
    }
    const accountSigningKey = input.accountKeys.get(userId);
    if (!accountSigningKey) return invalid2();
    const head = verifyDirectoryHead(raw, pool, { userId, accountSigningKey });
    pins.push({ userId, pin: advanceDirectoryHeadPin(head, pin) });
    for (const binding of input.bindings.filter((entry) => entry.userId === userId)) {
      if (!binding.certificateId || !headAllows(head, binding.certificateId)) return invalid2();
    }
    if (directoryHeadIsStale(head, input.nowSeconds)) stale.push(userId);
  }
  return { pins, staleUserIds: stale };
}
var DIRECTORY_HEAD_PIN_PREFIX = "@message-e2ee-directory-head:";
function createSealedDirectoryHeadPins(input) {
  const key = (subjectId) => `${DIRECTORY_HEAD_PIN_PREFIX}${input.viewerId}:${subjectId}`;
  const context = (subjectId) => `directory-head-v1:${input.viewerId}:${subjectId}`;
  async function read(subjectId) {
    input.assertCurrent();
    const raw = await input.getItem(key(subjectId));
    input.assertCurrent();
    if (raw === null) return null;
    try {
      const sealed = JSON.parse(raw);
      const value = await input.open(context(subjectId), sealed);
      input.assertCurrent();
      if (!value || value.version !== 1 || value.viewerId !== input.viewerId || value.subjectId !== subjectId || typeof value.epoch !== "number" || !Number.isSafeInteger(value.epoch) || value.epoch <= 0 || typeof value.headId !== "string" || !DIGEST2.test(value.headId)) return invalid2();
      return { epoch: value.epoch, headId: value.headId };
    } catch {
      input.assertCurrent();
      return invalid2();
    }
  }
  async function write(subjectId, pin) {
    const previous = await read(subjectId);
    if (previous && (pin.epoch < previous.epoch || pin.epoch === previous.epoch && pin.headId !== previous.headId)) return invalid2();
    if (previous && previous.epoch === pin.epoch) return;
    const sealed = await input.seal(context(subjectId), { version: 1, viewerId: input.viewerId, subjectId, ...pin });
    input.assertCurrent();
    await input.setItem(key(subjectId), JSON.stringify(sealed));
    input.assertCurrent();
  }
  return { read, write };
}

// source/directory/src/e2ee/messageAuthorBinding.ts
var import_base64_js6 = __toESM(require_base64_js(), 1);

// source/directory/src/e2ee/messageAuthorBindingWire.ts
var import_base64_js5 = __toESM(require_base64_js(), 1);
var MESSAGE_AUTHOR_BINDING_VERSION = 2;
var MAX_MESSAGE_AUTHOR_HEADER_BYTES = 65536;
var digest = /^[a-f0-9]{64}$/;
var authorUuid = (value) => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
var authorDeviceId = (value) => typeof value === "string" && value === value.trim() && Array.from(value).length >= 1 && Array.from(value).length <= 128 && /^[\p{L}\p{M}\p{N}\p{P}\p{S} ]+$/u.test(value);
var MessageAuthorBindingError = class extends Error {
  code;
  constructor(code = "message_author_binding_invalid") {
    super("Encrypted message author could not be verified.");
    this.name = "MessageAuthorBindingError";
    this.code = code;
  }
};
var fail = () => {
  throw new MessageAuthorBindingError();
};
var record = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : fail();
function exact(value, keys) {
  if (Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) fail();
}
function authorEncoded(value, length) {
  if (typeof value !== "string" || value.length > 256 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return fail();
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (normalized.length % 4 === 1) return fail();
  try {
    const bytes = (0, import_base64_js5.toByteArray)(normalized + "=".repeat((4 - normalized.length % 4) % 4));
    if (bytes.length !== length) return fail();
    return (0, import_base64_js5.fromByteArray)(bytes);
  } catch {
    return fail();
  }
}
var positive = (value) => Number.isSafeInteger(value) && Number(value) > 0 ? value : fail();
var sorted = (value) => Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
function publicCertificate(value) {
  const packet = record(value);
  exact(packet, ["id", "body", "signature"]);
  if (typeof packet.id !== "string" || !digest.test(packet.id)) return fail();
  const body = record(packet.body), device = body.purpose === "device";
  if (!device && body.purpose !== "recovery") return fail();
  exact(body, ["version", "purpose", "userId", "accountSigningKey", "issuerCertificateId", "canApprove", ...device ? ["deviceId", "identityKey", "signingKey", "notificationKeyHash"] : ["vaultId", "epoch", "recoveryPublicKey", "approvalSigningKey"]]);
  if (body.version !== 1 || typeof body.canApprove !== "boolean" || body.issuerCertificateId !== null && (typeof body.issuerCertificateId !== "string" || !digest.test(body.issuerCertificateId))) return fail();
  const common = { version: 1, purpose: body.purpose, userId: positive(body.userId), accountSigningKey: authorEncoded(body.accountSigningKey, 32), issuerCertificateId: body.issuerCertificateId, canApprove: body.canApprove };
  let canonical;
  if (device) {
    if (!authorDeviceId(body.deviceId)) return fail();
    canonical = { ...common, deviceId: body.deviceId, identityKey: authorEncoded(body.identityKey, 32), signingKey: authorEncoded(body.signingKey, 32), notificationKeyHash: authorEncoded(body.notificationKeyHash, 32) };
  } else {
    if (!authorUuid(body.vaultId)) return fail();
    canonical = { ...common, vaultId: body.vaultId, epoch: positive(body.epoch), recoveryPublicKey: authorEncoded(body.recoveryPublicKey, 32), approvalSigningKey: authorEncoded(body.approvalSigningKey, 32) };
  }
  return { id: packet.id, body: sorted(canonical), signature: authorEncoded(packet.signature, 64) };
}
function canonicalMessageAuthorBinding(value) {
  try {
    const header = record(value);
    exact(header, ["version", "certificateId", "certificates", "signature"]);
    if (header.version !== 2 || typeof header.certificateId !== "string" || !digest.test(header.certificateId) || !Array.isArray(header.certificates) || header.certificates.length < 1 || header.certificates.length > 16) return fail();
    const certificates = header.certificates.map(publicCertificate).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    if (new Set(certificates.map((packet) => packet.id)).size !== certificates.length) return fail();
    const result = { version: 2, certificateId: header.certificateId, certificates, signature: authorEncoded(header.signature, 64) };
    const json = JSON.stringify(result);
    if (json.length > MAX_MESSAGE_AUTHOR_HEADER_BYTES) return fail();
    let bytes = 0;
    for (const point of json) {
      const code = point.codePointAt(0);
      bytes += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4;
    }
    if (bytes > MAX_MESSAGE_AUTHOR_HEADER_BYTES) return fail();
    return result;
  } catch {
    return fail();
  }
}
function messageAuthorBindingFromRaw(raw) {
  const camel = raw.senderBinding, snake = raw.sender_binding;
  const value = camel ?? snake;
  if (value === void 0 || value === null) return null;
  const canonical = canonicalMessageAuthorBinding(value);
  if (camel != null && snake != null && JSON.stringify(canonical) !== JSON.stringify(canonicalMessageAuthorBinding(snake))) return fail();
  return canonical;
}

// source/directory/src/e2ee/messageAuthorBinding.ts
var BODY_PREFIX = "orizo-message-author-v2\n";
var SIGNATURE_PREFIX = "orizo-message-author-signature-v2\n";
var fail2 = () => {
  throw new MessageAuthorBindingError();
};
function messageAuthorContextFromRaw(raw) {
  return {
    conversationId: String(raw.conversation || raw.conversationId || raw.conversation_id || ""),
    clientMessageId: String(raw.clientMessageId || raw.client_message_id || ""),
    senderUserId: Number(raw.sender?.id || 0),
    senderDeviceId: String(raw.senderDeviceId || raw.sender_device_id || ""),
    senderSessionGeneration: Number(raw.senderSessionGeneration ?? raw.sender_session_generation ?? 0),
    eventType: String(raw.eventType || raw.event_type || "message")
  };
}
function messageAuthorBodyContext(context, certificateId) {
  const c = context;
  if (!authorUuid(c.conversationId) || !authorUuid(c.clientMessageId) || !Number.isSafeInteger(c.senderUserId) || c.senderUserId <= 0 || !authorDeviceId(c.senderDeviceId) || !Number.isSafeInteger(c.senderSessionGeneration) || c.senderSessionGeneration < 0 || !["message", "reaction", "edit", "delete", "call"].includes(c.eventType) || typeof certificateId !== "string" || !/^[a-f0-9]{64}$/.test(certificateId)) return fail2();
  return BODY_PREFIX + JSON.stringify([2, c.conversationId, c.clientMessageId, c.senderUserId, c.senderDeviceId, c.senderSessionGeneration, c.eventType, certificateId]);
}
function messageAuthorSignatureAuthorization(bodyContext, cipherNonce, ciphertext) {
  if (typeof bodyContext !== "string" || !bodyContext.startsWith(BODY_PREFIX) || typeof ciphertext !== "string" || !ciphertext || ciphertext.length > 2e6 || authorEncoded(cipherNonce, 24) !== cipherNonce) return fail2();
  return SIGNATURE_PREFIX + JSON.stringify([bodyContext, cipherNonce, bytesToHex(sha256(utf8ToBytes(ciphertext)))]);
}
async function verifyMessageAuthorBinding(input) {
  try {
    const binding = canonicalMessageAuthorBinding(input.binding), pool = Object.fromEntries(binding.certificates.map((packet) => [packet.id, packet]));
    const bodyContext = messageAuthorBodyContext(input.context, binding.certificateId);
    const leaf = verifyDirectoryCertificateChain(binding.certificateId, pool, { userId: input.context.senderUserId, pinnedAccountKey: input.pinnedAccountKey });
    if (leaf.purpose !== "device" || leaf.deviceId !== input.context.senderDeviceId) return fail2();
    const seen = /* @__PURE__ */ new Set();
    let current = binding.certificateId;
    while (current !== null) {
      if (seen.has(current) || !pool[current]) return fail2();
      seen.add(current);
      current = pool[current].body.issuerCertificateId;
    }
    if (seen.size !== binding.certificates.length) return fail2();
    const authorization = messageAuthorSignatureAuthorization(bodyContext, input.cipherNonce, input.ciphertext);
    if (input.verify) await input.verify(leaf.signingKey, authorization, binding.signature);
    else if (!ed25519.verify((0, import_base64_js6.toByteArray)(binding.signature), utf8ToBytes(authorization), (0, import_base64_js6.toByteArray)(leaf.signingKey), { zip215: false })) return fail2();
    return { binding, bodyContext, leaf, accountSigningKey: leaf.accountSigningKey };
  } catch {
    return fail2();
  }
}
async function createMessageAuthorBinding(input) {
  const certificateId = input.identity.certificate.id, certificates = [], seen = /* @__PURE__ */ new Set();
  let current = certificateId;
  while (current !== null) {
    const packet = current === certificateId ? input.identity.certificate : input.identity.certificates[current];
    if (!packet || seen.has(current) || certificates.length >= 16) return fail2();
    seen.add(current);
    certificates.push(packet);
    current = packet.body.issuerCertificateId;
  }
  const bodyContext = messageAuthorBodyContext(input.context, certificateId);
  const signature = await input.sign(messageAuthorSignatureAuthorization(bodyContext, input.cipherNonce, input.ciphertext));
  const verified = await verifyMessageAuthorBinding({
    binding: { version: 2, certificateId, certificates, signature },
    context: input.context,
    cipherNonce: input.cipherNonce,
    ciphertext: input.ciphertext,
    pinnedAccountKey: input.identity.accountSigningKey
  });
  return verified.binding;
}

// source/directory/src/e2ee/recipientDirectoryCertificates.ts
var RecipientDirectoryCertificateError = class extends Error {
  code = "message_directory_certificate_required";
  constructor() {
    super("Messaging identity approval is required before sending. Open message security on your trusted device and ask the recipient to do the same.");
  }
};
var object2 = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DirectoryCertificateError();
  return value;
};
function exact2(value, keys) {
  const data = object2(value);
  if (Object.keys(data).sort().join(",") !== keys.sort().join(",")) throw new DirectoryCertificateError();
  return data;
}
function rows(value, limit, keys, id) {
  if (!Array.isArray(value) || value.length > limit) throw new DirectoryCertificateError();
  const result = /* @__PURE__ */ new Map();
  for (const valueEntry of value) {
    const entry = exact2(valueEntry, keys), key = id(entry);
    if (result.has(key)) throw new DirectoryCertificateError();
    result.set(key, entry);
  }
  return result;
}
function validateRecipientDirectoryCertificates(input) {
  try {
    if (!input.targets.devices.length || input.targets.devices.length > 64 || input.targets.recoveryVaults.length > 32) throw new DirectoryCertificateError();
    const data = exact2(input.proofs, ["version", "accounts", "devices", "recoveryVaults", "possessionProofs", "certificates"]);
    if (data.version !== 1) throw new DirectoryCertificateError();
    const pool = publicDirectoryCertificatePool(data.certificates), proofs = publicDirectoryPossessionProofs(data.possessionProofs, pool);
    const accountRows = rows(data.accounts, 64, ["userId", "accountSigningKey", "rootCertificateId"], (entry) => String(entry.userId));
    const deviceRows = rows(data.devices, 64, ["userId", "deviceId", "certificateId"], (entry) => `${entry.userId}:${entry.deviceId}`);
    const vaultRows = rows(data.recoveryVaults, 32, ["userId", "vaultId", "epoch", "certificateId"], (entry) => String(entry.userId));
    const users = new Set([...input.targets.devices, ...input.targets.recoveryVaults].map((target) => target.userId));
    if (accountRows.size !== users.size || deviceRows.size !== input.targets.devices.length || vaultRows.size !== input.targets.recoveryVaults.length) throw new DirectoryCertificateError();
    const accounts = /* @__PURE__ */ new Map();
    for (const userId of users) {
      const account = accountRows.get(String(userId));
      if (!Number.isSafeInteger(userId) || userId <= 0 || !account || account.userId !== userId || !input.pins.has(userId)) throw new DirectoryCertificateError();
      const key = canonicalDirectorySigningKey(account.accountSigningKey), pin = input.pins.get(userId);
      if (pin !== null && pin !== key) throw new DirectoryCertificateError();
      const root = verifyDirectoryCertificateChain(account.rootCertificateId, pool, { userId, pinnedAccountKey: pin });
      if (root.issuerCertificateId !== null || root.accountSigningKey !== key) throw new DirectoryCertificateError();
      accounts.set(userId, { ...account, accountSigningKey: key });
    }
    const selected = [];
    for (const target of input.targets.devices) {
      const binding = deviceRows.get(`${target.userId}:${target.deviceId}`), account = accounts.get(target.userId);
      if (!binding || binding.userId !== target.userId || binding.deviceId !== target.deviceId) throw new DirectoryCertificateError();
      const body = verifyDirectoryCertificateChain(binding.certificateId, pool, { userId: target.userId, pinnedAccountKey: account.accountSigningKey });
      if (!directoryDeviceMatches(body, target)) throw new DirectoryCertificateError();
      const packet = pool[binding.certificateId];
      verifyDirectoryCertificatePossession(packet, proofs[packet.id]);
      selected.push(packet);
    }
    for (const target of input.targets.recoveryVaults) {
      const binding = vaultRows.get(String(target.userId)), account = accounts.get(target.userId);
      if (!binding || binding.userId !== target.userId || binding.epoch !== target.epoch) throw new DirectoryCertificateError();
      const body = verifyDirectoryCertificateChain(binding.certificateId, pool, { userId: target.userId, pinnedAccountKey: account.accountSigningKey });
      if (body.purpose !== "recovery" || body.vaultId !== binding.vaultId || body.epoch !== target.epoch || body.recoveryPublicKey !== target.recoveryPublicKey) throw new DirectoryCertificateError();
      const packet = pool[binding.certificateId];
      verifyDirectoryCertificatePossession(packet, proofs[packet.id]);
      selected.push(packet);
    }
    const pins = [];
    for (const [userId, account] of accounts) {
      if (input.pins.get(userId) !== null) continue;
      if (input.verifiedLegacy) {
        const known = input.targets.devices.filter((device) => device.userId === userId);
        const rootHeldByVerifiedDevice = known.some((device) => canonicalDirectorySigningKey(device.signingKey) === account.accountSigningKey);
        const priorDeviceEndorsement = selected.some((packet) => packet.body.purpose === "device" && packet.body.userId === userId && known.some((device) => directoryDeviceMatches(packet.body, device, false)) && proofs[packet.id] !== void 0);
        if (!rootHeldByVerifiedDevice && !priorDeviceEndorsement) throw new DirectoryCertificateError();
      }
      pins.push({ userId, accountSigningKey: account.accountSigningKey });
    }
    return pins;
  } catch {
    throw new RecipientDirectoryCertificateError();
  }
}
export {
  DIRECTORY_CERTIFICATE_PREFIX,
  DIRECTORY_HEAD_PIN_PREFIX,
  DIRECTORY_HEAD_PREFIX,
  DIRECTORY_HEAD_STALE_SECONDS,
  DIRECTORY_POSSESSION_PREFIX,
  DirectoryCertificateError,
  DirectoryHeadError,
  DirectoryIdentityApprovalRequired,
  MAX_DIRECTORY_CERTIFICATES,
  MAX_DIRECTORY_CHAIN_DEPTH,
  MAX_HEAD_ACTIVE,
  MAX_HEAD_REVOKED,
  MAX_MESSAGE_AUTHOR_HEADER_BYTES,
  MESSAGE_AUTHOR_BINDING_VERSION,
  MessageAuthorBindingError,
  RecipientDirectoryCertificateError,
  advanceDirectoryHeadPin,
  authenticateRecoveryDirectoryAuthority,
  authorDeviceId,
  authorEncoded,
  authorUuid,
  canonicalDirectoryCertificateBody,
  canonicalDirectoryCertificatePacket,
  canonicalDirectoryHeadBody,
  canonicalDirectorySigningKey,
  canonicalMessageAuthorBinding,
  checkDirectoryHeads,
  createDirectoryIdentityEnrollment,
  createMessageAuthorBinding,
  createSealedDirectoryHeadPins,
  directoryCertificateAuthorization,
  directoryCertificateId,
  directoryCertificatePossessionAuthorization,
  directoryCertificateSigningKey,
  directoryDeviceMatches,
  directoryHeadAuthorization,
  directoryHeadId,
  directoryHeadIsStale,
  directoryNotificationKeyHash,
  encodeSignature,
  headAllows,
  messageAuthorBindingFromRaw,
  messageAuthorBodyContext,
  messageAuthorContextFromRaw,
  messageAuthorSignatureAuthorization,
  nextDirectoryHeadBody,
  publicDirectoryCertificatePool,
  publicDirectoryPossessionProofs,
  recoveryDirectoryVaultFromUnlocked,
  requireRecoveryDirectoryAcknowledgement,
  requireRecoveryDirectoryRecord,
  requireRecoveryDirectorySupport,
  signDirectoryDevice,
  signRecoveryDirectoryCertificate,
  validateRecipientDirectoryCertificates,
  verifyDirectoryCertificateChain,
  verifyDirectoryCertificatePossession,
  verifyDirectoryHead,
  verifyMessageAuthorBinding
};
/*! Bundled license information:

@noble/curves/utils.js:
@noble/curves/abstract/modular.js:
@noble/curves/abstract/curve.js:
@noble/curves/abstract/edwards.js:
@noble/curves/abstract/montgomery.js:
@noble/curves/ed25519.js:
  (*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) *)
*/

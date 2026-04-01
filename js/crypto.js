// --- CORE SECP256K1 & CRYPTO CONSTANTS ---
export const P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2Fn;
export const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
export const Gx = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n;
export const Gy = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n;
export const ALPH = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

// --- CRYPTO FUNCTIONS ---

/**
 * Calculates the modular multiplicative inverse of a under modulo m.
 * @param {bigint} a The number to find the inverse for.
 * @param {bigint} m The modulus.
 * @returns {bigint} The modular inverse.
 */
export function modInverse(a, m) {
    let [b, x0, x1] = [m, 0n, 1n];
    while (a > 1n) {
        let q = a / b;
        [a, b] = [b, a % b];
        [x0, x1] = [x1 - q * x0, x0];
    }
    return x1 < 0n ? x1 + m : x1;
}

/**
 * Adds two points on the secp256k1 curve.
 * @param {{x: bigint, y: bigint} | null} P1 The first point.
 * @param {{x: bigint, y: bigint} | null} P2 The second point.
 * @returns {{x: bigint, y: bigint} | null} The resulting point.
 */
export function addPoints(P1, P2) {
    if (!P1) return P2;
    if (!P2) return P1;
    let lam;
    if (P1.x === P2.x && P1.y === P2.y) { // Point doubling
        lam = (3n * P1.x * P1.x * modInverse(2n * P1.y, P)) % P;
    } else { // Point addition
        let dx = (P2.x - P1.x + P) % P;
        lam = ((P2.y - P1.y + P) * modInverse(dx, P)) % P;
    }
    let x3 = (lam * lam - P1.x - P2.x) % P;
    if (x3 < 0n) x3 += P;
    let y3 = (lam * (P1.x - x3) - P1.y) % P;
    if (y3 < 0n) y3 += P;
    return { x: x3, y: y3 };
}

/**
 * Multiplies the generator point G by a scalar (private key).
 * @param {bigint} scalar The private key.
 * @returns {{x: bigint, y: bigint} | null} The resulting public key point.
 */
export function multiply(scalar) {
    let res = null;
    let curr = { x: Gx, y: Gy };
    let s = scalar % N;
    if (s === 0n) return null;
    while (s > 0n) {
        if (s & 1n) res = addPoints(res, curr);
        curr = addPoints(curr, curr);
        s >>= 1n;
    }
    return res;
}

/**
 * Computes the SHA-256 hash of a hexadecimal string synchronously.
 * @param {string} hex The hexadecimal string to hash.
 * @returns {string} The resulting hash as a hex string.
 */
export function sha256(hex) {
    const data = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        data[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }

    const K = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];

    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

    const buffer = new Uint8Array(((data.length + 8) >> 6) + 1 << 6);
    buffer.set(data);
    buffer[data.length] = 0x80;
    const view = new DataView(buffer.buffer);
    view.setUint32(buffer.length - 4, data.length * 8, false);

    const w = new Uint32Array(64);
    for (let i = 0; i < buffer.length; i += 64) {
        for (let j = 0; j < 16; j++) w[j] = view.getUint32(i + j * 4, false);
        for (let j = 16; j < 64; j++) {
            const w15 = w[j - 15], w2 = w[j - 2];
            const s0 = (w15 >>> 7 | w15 << 25) ^ (w15 >>> 18 | w15 << 14) ^ (w15 >>> 3);
            const s1 = (w2 >>> 17 | w2 << 15) ^ (w2 >>> 19 | w2 << 13) ^ (w2 >>> 10);
            w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
        }
        let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
        for (let j = 0; j < 64; j++) {
            const S1 = (e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7);
            const ch = (e & f) ^ (~e & g);
            const temp1 = (h + S1 + ch + K[j] + w[j]) | 0;
            const S0 = (a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (S0 + maj) | 0;
            h = g; g = f; f = e; e = (d + temp1) | 0;
            d = c; c = b; b = a; a = (temp1 + temp2) | 0;
        }
        h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
        h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
    }

    const res = new Uint8Array(32);
    const resView = new DataView(res.buffer);
    resView.setUint32(0, h0, false); resView.setUint32(4, h1, false);
    resView.setUint32(8, h2, false); resView.setUint32(12, h3, false);
    resView.setUint32(16, h4, false); resView.setUint32(20, h5, false);
    resView.setUint32(24, h6, false); resView.setUint32(28, h7, false);

    let hexStr = '';
    for (let i = 0; i < 32; i++) {
        hexStr += res[i].toString(16).padStart(2, '0');
    }
    return hexStr;
}

/**
 * Computes the RIPEMD-160 hash of a byte array.
 * @param {Uint8Array} data The data to hash.
 * @returns {string} The resulting hash as a hex string.
 */
export function ripemd160(data) {
    const rotl = (x, n) => (x << n) | (x >>> (32 - n));
    const f = (t, x, y, z) => [x ^ y ^ z, (x & y) | (~x & z), (x | ~y) ^ z, (x & z) | (y & ~z), x ^ (y | ~z)][t];
    const K = [0x00000000, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xa953fd4e], KK = [0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x7a6d76e9, 0x00000000];
    const r = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 7, 4, 13, 1, 10, 6, 15, 3, 12, 0, 9, 5, 2, 14, 11, 8, 3, 10, 14, 4, 9, 15, 8, 1, 2, 7, 0, 6, 13, 11, 5, 12, 1, 9, 11, 10, 0, 8, 12, 4, 13, 3, 7, 15, 14, 5, 6, 2, 4, 0, 5, 9, 7, 12, 2, 10, 14, 1, 3, 8, 11, 6, 15, 13], rr = [5, 14, 7, 0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12, 6, 11, 3, 7, 0, 13, 5, 10, 14, 15, 8, 12, 4, 9, 1, 2, 15, 5, 1, 3, 7, 14, 6, 9, 11, 8, 12, 2, 10, 0, 4, 13, 8, 6, 4, 1, 3, 11, 15, 0, 5, 12, 2, 13, 9, 7, 10, 14, 12, 15, 10, 4, 1, 5, 8, 7, 6, 2, 13, 14, 0, 3, 9, 11], s = [11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8, 7, 6, 8, 13, 11, 9, 7, 15, 7, 12, 15, 9, 11, 7, 13, 12, 11, 13, 6, 7, 14, 9, 13, 15, 14, 8, 13, 6, 5, 12, 7, 5, 11, 12, 14, 15, 14, 15, 9, 8, 9, 14, 5, 6, 8, 6, 5, 12, 9, 15, 5, 11, 6, 8, 13, 12, 5, 12, 13, 14, 11, 8, 5, 6], ss = [8, 9, 9, 11, 13, 15, 15, 5, 7, 7, 8, 11, 14, 14, 12, 6, 9, 13, 15, 7, 12, 8, 9, 11, 7, 7, 12, 7, 6, 15, 13, 11, 9, 7, 15, 11, 8, 6, 6, 14, 12, 13, 5, 14, 13, 13, 7, 5, 15, 5, 8, 11, 14, 14, 6, 14, 6, 9, 12, 9, 12, 5, 15, 8, 8, 5, 12, 9, 12, 5, 14, 6, 8, 13, 6, 5, 15, 13, 11, 11];
    let h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
    const p = new Uint8Array(((data.length + 8) >> 6) + 1 << 6); p.set(data); p[data.length] = 0x80;
    const v = new DataView(p.buffer); v.setUint32(p.length - 8, data.length << 3, true);
    for (let i = 0; i < p.length; i += 64) {
        let [a, b, c, d, e] = h, [aa, bb, cc, dd, ee] = h, w = new Uint32Array(16); for (let j = 0; j < 16; j++) w[j] = v.getUint32(i + j * 4, true);
        for (let j = 0; j < 80; j++) {
            let T = (a + f(Math.floor(j / 16), b, c, d) + w[r[j]] + K[Math.floor(j / 16)]) | 0; a = e; e = d; d = rotl(c, 10); c = b; b = (rotl(T, s[j]) + a) | 0;
            T = (aa + f(4 - Math.floor(j / 16), bb, cc, dd) + w[rr[j]] + KK[Math.floor(j / 16)]) | 0; aa = ee; ee = dd; dd = rotl(cc, 10); cc = bb; bb = (rotl(T, ss[j]) + aa) | 0;
        }
        let T = (h[1] + c + dd) | 0; h[1] = (h[2] + d + ee) | 0; h[2] = (h[3] + e + aa) | 0; h[3] = (h[4] + a + bb) | 0; h[4] = (h[0] + b + cc) | 0; h[0] = T;
    }
    return Array.from(new Uint8Array(new Uint32Array(h).buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Encodes a hexadecimal string into Base58.
 * @param {string} hex The hexadecimal string to encode.
 * @returns {string} The Base58 encoded string.
 */
export function toBase58(hex) {
    let n = BigInt('0x' + hex), res = "";
    while (n > 0n) {
        res = ALPH[Number(n % 58n)] + res;
        n /= 58n;
    }
    for (let i = 0; i < hex.length && hex[i] === '0' && hex[i + 1] === '0'; i += 2) {
        res = ALPH[0] + res;
    }
    return res;
}
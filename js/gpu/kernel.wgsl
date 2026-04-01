// Structure pour stocker un nombre 256-bit (8 x 32-bit uints)
struct U256 {
    components: array<u32, 8>
};

// Additionne deux entiers 32 bits avec retenue (carry)
// Retourne vec2<u32>(somme, nouvelle_retenue)
fn add_with_carry(a: u32, b: u32, carry: u32) -> vec2<u32> {
    let sum1 = a + b;
    let c1 = u32(sum1 < a); // Si la somme est plus petite que a, il y a eu un overflow
    let final_sum = sum1 + carry;
    let c2 = u32(final_sum < sum1); // Vérification d'un second overflow avec la retenue
    return vec2<u32>(final_sum, c1 + c2);
}

// Additionne deux U256 (Little-endian : l'index 0 est le poids faible)
fn u256_add(a: U256, b: U256) -> U256 {
    var res: U256;
    var carry: u32 = 0u;
    for (var i: u32 = 0u; i < 8u; i = i + 1u) {
        let step = add_with_carry(a.components[i], b.components[i], carry);
        res.components[i] = step.x;
        carry = step.y;
    }
    return res;
}

// Additionne un u32 à un U256 (Idéal pour ajouter le thread_id à la clé de base)
fn u256_add_u32(a: U256, b: u32) -> U256 {
    var res: U256;
    var carry: u32 = b;
    for (var i: u32 = 0u; i < 8u; i = i + 1u) {
        let step = add_with_carry(a.components[i], 0u, carry);
        res.components[i] = step.x;
        carry = step.y;
    }
    return res;
}

// Soustrait deux entiers 32 bits avec emprunt (borrow)
// Retourne vec2<u32>(difference, nouvel_emprunt)
fn sub_with_borrow(a: u32, b: u32, borrow: u32) -> vec2<u32> {
    let sub1 = a - b;
    let b1 = u32(a < b); // Si a < b, il y a un underflow (emprunt)
    let final_sub = sub1 - borrow;
    let b2 = u32(sub1 < borrow); // Vérification d'un second underflow avec l'emprunt précédent
    return vec2<u32>(final_sub, b1 + b2);
}

// Soustrait deux nombres 256 bits (a - b)
fn u256_sub(a: U256, b: U256) -> U256 {
    var res: U256;
    var borrow: u32 = 0u;
    for (var i: u32 = 0u; i < 8u; i = i + 1u) {
        let step = sub_with_borrow(a.components[i], b.components[i], borrow);
        res.components[i] = step.x;
        borrow = step.y;
    }
    return res;
}

// Compare deux nombres 256 bits. Retourne vrai si a >= b
fn u256_gte(a: U256, b: U256) -> bool {
    for (var i: u32 = 0u; i < 8u; i = i + 1u) {
        let idx = 7u - i; // On compare d'abord les poids forts (index 7 vers 0)
        if (a.components[idx] > b.components[idx]) { return true; }
        if (a.components[idx] < b.components[idx]) { return false; }
    }
    return true; // Ils sont parfaitement égaux
}

// Multiplie deux u32 pour obtenir un résultat 64 bits (pseudo u64)
// vec2.x = poids faible (low 32), vec2.y = poids fort (high 32)
fn mul_u32_to_u64(a: u32, b: u32) -> vec2<u32> {
    let a_lo = a & 0xFFFFu;
    let a_hi = a >> 16u;
    let b_lo = b & 0xFFFFu;
    let b_hi = b >> 16u;

    let lo_lo = a_lo * b_lo;
    let hi_lo = a_hi * b_lo;
    let lo_hi = a_lo * b_hi;
    let hi_hi = a_hi * b_hi;

    let cross1 = (lo_lo >> 16u) + hi_lo;
    let cross2 = (cross1 & 0xFFFFu) + lo_hi;

    let low_32 = (cross2 << 16u) | (lo_lo & 0xFFFFu);
    let high_32 = hi_hi + (cross1 >> 16u) + (cross2 >> 16u);

    return vec2<u32>(low_32, high_32);
}

// Multiplie deux nombres 256 bits. 
// (Note : le résultat est tronqué à 256 bits, ce qui correspond à un modulo 2^256)
fn u256_mul(a: U256, b: U256) -> U256 {
    var res = U256(array<u32, 8>(0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u));
    for (var i: u32 = 0u; i < 8u; i = i + 1u) {
        if (a.components[i] == 0u) { continue; } // Optimisation
        var carry: u32 = 0u;
        for (var j: u32 = 0u; j < 8u - i; j = j + 1u) { // 8u - i empêche de dépasser le tableau (troncature 256b)
            let mul_res = mul_u32_to_u64(a.components[i], b.components[j]);
            
            let step1 = add_with_carry(res.components[i + j], mul_res.x, 0u);
            let step2 = add_with_carry(step1.x, carry, 0u);
            res.components[i + j] = step2.x;
            
            carry = mul_res.y + step1.y + step2.y;
        }
    }
    return res;
}

// Constante Prime de Secp256k1
const P_PRIME = U256(array<u32, 8>(
    0xFFFFFC2Fu, 0xFFFFFFFEu, 0xFFFFFFFFu, 0xFFFFFFFFu, 
    0xFFFFFFFFu, 0xFFFFFFFFu, 0xFFFFFFFFu, 0xFFFFFFFFu
));

// Additionne deux U256 avec Modulo P (spécifique à Secp256k1)
fn u256_add_mod(a: U256, b: U256) -> U256 {
    var res: U256;
    var carry: u32 = 0u;
    for (var i: u32 = 0u; i < 8u; i = i + 1u) {
        let step = add_with_carry(a.components[i], b.components[i], carry);
        res.components[i] = step.x;
        carry = step.y;
    }

    // Si l'addition dépasse 256 bits, on utilise l'astuce de congruence Secp256k1 :
    // 2^256 mod P = 0x1000003D1 (soit 2^32 + 977)
    if (carry > 0u) {
        let compensation = U256(array<u32, 8>(0x000003D1u, 1u, 0u, 0u, 0u, 0u, 0u, 0u));
        res = u256_add(res, compensation);
    }

    // Enfin, si le résultat est >= P, on soustrait P
    if (u256_gte(res, P_PRIME)) {
        res = u256_sub(res, P_PRIME);
    }
    return res;
}

// Multiplication Rapide 256x256 -> 512 bits + Réduction Modulaire Secp256k1
fn u256_mul_mod(a: U256, b: U256) -> U256 {
    var p = array<u32, 16>(0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u);
    
    // 1. Multiplication complète 256x256 (Seulement 64 itérations de mul 32bits au lieu de 256 boucles if/else)
    for (var i: u32 = 0u; i < 8u; i = i + 1u) {
        var carry: u32 = 0u;
        let ai = a.components[i];
        if (ai == 0u) { continue; } // Optimisation pour les petits multiplicateurs
        for (var j: u32 = 0u; j < 8u; j = j + 1u) {
            let mul_res = mul_u32_to_u64(ai, b.components[j]);
            let step1 = add_with_carry(p[i + j], mul_res.x, 0u);
            let step2 = add_with_carry(step1.x, carry, 0u);
            p[i + j] = step2.x;
            carry = mul_res.y + step1.y + step2.y;
        }
        p[i + 8u] = carry;
    }

    // 2. Réduction Modulaire Rapide (P = 2^256 - C, avec C = 0x1000003D1)
    let c_lo = 0x000003D1u;
    let c_hi = 0x00000001u;

    // 2a. Multiplier la partie haute de l'entier 512 bits (p[8..15]) par C -> stocké dans q
    var q = array<u32, 10>(0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u); 
    var carry: u32 = 0u;
    for (var i: u32 = 0u; i < 8u; i = i + 1u) {
        let p_h = p[i + 8u];
        let m1 = mul_u32_to_u64(p_h, c_lo);
        let s1 = add_with_carry(q[i], m1.x, carry);
        q[i] = s1.x; carry = m1.y + s1.y;

        let m2 = mul_u32_to_u64(p_h, c_hi);
        let s2 = add_with_carry(q[i + 1u], m2.x, carry);
        q[i + 1u] = s2.x; carry = m2.y + s2.y;
    }
    q[9] = carry;

    // 2b. Additionner q (p_high * C) à la partie basse (p[0..7])
    var res = U256(array<u32, 8>(0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u));
    carry = 0u;
    for (var i: u32 = 0u; i < 8u; i = i + 1u) {
        let s = add_with_carry(p[i], q[i], carry);
        res.components[i] = s.x; carry = s.y;
    }

    // Récupérer le potentiel dépassement au-delà de 256 bits
    let top0 = q[8] + carry;
    let top1 = q[9] + u32(top0 < q[8]); // u32(..) convertit le test de débordement en 0/1

    // 2c. S'il y a un débordement post-addition, on recommence une micro-réduction finale
    if (top0 > 0u || top1 > 0u) {
        var r_carry: u32 = 0u;
        let m1 = mul_u32_to_u64(top0, c_lo); var rx0 = m1.x; r_carry = m1.y;
        let m2 = mul_u32_to_u64(top0, c_hi); let s2 = add_with_carry(m2.x, 0u, r_carry); var rx1 = s2.x; r_carry = s2.y;
        let m3 = mul_u32_to_u64(top1, c_lo); let s3 = add_with_carry(rx1, m3.x, r_carry); rx1 = s3.x; r_carry = m3.y + s3.y;
        let m4 = mul_u32_to_u64(top1, c_hi); let s4 = add_with_carry(0u, m4.x, r_carry); var rx2 = s4.x; r_carry = m4.y + s4.y;

        var add_c: u32 = 0u;
        let st0 = add_with_carry(res.components[0], rx0, add_c); res.components[0] = st0.x; add_c = st0.y;
        let st1 = add_with_carry(res.components[1], rx1, add_c); res.components[1] = st1.x; add_c = st1.y;
        let st2 = add_with_carry(res.components[2], rx2, add_c); res.components[2] = st2.x; add_c = st2.y;
        let st3 = add_with_carry(res.components[3], r_carry, add_c); res.components[3] = st3.x; add_c = st3.y;

        for (var i: u32 = 4u; i < 8u; i = i + 1u) {
            let st = add_with_carry(res.components[i], 0u, add_c); res.components[i] = st.x; add_c = st.y;
        }

        if (add_c > 0u) { // Ultime compensation infinitésimale
            var final_c: u32 = 0u;
            let stf0 = add_with_carry(res.components[0], c_lo, final_c); res.components[0] = stf0.x; final_c = stf0.y;
            let stf1 = add_with_carry(res.components[1], c_hi, final_c); res.components[1] = stf1.x; final_c = stf1.y;
            for (var i: u32 = 2u; i < 8u; i = i + 1u) { let st = add_with_carry(res.components[i], 0u, final_c); res.components[i] = st.x; final_c = st.y; }
        }
    }

    // 3. S'il reste plus grand que le Prime, on le soustrait
    if (u256_gte(res, P_PRIME)) { res = u256_sub(res, P_PRIME); }
    return res;
}

// Soustraction Modulo P (évite les underflows)
fn u256_sub_mod(a: U256, b: U256) -> U256 {
    if (u256_gte(a, b)) {
        return u256_sub(a, b);
    }
    // Si a < b, le résultat est (a + P) - b. 
    // Pour éviter le dépassement de (a + P), on fait P - (b - a)
    return u256_sub(P_PRIME, u256_sub(b, a));
}

// Vérifie si un U256 est égal à zéro
fn is_zero(a: U256) -> bool {
    return (a.components[0] | a.components[1] | a.components[2] | a.components[3] |
            a.components[4] | a.components[5] | a.components[6] | a.components[7]) == 0u;
}

// Structure d'un point sur la courbe en coordonnées Jacobiennes
struct JacobianPoint {
    x: U256,
    y: U256,
    z: U256
};

// Doublage d'un point Jacobien (P = 2 * P)
fn jacobi_double(p: JacobianPoint) -> JacobianPoint {
    if (is_zero(p.z)) { return p; }

    let x_sq = u256_mul_mod(p.x, p.x);
    let y_sq = u256_mul_mod(p.y, p.y);
    let y_quad = u256_mul_mod(y_sq, y_sq);

    // M = 3 * X^2 (Car la constante 'a' = 0 pour secp256k1)
    let m = u256_add_mod(x_sq, u256_add_mod(x_sq, x_sq));

    // S = 4 * X * Y^2
    let xy2 = u256_mul_mod(p.x, y_sq);
    let s = u256_add_mod(u256_add_mod(xy2, xy2), u256_add_mod(xy2, xy2));

    // X3 = M^2 - 2*S
    let m_sq = u256_mul_mod(m, m);
    let x3 = u256_sub_mod(m_sq, u256_add_mod(s, s));

    // Y3 = M * (S - X3) - 8 * Y^4
    let s_minus_x3 = u256_sub_mod(s, x3);
    let y4_2 = u256_add_mod(y_quad, y_quad);
    let y4_4 = u256_add_mod(y4_2, y4_2);
    let y4_8 = u256_add_mod(y4_4, y4_4);
    let y3 = u256_sub_mod(u256_mul_mod(m, s_minus_x3), y4_8);

    // Z3 = 2 * Y * Z
    let yz = u256_mul_mod(p.y, p.z);
    let z3 = u256_add_mod(yz, yz);

    return JacobianPoint(x3, y3, z3);
}

// Addition de deux points en coordonnées Jacobiennes (P3 = P1 + P2)
fn jacobi_add(p1: JacobianPoint, p2: JacobianPoint) -> JacobianPoint {
    if (is_zero(p1.z)) { return p2; }
    if (is_zero(p2.z)) { return p1; }

    let z1_sq = u256_mul_mod(p1.z, p1.z);
    let z2_sq = u256_mul_mod(p2.z, p2.z);

    let u1 = u256_mul_mod(p1.x, z2_sq);
    let u2 = u256_mul_mod(p2.x, z1_sq);
    let s1 = u256_mul_mod(p1.y, u256_mul_mod(z2_sq, p2.z));
    let s2 = u256_mul_mod(p2.y, u256_mul_mod(z1_sq, p1.z));

    let h = u256_sub_mod(u2, u1);
    let r = u256_sub_mod(s2, s1);

    // Si H est zéro, les points ont le même X. S'ils ont le même Y (R=0), c'est un doublage.
    if (is_zero(h)) {
        if (is_zero(r)) { return jacobi_double(p1); } 
        else { return JacobianPoint(U256(array<u32,8>(0u,0u,0u,0u,0u,0u,0u,0u)), U256(array<u32,8>(0u,0u,0u,0u,0u,0u,0u,0u)), U256(array<u32,8>(0u,0u,0u,0u,0u,0u,0u,0u))); }
    }

    let h_sq = u256_mul_mod(h, h);
    let h_cub = u256_mul_mod(h_sq, h);
    let u1_h_sq = u256_mul_mod(u1, h_sq);

    // X3 = R^2 - H^3 - 2 * U1 * H^2
    let r_sq = u256_mul_mod(r, r);
    var x3 = u256_sub_mod(r_sq, h_cub);
    x3 = u256_sub_mod(x3, u256_add_mod(u1_h_sq, u1_h_sq));

    // Y3 = R * (U1 * H^2 - X3) - S1 * H^3
    var y3 = u256_sub_mod(u1_h_sq, x3);
    y3 = u256_mul_mod(r, y3);
    let s1_h_cub = u256_mul_mod(s1, h_cub);
    y3 = u256_sub_mod(y3, s1_h_cub);

    // Z3 = H * Z1 * Z2
    let z3 = u256_mul_mod(h, u256_mul_mod(p1.z, p2.z));

    return JacobianPoint(x3, y3, z3);
}

// Constante P-2 pour l'inversion modulaire via le petit théorème de Fermat
const P_MINUS_2 = U256(array<u32, 8>(
    0xFFFFFC2Du, 0xFFFFFFFEu, 0xFFFFFFFFu, 0xFFFFFFFFu, 
    0xFFFFFFFFu, 0xFFFFFFFFu, 0xFFFFFFFFu, 0xFFFFFFFFu
));

// Exponentiation modulaire (base^exp % P) par la méthode "exponentiation by squaring"
fn u256_pow_mod(base: U256, exp: U256) -> U256 {
    var res = U256(array<u32, 8>(1u, 0u, 0u, 0u, 0u, 0u, 0u, 0u)); // res = 1
    var temp_a = base;

    for (var i: u32 = 0u; i < 256u; i = i + 1u) {
        // Extraction du i-ème bit de l'exposant
        let bit_val = (exp.components[i / 32u] >> (i % 32u)) & 1u;
        if (bit_val == 1u) {
            res = u256_mul_mod(res, temp_a);
        }
        temp_a = u256_mul_mod(temp_a, temp_a); // Carré de la base
    }
    return res;
}

// Inverse modulaire (1/n mod P) en utilisant le petit théorème de Fermat : n^(P-2) mod P
fn u256_mod_inverse(n: U256) -> U256 {
    return u256_pow_mod(n, P_MINUS_2);
}

// Structure pour un point Affine (coordonnées réelles X, Y)
struct AffinePoint {
    x: U256,
    y: U256
};

// Convertit un point Jacobien en point Affine (la seule étape avec une "division")
fn jacobi_to_affine(p: JacobianPoint) -> AffinePoint {
    if (is_zero(p.z)) {
        // Le point à l'infini n'a pas de coordonnées affines.
        return AffinePoint(U256(array<u32,8>(0u,0u,0u,0u,0u,0u,0u,0u)), U256(array<u32,8>(0u,0u,0u,0u,0u,0u,0u,0u)));
    }

    let inv_z = u256_mod_inverse(p.z);
    let inv_z2 = u256_mul_mod(inv_z, inv_z);
    let inv_z3 = u256_mul_mod(inv_z2, inv_z);

    let affine_x = u256_mul_mod(p.x, inv_z2);
    let affine_y = u256_mul_mod(p.y, inv_z3);

    return AffinePoint(affine_x, affine_y);
}

// --- Point Multiplication ---
// Addition d'un point Jacobien et d'un point Affine (Optimisation : Z2 = 1)
fn jacobi_add_affine(p1: JacobianPoint, p2: AffinePoint) -> JacobianPoint {
    if (is_zero(p1.z)) { 
        return JacobianPoint(p2.x, p2.y, U256(array<u32,8>(1u,0u,0u,0u,0u,0u,0u,0u))); 
    }

    let z1_sq = u256_mul_mod(p1.z, p1.z);
    let u1 = p1.x; // p1.x * z2_sq (or z2=1)
    let u2 = u256_mul_mod(p2.x, z1_sq);
    let s1 = p1.y; // p1.y * z2_cub (or z2=1)
    let s2 = u256_mul_mod(p2.y, u256_mul_mod(z1_sq, p1.z));

    let h = u256_sub_mod(u2, u1);
    let r = u256_sub_mod(s2, s1);

    if (is_zero(h)) {
        if (is_zero(r)) { return jacobi_double(p1); } 
        else { return JacobianPoint(U256(array<u32,8>(0u,0u,0u,0u,0u,0u,0u,0u)), U256(array<u32,8>(0u,0u,0u,0u,0u,0u,0u,0u)), U256(array<u32,8>(0u,0u,0u,0u,0u,0u,0u,0u))); }
    }

    let h_sq = u256_mul_mod(h, h);
    let h_cub = u256_mul_mod(h_sq, h);
    let u1_h_sq = u256_mul_mod(u1, h_sq);

    let r_sq = u256_mul_mod(r, r);
    var x3 = u256_sub_mod(r_sq, h_cub);
    x3 = u256_sub_mod(x3, u256_add_mod(u1_h_sq, u1_h_sq));

    var y3 = u256_sub_mod(u1_h_sq, x3);
    y3 = u256_mul_mod(r, y3);
    let s1_h_cub = u256_mul_mod(s1, h_cub);
    y3 = u256_sub_mod(y3, s1_h_cub);

    let z3 = u256_mul_mod(h, p1.z); // h * z1 * z2 (or z2=1)
    return JacobianPoint(x3, y3, z3);
}

// --- HASHING ---
const SHA256_K = array<u32, 64>(
    0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u, 0x3956c25bu, 0x59f111f1u, 0x923f82a4u, 0xab1c5ed5u,
    0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u, 0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u,
    0xe49b69c1u, 0xefbe4786u, 0x0fc19dc6u, 0x240ca1ccu, 0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau,
    0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u, 0xc6e00bf3u, 0xd5a79147u, 0x06ca6351u, 0x14292967u,
    0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u, 0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u,
    0xa2bfe8a1u, 0xa81a664bu, 0xc24b8b70u, 0xc76c51a3u, 0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u,
    0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u, 0x391c0cb3u, 0x4ed8aa4au, 0x5b9cca4fu, 0x682e6ff3u,
    0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u, 0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u
);

// Rotation binaire vers la droite
fn sha256_rotr(x: u32, n: u32) -> u32 {
    return (x >> n) | (x << (32u - n));
}

// Calcule le SHA-256 spécifique pour une clé publique compressée (1 byte prefix + 32 bytes X)
fn sha256_33bytes(prefix: u32, x: U256) -> array<u32, 8> {
    var w: array<u32, 16>; // Fenêtre glissante de 16 mots (réduit la pression sur les registres)
    
    // Emballage (Packing) magique des 33 octets en Big-Endian + Padding automatique !
    w[0] = (prefix << 24u) | (x.components[7] >> 8u);
    w[1] = (x.components[7] << 24u) | (x.components[6] >> 8u);
    w[2] = (x.components[6] << 24u) | (x.components[5] >> 8u);
    w[3] = (x.components[5] << 24u) | (x.components[4] >> 8u);
    w[4] = (x.components[4] << 24u) | (x.components[3] >> 8u);
    w[5] = (x.components[3] << 24u) | (x.components[2] >> 8u);
    w[6] = (x.components[2] << 24u) | (x.components[1] >> 8u);
    w[7] = (x.components[1] << 24u) | (x.components[0] >> 8u);
    w[8] = (x.components[0] << 24u) | 0x00800000u; // 0x80 = le bit '1' du padding
    w[15] = 264u; // Longueur du message en bits (33 bytes * 8 = 264 bits)

    // Valeurs de hachage initiales
    var a = 0x6a09e667u; var b = 0xbb67ae85u; var c = 0x3c6ef372u; var d = 0xa54ff53au;
    var e = 0x510e527fu; var f = 0x9b05688cu; var g = 0x1f83d9abu; var h = 0x5be0cd19u;

    // Boucle de compression fusionnée avec l'extension du message
    for (var i = 0u; i < 64u; i = i + 1u) {
        var wi: u32;
        if (i < 16u) {
            wi = w[i];
        } else {
            // Utilisation du bitwise AND (& 15u) comme modulo ultra-rapide
            let w15 = w[(i - 15u) & 15u];
            let w2  = w[(i - 2u) & 15u];
            let s0 = sha256_rotr(w15, 7u) ^ sha256_rotr(w15, 18u) ^ (w15 >> 3u);
            let s1 = sha256_rotr(w2, 17u) ^ sha256_rotr(w2, 19u) ^ (w2 >> 10u);
            
            wi = w[(i - 16u) & 15u] + s0 + w[(i - 7u) & 15u] + s1;
            w[i & 15u] = wi; // Mise à jour de la fenêtre glissante
        }

        let S1 = sha256_rotr(e, 6u) ^ sha256_rotr(e, 11u) ^ sha256_rotr(e, 25u);
        let ch = (e & f) ^ (~e & g);
        let temp1 = h + S1 + ch + SHA256_K[i] + wi;
        
        let S0 = sha256_rotr(a, 2u) ^ sha256_rotr(a, 13u) ^ sha256_rotr(a, 22u);
        let maj = (a & b) ^ (a & c) ^ (b & c);
        let temp2 = S0 + maj;

        h = g; g = f; f = e; e = d + temp1;
        d = c; c = b; b = a; a = temp1 + temp2;
    }

    return array<u32, 8>(
        a + 0x6a09e667u, b + 0xbb67ae85u, c + 0x3c6ef372u, d + 0xa54ff53au,
        e + 0x510e527fu, f + 0x9b05688cu, g + 0x1f83d9abu, h + 0x5be0cd19u
    );
}

// --- RIPEMD-160 CONSTANTES ---
const RMD_R = array<u32, 80>(
    0u, 1u, 2u, 3u, 4u, 5u, 6u, 7u, 8u, 9u, 10u, 11u, 12u, 13u, 14u, 15u,
    7u, 4u, 13u, 1u, 10u, 6u, 15u, 3u, 12u, 0u, 9u, 5u, 2u, 14u, 11u, 8u,
    3u, 10u, 14u, 4u, 9u, 15u, 8u, 1u, 2u, 7u, 0u, 6u, 13u, 11u, 5u, 12u,
    1u, 9u, 11u, 10u, 0u, 8u, 12u, 4u, 13u, 3u, 7u, 15u, 14u, 5u, 6u, 2u,
    4u, 0u, 5u, 9u, 7u, 12u, 2u, 10u, 14u, 1u, 3u, 8u, 11u, 6u, 15u, 13u
);

const RMD_RR = array<u32, 80>(
    5u, 14u, 7u, 0u, 9u, 2u, 11u, 4u, 13u, 6u, 15u, 8u, 1u, 10u, 3u, 12u,
    6u, 11u, 3u, 7u, 0u, 13u, 5u, 10u, 14u, 15u, 8u, 12u, 4u, 9u, 1u, 2u,
    15u, 5u, 1u, 3u, 7u, 14u, 6u, 9u, 11u, 8u, 12u, 2u, 10u, 0u, 4u, 13u,
    8u, 6u, 4u, 1u, 3u, 11u, 15u, 0u, 5u, 12u, 2u, 13u, 9u, 7u, 10u, 14u,
    12u, 15u, 10u, 4u, 1u, 5u, 8u, 7u, 6u, 2u, 13u, 14u, 0u, 3u, 9u, 11u
);

const RMD_S = array<u32, 80>(
    11u, 14u, 15u, 12u, 5u, 8u, 7u, 9u, 11u, 13u, 14u, 15u, 6u, 7u, 9u, 8u,
    7u, 6u, 8u, 13u, 11u, 9u, 7u, 15u, 7u, 12u, 15u, 9u, 11u, 7u, 13u, 12u,
    11u, 13u, 6u, 7u, 14u, 9u, 13u, 15u, 14u, 8u, 13u, 6u, 5u, 12u, 7u, 5u,
    11u, 12u, 14u, 15u, 14u, 15u, 9u, 8u, 9u, 14u, 5u, 6u, 8u, 6u, 5u, 12u,
    9u, 15u, 5u, 11u, 6u, 8u, 13u, 12u, 5u, 12u, 13u, 14u, 11u, 8u, 5u, 6u
);

const RMD_SS = array<u32, 80>(
    8u, 9u, 9u, 11u, 13u, 15u, 15u, 5u, 7u, 7u, 8u, 11u, 14u, 14u, 12u, 6u,
    9u, 13u, 15u, 7u, 12u, 8u, 9u, 11u, 7u, 7u, 12u, 7u, 6u, 15u, 13u, 11u,
    9u, 7u, 15u, 11u, 8u, 6u, 6u, 14u, 12u, 13u, 5u, 14u, 13u, 13u, 7u, 5u,
    15u, 5u, 8u, 11u, 14u, 14u, 6u, 14u, 6u, 9u, 12u, 9u, 12u, 5u, 15u, 8u,
    8u, 5u, 12u, 9u, 12u, 5u, 14u, 6u, 8u, 13u, 6u, 5u, 15u, 13u, 11u, 11u
);

const RMD_K_LEFT = array<u32, 5>(
    0x00000000u, 0x5a827999u, 0x6ed9eba1u, 0x8f1bbcdcu, 0xa953fd4eu
);

const RMD_K_RIGHT = array<u32, 5>(
    0x50a28be6u, 0x5c4dd124u, 0x6d703ef3u, 0x7a6d76e9u, 0x00000000u
);

// Rotation gauche pour RIPEMD-160
fn ripemd160_rotl(x: u32, n: u32) -> u32 { return (x << n) | (x >> (32u - n)); }

// Permutation des octets (Big-Endian <-> Little-Endian)
fn bswap32(x: u32) -> u32 {
    return ((x & 0xFFu) << 24u) | ((x & 0xFF00u) << 8u) | ((x >> 8u) & 0xFF00u) | (x >> 24u);
}

// Fonctions logiques non-linéaires F
fn ripemd160_f(rnd: u32, x: u32, y: u32, z: u32) -> u32 {
    switch rnd {
        case 0u: { return x ^ y ^ z; }
        case 1u: { return (x & y) | (~x & z); }
        case 2u: { return (x | ~y) ^ z; }
        case 3u: { return (x & z) | (y & ~z); }
        default: { return x ^ (y | ~z); } // case 4
    }
}

// Prend un hash SHA256 (8 u32) et retourne un hash RIPEMD160 (5 u32)
fn ripemd160_hash(data: array<u32, 8>) -> array<u32, 5> {
    var w: array<u32, 16>; // Initialisé à 0 par défaut
    
    // Conversion du SHA256 (Big Endian) vers RIPEMD-160 (Little Endian)
    for (var i = 0u; i < 8u; i = i + 1u) { w[i] = bswap32(data[i]); }
    
    w[8] = 0x00000080u; // Bit '1' de padding
    w[14] = 256u;       // Longueur du message en bits (32 octets * 8)

    var a = 0x67452301u; var b = 0xEFCDAB89u; var c = 0x98BADCFEu; var d = 0x10325476u; var e = 0xC3D2E1F0u;
    var aa = 0x67452301u; var bb = 0xEFCDAB89u; var cc = 0x98BADCFEu; var dd = 0x10325476u; var ee = 0xC3D2E1F0u;

    for (var j = 0u; j < 80u; j = j + 1u) {
        let rnd = j / 16u;

        let T1 = a + ripemd160_f(rnd, b, c, d) + w[RMD_R[j]] + RMD_K_LEFT[rnd];
        a = e; e = d; d = ripemd160_rotl(c, 10u); c = b; b = ripemd160_rotl(T1, RMD_S[j]) + a;

        let T2 = aa + ripemd160_f(4u - rnd, bb, cc, dd) + w[RMD_RR[j]] + RMD_K_RIGHT[rnd];
        aa = ee; ee = dd; dd = ripemd160_rotl(cc, 10u); cc = bb; bb = ripemd160_rotl(T2, RMD_SS[j]) + aa;
    }

    return array<u32, 5>(
        0xEFCDAB89u + c + dd, 0x98BADCFEu + d + ee, 0x10325476u + e + aa,
        0xC3D2E1F0u + a + bb, 0x67452301u + b + cc
    );
}

// --- BUFFERS & MAIN ---
// Buffer pour communiquer le résultat (l'index du thread gagnant)
struct ResultBuffer {
    found: u32,
    winning_index: u32
};

// Données globales pour la recherche (clé de base, hash cible)
struct Globals {
    base_point_x: U256,
    base_point_y: U256,
    target_hash: array<u32, 5> // Hash160 de l'adresse cible
};

@group(0) @binding(0) var<storage, read_write> result : ResultBuffer;
@group(0) @binding(1) var<storage, read> globals: Globals;
@group(0) @binding(2) var<storage, read> g_table: array<AffinePoint, 1024>; // 4 fenêtres de 256 points

const BATCH_SIZE = 8u; // Nombre de clés traitées par thread

// Calcule un point Jacobien pour un offset donné
fn get_jacobian_point(thread_id: u32) -> JacobianPoint {
    var current_point = JacobianPoint(
        globals.base_point_x,
        globals.base_point_y,
        U256(array<u32, 8>(1u, 0u, 0u, 0u, 0u, 0u, 0u, 0u)) // Z=1
    );

    let b0 = thread_id & 0xFFu;
    if (b0 != 0u) { current_point = jacobi_add_affine(current_point, g_table[b0]); }
    let b1 = (thread_id >> 8u) & 0xFFu;
    if (b1 != 0u) { current_point = jacobi_add_affine(current_point, g_table[256u + b1]); }
    let b2 = (thread_id >> 16u) & 0xFFu;
    if (b2 != 0u) { current_point = jacobi_add_affine(current_point, g_table[512u + b2]); }
    let b3 = (thread_id >> 24u) & 0xFFu;
    if (b3 != 0u) { current_point = jacobi_add_affine(current_point, g_table[768u + b3]); }

    return current_point;
}

// Boucle de travail utilisant le Montgomery Batch Inversion
fn do_crypto_work_batched(base_thread_id: u32) {
    var points: array<JacobianPoint, BATCH_SIZE>;
    var scratch: array<U256, BATCH_SIZE>;
    
    // 1. Calcul de tous les points et produits cumulés (prefix products)
    for (var i = 0u; i < BATCH_SIZE; i = i + 1u) {
        points[i] = get_jacobian_point(base_thread_id + i);
        if (i == 0u) {
            scratch[0] = points[i].z;
        } else {
            scratch[i] = u256_mul_mod(scratch[i - 1u], points[i].z);
        }
    }

    // 2. Inversion modulaire unique du produit total
    var inv = u256_mod_inverse(scratch[BATCH_SIZE - 1u]);
    var inverses: array<U256, BATCH_SIZE>;
    
    var i = BATCH_SIZE - 1u;
    loop {
        if (i == 0u) {
            inverses[0] = inv;
            break;
        }
        inverses[i] = u256_mul_mod(scratch[i - 1u], inv);
        inv = u256_mul_mod(inv, points[i].z);
        i = i - 1u;
    }

    // 3. Conversion en Affine et hachage
    for (var j = 0u; j < BATCH_SIZE; j = j + 1u) {
        let p = points[j];
        let inv_z = inverses[j];
        
        if (is_zero(p.z)) { continue; }
        
        let inv_z2 = u256_mul_mod(inv_z, inv_z);
        let inv_z3 = u256_mul_mod(inv_z2, inv_z);
        let affine_x = u256_mul_mod(p.x, inv_z2);
        let affine_y = u256_mul_mod(p.y, inv_z3);
        
        let y_even = (affine_y.components[0] & 1u) == 0u;
        let prefix = select(0x03u, 0x02u, y_even);
        let sha_result = sha256_33bytes(prefix, affine_x);
        let final_hash = ripemd160_hash(sha_result);
        
        var is_match = true;
        for (var k = 0u; k < 5u; k = k + 1u) {
            if (final_hash[k] != globals.target_hash[k]) {
                is_match = false;
                break;
            }
        }
        
        if (is_match) {
            result.found = 1u;
            result.winning_index = base_thread_id + j;
        }
    }
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {
    // Chaque thread traite BATCH_SIZE clés
    let base_id = global_id.x * BATCH_SIZE;

    // Évite d'écraser un résultat si un autre thread a déjà trouvé
    if (result.found == 1u) {
        return;
    }

    do_crypto_work_batched(base_id);
}
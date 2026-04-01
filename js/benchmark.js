import { modInverse, addPoints, multiply, P, N, Gx, Gy, sha256, ripemd160 } from './crypto.js';

let benchWorker = null;
let benchGpuRunning = false;
let cachedShaderCode = null;
let activeGpuBenchDevice = null;

export function runBenchmark() {
    const btn = document.getElementById('startBenchBtn');
    const btnGpu = document.getElementById('startBenchGpuBtn');
    btn.disabled = true;
    if (btnGpu) btnGpu.disabled = true;

    const benchWorkerCode = `
        const P = ${P}n;
        const N = ${N}n;
        const Gx = ${Gx}n;
        const Gy = ${Gy}n;
        ${modInverse.toString()}
        ${addPoints.toString()}
        ${multiply.toString()}
        ${sha256.toString()}
        ${ripemd160.toString()}

        const hashBytes = new Uint8Array(32);
        const hexToBytes = (hex) => {
            for (let i = 0; i < 32; i++) {
                hashBytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
            }
            return hashBytes;
        };

        onmessage = (e) => {
            let { s, step, isR } = e.data;
            let k = BigInt(s);
            const st = BigInt(step);
            let c = 0;
            const end = Date.now() + 15000; // Benchmark de 15 secondes
            
            if (isR) {
                while (Date.now() < end) {
                    k = (k * 6364136223846793005n + 1n) % N;
                    let p = multiply(k || 1n);
                    if (p) {
                        const x = p.x.toString(16).padStart(64, "0");
                        const y_pref = p.y % 2n == 0n ? "02" : "03";
                        ripemd160(hexToBytes(sha256(y_pref + x)));
                    }
                    c++;
                    if (c % 500 === 0) postMessage({ c: c, d: false });
                }
                postMessage({ c: c, d: true });
                return;
            }

            // --- Benchmark séquentiel par lots (Batch Inversion) ---
            const BATCH_SIZE = 64;
            const stepPoint = multiply(st) || { x: Gx, y: Gy };
            
            let points = new Array(BATCH_SIZE);
            for (let i = 0; i < BATCH_SIZE; i++) {
                points[i] = multiply(k + BigInt(i) * st);
            }

            const dx = new Array(BATCH_SIZE);
            const inv = new Array(BATCH_SIZE);
            const skipAdd = new Array(BATCH_SIZE);

            while (Date.now() < end) {
                // Hashing pour simuler la vraie charge CPU
                for(let i = 0; i < BATCH_SIZE; i++) {
                    let p = points[i];
                    if (!p) continue;
                    const x = p.x.toString(16).padStart(64, "0");
                    const y_pref = p.y % 2n == 0n ? "02" : "03";
                    ripemd160(hexToBytes(sha256(y_pref + x)));
                }

                let product = 1n;
                for (let i = 0; i < BATCH_SIZE; i++) {
                    skipAdd[i] = false;
                    if (!points[i]) { 
                        dx[i] = 1n; 
                        inv[i] = product; 
                        skipAdd[i] = true;
                        continue; 
                    }
                    let d = (stepPoint.x - points[i].x) % P;
                    if (d < 0n) d += P;
                    
                    if (d === 0n) {
                        points[i] = multiply(k + BigInt(c + i + BATCH_SIZE) * st);
                        dx[i] = 1n;
                        inv[i] = product;
                        skipAdd[i] = true;
                        continue;
                    }

                    dx[i] = d;
                    inv[i] = product;
                    product = (product * d) % P;
                }

                let productInv = modInverse(product, P);

                for (let i = BATCH_SIZE - 1; i >= 0; i--) {
                    let prevProduct = inv[i];
                    inv[i] = (productInv * prevProduct) % P;
                    productInv = (productInv * dx[i]) % P;
                }

                for (let i = 0; i < BATCH_SIZE; i++) {
                    if (skipAdd[i]) continue;
                    
                    let lam = ((stepPoint.y - points[i].y + P) * inv[i]) % P;
                    let x3 = (lam * lam - points[i].x - stepPoint.x) % P;
                    if (x3 < 0n) x3 += P;
                    let y3 = (lam * (points[i].x - x3) - points[i].y) % P;
                    if (y3 < 0n) y3 += P;
                    
                    points[i].x = x3;
                    points[i].y = y3;
                }

                c += BATCH_SIZE;
                if (c % 1024 === 0) postMessage({ c: c, d: false });
            }
            postMessage({ c: c, d: true });
        };
    `;
    const blob = new Blob([benchWorkerCode], { type: 'application/javascript' });
    benchWorker = new Worker(URL.createObjectURL(blob));
    
    const startTime = Date.now();
    benchWorker.onmessage = (m) => {
        const elapsedTime = (Date.now() - startTime) / 1000;
        document.getElementById('keysCount').innerText = m.data.c.toLocaleString();
        document.getElementById('keysSpeed').innerText = Math.floor(m.data.c / elapsedTime).toLocaleString() + " (CPU)";
        if (m.data.d) {
            btn.disabled = false;
            if (benchWorker) {
                benchWorker.terminate();
                benchWorker = null;
            }
        }
    };
    benchWorker.postMessage({
        s: '0x' + document.getElementById('benchStartKey').value,
        step: document.getElementById('benchStep').value,
        isR: document.getElementById('benchRandom').checked
    });
}

export async function runGpuBenchmark() {
    if (!navigator.gpu) {
        alert("WebGPU n'est pas supporté par votre navigateur.");
        return;
    }

    const btnCpu = document.getElementById('startBenchBtn');
    const btnGpu = document.getElementById('startBenchGpuBtn');
    const countEl = document.getElementById('keysCount');
    const speedEl = document.getElementById('keysSpeed');

    btnCpu.disabled = true;
    if (btnGpu) btnGpu.disabled = true;
    benchGpuRunning = true;
    
    countEl.innerText = "Initialisation...";
    speedEl.innerText = "...";

    try {
        const adapter = await navigator.gpu.requestAdapter();
        const device = await adapter.requestDevice();
        activeGpuBenchDevice = device;

        // Récupération du même shader que la recherche
        if (!cachedShaderCode) {
            const response = await fetch('js/gpu/kernel.wgsl');
            if (!response.ok) throw new Error("Shader introuvable");
            cachedShaderCode = await response.text();
        }

        const workgroupSize = Math.min(64, device.limits.maxComputeInvocationsPerWorkgroup);
        const shaderCode = cachedShaderCode.replace('WORKGROUP_SIZE', workgroupSize.toString());
        const module = device.createShaderModule({ code: shaderCode });

        const pipeline = await device.createComputePipelineAsync({
            layout: 'auto',
            compute: { module, entryPoint: 'main' }
        });

        // Buffers factices pour le benchmark
        const targetHashU32 = new Uint32Array(5);
        const rBuf = device.createBuffer({ size: 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
        const gBuf = device.createBuffer({ size: 84, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(gBuf, 64, targetHashU32, 0, 5);

        // Table de points factices (remplie de 1 pour éviter les optimisations du GPU sur les multiplications par zéro)
        const gTableU32 = new Uint32Array(1024 * 16).fill(1);
        const gTableBuffer = device.createBuffer({ size: 1024 * 16 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(gTableBuffer, 0, gTableU32);

        const bg = device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: rBuf } },
                { binding: 1, resource: { buffer: gBuf } },
                { binding: 2, resource: { buffer: gTableBuffer } }
            ]
        });

        // Configuration de la charge de travail
        const workgroupCount = Math.min(8192, device.limits.maxComputeWorkgroupsPerDimension);
        const BATCH_SIZE = 8; // Défini en dur dans le shader WGSL
        const keysPerPass = workgroupCount * workgroupSize * BATCH_SIZE;
        
        let totalKeys = 0;
        const startTime = Date.now();
        const durationMs = 15000; // Benchmark de 15 secondes
        let lastDomUpdateTime = Date.now();
        
        countEl.innerText = "0";

        async function benchPass() {
            if (!benchGpuRunning) return;

            const commandEncoder = device.createCommandEncoder();
            const passEncoder = commandEncoder.beginComputePass();
            passEncoder.setPipeline(pipeline);
            passEncoder.setBindGroup(0, bg);
            passEncoder.dispatchWorkgroups(workgroupCount);
            passEncoder.end();
            
            device.queue.submit([commandEncoder.finish()]);
            
            // Attente stricte pour mesurer la vraie vitesse de la carte graphique
            await device.queue.onSubmittedWorkDone();
            
            if (!benchGpuRunning) return; // Sécurité si STOP a été cliqué pendant l'attente

            totalKeys += keysPerPass;
            const now = Date.now();
            const elapsed = (now - startTime) / 1000;
            
            if (elapsed * 1000 >= durationMs) {
                countEl.innerText = totalKeys.toLocaleString();
                speedEl.innerText = Math.floor(totalKeys / elapsed).toLocaleString() + " (GPU)";
                stopBenchmark();
                return;
            }
            
            if (now - lastDomUpdateTime >= 200) {
                countEl.innerText = totalKeys.toLocaleString();
                speedEl.innerText = Math.floor(totalKeys / elapsed).toLocaleString() + " (GPU)";
                lastDomUpdateTime = now;
                setTimeout(benchPass, 0);
            } else {
                benchPass();
            }
        }

        benchPass();

    } catch (e) {
        console.error("Erreur Benchmark GPU:", e);
        countEl.innerText = "Erreur WebGPU";
        stopBenchmark();
    }
}

export function stopBenchmark() {
    if (benchWorker) {
        benchWorker.terminate();
        benchWorker = null;
    }
    benchGpuRunning = false;
    if (activeGpuBenchDevice) {
        try { activeGpuBenchDevice.destroy(); } catch(e) {}
        activeGpuBenchDevice = null;
    }
    document.getElementById('startBenchBtn').disabled = false;
    const btnGpu = document.getElementById('startBenchGpuBtn');
    if (btnGpu) btnGpu.disabled = false;
}
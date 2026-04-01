import { modInverse, addPoints, multiply, sha256, ripemd160, ALPH, P, N, Gx, Gy } from './crypto.js';
import { saveResult, saveGpuState, clearGpuState } from './storage.js';
import { formatTime } from './utils.js';
import { getPuzzleData } from './ui.js';

// --- Worker State ---
let activeWorkers = { search: [], puzzle: [] };
let workerBlobUrl = null;
let gpuProgress = { search: null, puzzle: null };
let cachedShaderCode = null;

// --- CPU Search ---

function createCpuWorkerBlob() {
    if (workerBlobUrl) return workerBlobUrl;

    const workerCode = `
        const P = ${P}n;
        const N = ${N}n;
        const Gx = ${Gx}n;
        const Gy = ${Gy}n;
        ${modInverse.toString()}
        ${addPoints.toString()}
        ${multiply.toString()}
        ${ripemd160.toString()}
        ${sha256.toString()}
        
        const hashBytes = new Uint8Array(32);
        const hexToBytes = (hex) => {
            for (let i = 0; i < 32; i++) {
                hashBytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
            }
            return hashBytes;
        };

        onmessage = e => {
            const { s, e: end, t } = e.data;
            let kStart = BigInt(s);
            const kEnd = BigInt(end);
            let totalKeys = kEnd - kStart + 1n;
            let c = 0;

            const BATCH_SIZE = 64; // Accélération par lots CPU
            
            // Si la plage est trop petite, on fait la méthode classique
            if (totalKeys < BigInt(BATCH_SIZE)) {
                let k = kStart;
                let p = multiply(k);
                const G = { x: Gx, y: Gy };
                for (; k <= kEnd;) {
                    if (p) {
                        const x = p.x.toString(16).padStart(64, "0");
                        const y_pref = p.y % 2n == 0n ? "02" : "03";
                        const sh = sha256(y_pref + x);
                        const rh = ripemd160(hexToBytes(sh));
                        if (rh === t) {
                            postMessage({ found: true, key: k.toString(16) });
                            return;
                        }
                        p = addPoints(p, G);
                    } else {
                        p = multiply(k + 1n);
                    }
                    k++;
                    c++;
                    if (c >= 1000) {
                        postMessage({ found: false, count: c, currentLowest: k.toString(16) });
                        c = 0;
                    }
                }
                postMessage({ found: false, done: true, count: c });
                return;
            }

            // --- Méthode par LOT (BATCH) avec Inversion de Montgomery ---
            // On divise la charge de ce worker en sous-pistes parallèles
            const subRange = totalKeys / BigInt(BATCH_SIZE);
            let points = new Array(BATCH_SIZE);
            let keys = new Array(BATCH_SIZE);
            
            for(let i = 0; i < BATCH_SIZE; i++) {
                keys[i] = kStart + BigInt(i) * subRange;
                points[i] = multiply(keys[i]);
            }

            const dx = new Array(BATCH_SIZE);
            const inv = new Array(BATCH_SIZE);
            const skipAdd = new Array(BATCH_SIZE);
            
            // On s'arrête quand la première piste rejoint le début de la deuxième
            const limit = kStart + subRange;

            while (keys[0] < limit) {
                // 1. Vérification des hashs
                for(let i = 0; i < BATCH_SIZE; i++) {
                    let p = points[i];
                    if (!p) continue;
                    const x = p.x.toString(16).padStart(64, "0");
                    const y_pref = p.y % 2n == 0n ? "02" : "03";
                    const sh = sha256(y_pref + x);
                    const rh = ripemd160(hexToBytes(sh));
                    if (rh === t) {
                        postMessage({ found: true, key: keys[i].toString(16) });
                        return;
                    }
                }

                // 2. Inversion de Montgomery par lot (Batch Inversion)
                // Évite de faire 64 divisions modulaires (très lentes) en n'en faisant qu'une seule !
                let product = 1n;
                for (let i = 0; i < BATCH_SIZE; i++) {
                    skipAdd[i] = false;
                    if (!points[i]) { 
                        dx[i] = 1n; 
                        inv[i] = product; 
                        skipAdd[i] = true;
                        continue; 
                    }
                    let d = (Gx - points[i].x) % P;
                    if (d < 0n) d += P;
                    
                    // Protection contre l'addition sur Gx lui-même (k=1)
                    if (d === 0n) {
                        points[i] = multiply(keys[i] + 1n);
                        keys[i]++;
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

                // 3. Application de l'addition de point pour chaque piste
                for (let i = 0; i < BATCH_SIZE; i++) {
                    if (skipAdd[i]) {
                        if (!points[i]) {
                            points[i] = { x: Gx, y: Gy };
                            keys[i]++;
                        }
                        continue;
                    }
                    
                    let lam = ((Gy - points[i].y + P) * inv[i]) % P;
                    let x3 = (lam * lam - points[i].x - Gx) % P;
                    if (x3 < 0n) x3 += P;
                    let y3 = (lam * (points[i].x - x3) - points[i].y) % P;
                    if (y3 < 0n) y3 += P;
                    
                    points[i].x = x3;
                    points[i].y = y3;
                    keys[i]++;
                }

                c += BATCH_SIZE;
                if (c >= 1000) {
                    postMessage({ found: false, count: c, currentLowest: keys[0].toString(16) });
                    c = 0;
                }
            }

            // Si la division par BATCH_SIZE n'est pas parfaite, 
            // on vérifie les quelques clés restantes à la fin
            let remainingStart = kStart + subRange * BigInt(BATCH_SIZE);
            if (remainingStart <= kEnd) {
                let k = remainingStart;
                let p = multiply(k);
                const G = { x: Gx, y: Gy };
                for (; k <= kEnd;) {
                    if (p) {
                        const x = p.x.toString(16).padStart(64, "0");
                        const y_pref = p.y % 2n == 0n ? "02" : "03";
                        const sh = sha256(y_pref + x);
                        const rh = ripemd160(hexToBytes(sh));
                        if (rh === t) {
                            postMessage({ found: true, key: k.toString(16) });
                            return;
                        }
                        p = addPoints(p, G);
                    } else {
                        p = multiply(k + 1n);
                    }
                    k++;
                    c++;
                    if (c >= 100) {
                        postMessage({ found: false, count: c, currentLowest: k.toString(16) });
                        c = 0;
                    }
                }
            }

            postMessage({ found: false, done: true, count: c });
        };
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    workerBlobUrl = URL.createObjectURL(blob);
    return workerBlobUrl;
}

export function runSearch(type) {
    let target, start, end, bit = null;
    if (type === 'puzzle') {
        const idx = document.getElementById('puzzleSelect').value;
        const data = getPuzzleData(idx);
        target = data.address;
        start = document.getElementById('puzzleStart').value.trim();
        end = document.getElementById('puzzleEnd').value.trim();
        bit = data.bit;
    } else {
        target = document.getElementById('targetAddr').value.trim();
        start = document.getElementById('searchStart').value.trim();
        end = document.getElementById('searchEnd').value.trim();
    }

    if (!target) return alert("Cible manquante");
    if (!start || !end) return alert("Plage de recherche invalide");

    let n = 0n;
    for (let c of target) {
        const index = ALPH.indexOf(c);
        if (index < 0) return alert(`Caractère invalide dans l'adresse: ${c}`);
        n = n * 58n + BigInt(index);
    }
    let leadingZeros = 0;
    for (let c of target) { if (c === '1') leadingZeros++; else break; }
    const fullHex = '00'.repeat(leadingZeros) + n.toString(16).padStart(50 - leadingZeros * 2, '0');
    const targetHash160 = fullHex.substring(2, 42);

    const btn = document.getElementById(type === 'puzzle' ? 'startPuzzleCpuBtn' : 'startSearchCpuBtn');
    const statusEl = document.getElementById(`${type}Status`);
    const progressBar = document.getElementById(`${type}ProgressBar`);
    const etaEl = document.getElementById(`${type}ETA`);
    const threadsInfoEl = document.getElementById(`${type}ThreadsInfo`);

    btn.disabled = true;
    document.getElementById(`${type}Result`).style.display = "none";
    statusEl.innerText = "Calcul en cours...";
    progressBar.style.width = '0%';
    etaEl.innerText = '';
    progressBar.style.background = type === 'puzzle' ? 'var(--accent)' : 'var(--green)';
    threadsInfoEl.innerHTML = '';

    const blobUrl = createCpuWorkerBlob();
    const startKey = BigInt('0x' + start);
    const endKey = BigInt('0x' + end);
    const totalKeys = endKey - startKey + 1n;
    const numWorkers = parseInt(document.getElementById(`${type}Threads`).value, 10) || 1;
    const rangePerWorker = totalKeys / BigInt(numWorkers);

    let totalKeysChecked = 0n;
    let finishedWorkers = 0;
    const startTime = Date.now();

    // Variables pour la sauvegarde automatique (Auto-save)
    let lastAutoSaveTime = Date.now();
    const AUTO_SAVE_INTERVAL_MS = 10000; // Sauvegarde toutes les 10 secondes
    let autoSaveIndicatorTime = 0;

    activeWorkers[type] = [];

    for (let i = 0; i < numWorkers; i++) {
        const worker = new Worker(blobUrl);
        
        // Définition de la plage avant l'assignation au worker pour la sauvegarde
        const workerStart = startKey + (BigInt(i) * rangePerWorker);
        const workerEnd = (i === numWorkers - 1) ? endKey : workerStart + rangePerWorker - 1n;
        
        worker.workerStart = workerStart;
        worker.keysChecked = 0n;
        worker.isDone = false;

        activeWorkers[type].push(worker);

        worker.onmessage = (m) => {
            if (m.data.found) {
                const elapsedTime = (Date.now() - startTime) / 1000;
                const formattedTime = formatTime(elapsedTime);
                document.getElementById(`${type}FoundKey`).innerText = m.data.key.padStart(64, '0');
                document.getElementById(`${type}Result`).style.display = "block";
                progressBar.style.width = '100%';
                progressBar.style.background = 'var(--green)';
                statusEl.innerText = `TROUVÉ en ${formattedTime} !`;
                etaEl.innerText = 'Terminé !';
                saveResult(m.data.key.padStart(64, '0'), target, bit, formattedTime);
                stopWorker(type);
                return;
            }

            worker.keysChecked += BigInt(m.data.count);
            totalKeysChecked += BigInt(m.data.count);
            
            // Pour la sauvegarde auto, on enregistre la vraie position basse du thread
            if (m.data.currentLowest) {
                worker.currentBaseKey = BigInt('0x' + m.data.currentLowest);
            } else {
                worker.currentBaseKey = worker.workerStart + worker.keysChecked;
            }

            if (activeWorkers[type].length > 0) {
                // --- Sauvegarde Automatique (Auto-save) ---
                if (Date.now() - lastAutoSaveTime > AUTO_SAVE_INTERVAL_MS) {
                    let currentBaseKey = endKey;
                    for (let w of activeWorkers[type]) {
                        if (!w.isDone) {
                            let wBase = w.currentBaseKey || (w.workerStart + w.keysChecked);
                            if (wBase < currentBaseKey) currentBaseKey = wBase;
                        }
                    }
                    if (currentBaseKey === endKey) currentBaseKey = startKey;
                    saveGpuState(type, currentBaseKey, end); // On réutilise le système de sauvegarde existant
                    lastAutoSaveTime = Date.now();
                    autoSaveIndicatorTime = Date.now() + 1000; // Affiche l'indicateur pendant 1 sec
                }

                const progressPercent = totalKeys > 0n ? Number((totalKeysChecked * 10000n) / totalKeys) / 100 : 0;
                progressBar.style.width = `${Math.min(progressPercent, 100)}%`;

                const elapsedTime = (Date.now() - startTime) / 1000;
                const keysPerSecond = elapsedTime > 0.1 ? Number(totalKeysChecked) / elapsedTime : 0;
                
                let statusText = `${totalKeysChecked.toLocaleString()} clés | ${Math.round(keysPerSecond).toLocaleString()} clés/s`;
                if (Date.now() < autoSaveIndicatorTime) {
                    statusText += " 💾";
                }
                statusEl.innerText = statusText;

                if (keysPerSecond > 0) {
                    const remainingKeys = totalKeys - totalKeysChecked;
                    const remainingSeconds = Number(remainingKeys) / keysPerSecond;
                    etaEl.innerText = `ETA: ${formatTime(remainingSeconds)}`;
                }

                if (m.data.done) {
                    worker.isDone = true;
                    finishedWorkers++;
                    if (finishedWorkers === numWorkers) {
                        statusEl.innerText = "Terminé (non trouvé)";
                        etaEl.innerText = '';
                        progressBar.style.width = '100%';
                        stopWorker(type);
                    }
                }
            }
        };

        const threadInfoDiv = document.createElement('div');
        threadInfoDiv.className = 'thread-info';
        threadInfoDiv.innerHTML = `<strong>Thread ${i + 1}:</strong> 0x${workerStart.toString(16)} &rarr; 0x${workerEnd.toString(16)}`;
        threadsInfoEl.appendChild(threadInfoDiv);

        worker.postMessage({ s: '0x' + workerStart.toString(16), e: '0x' + workerEnd.toString(16), t: targetHash160 });
    }
}


// --- WebGPU Search ---

export async function runWebGPUSearch(type, resumeState = null) {
    if (!navigator.gpu) {
        alert("WebGPU n'est pas supporté par votre navigateur.");
        return;
    }

    let targetAddr, startKeyHex, endKeyHex, searchStartKeyHex, bit = null;
    const statusEl = document.getElementById(`${type}Status`);
    const progressBar = document.getElementById(`${type}ProgressBar`);
    const etaEl = document.getElementById(`${type}ETA`);
    const threadsInfoEl = document.getElementById(`${type}ThreadsInfo`);

    if (type === 'puzzle') {
        const idx = document.getElementById('puzzleSelect').value;
        const data = getPuzzleData(idx);
        targetAddr = data.address;
        startKeyHex = document.getElementById('puzzleStart').value.trim();
        searchStartKeyHex = startKeyHex;
        endKeyHex = document.getElementById('puzzleEnd').value.trim();
        bit = data.bit;
    } else {
        targetAddr = document.getElementById('targetAddr').value.trim();
        startKeyHex = document.getElementById('searchStart').value.trim();
        searchStartKeyHex = startKeyHex;
        endKeyHex = document.getElementById('searchEnd').value.trim() || "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF";
    }

    if (!targetAddr || !startKeyHex) {
        alert("Veuillez fournir une adresse cible et une clé de départ.");
        return;
    }

    if (resumeState && resumeState.currentBaseKey) {
        startKeyHex = resumeState.currentBaseKey;
    }

    statusEl.innerText = "Initialisation WebGPU...";
    progressBar.style.width = '0%';
    etaEl.innerText = '';
    progressBar.style.background = type === 'puzzle' ? 'var(--accent)' : 'var(--green)';
    threadsInfoEl.innerHTML = `<div id="${type}GpuInfo" class="thread-info">Initialisation des paramètres GPU...</div>`;

    let n = 0n;
    for (let c of targetAddr) { n = n * 58n + BigInt(ALPH.indexOf(c)); }
    let leadingZeros = 0;
    for (let c of targetAddr) { if (c === '1') leadingZeros++; else break; }
    const fullHex = '00'.repeat(leadingZeros) + n.toString(16).padStart(50 - leadingZeros * 2, '0');
    const targetHash160Hex = fullHex.substring(2, 42);

    const targetHashU32 = new Uint32Array(5);
    for (let i = 0; i < 5; i++) {
        const slice = targetHash160Hex.substring(i * 8, (i + 1) * 8);
        targetHashU32[i] = parseInt(slice.match(/../g).reverse().join(''), 16);
    }

    try {
        const adapter = await navigator.gpu.requestAdapter();
        const device = await adapter.requestDevice();
        window[`activeGpuDevice_${type}`] = device;
        const currentRunId = Date.now();
        window[`activeGpuRun_${type}`] = currentRunId;

        const gpuThreadsSetting = document.getElementById(`${type}GpuThreads`).value;
        let workgroupSize = 8;
        if (gpuThreadsSetting === 'auto') {
            workgroupSize = Math.min(64, device.limits.maxComputeInvocationsPerWorkgroup);
        } else {
            workgroupSize = parseInt(gpuThreadsSetting, 10);
            workgroupSize = Math.min(workgroupSize, device.limits.maxComputeInvocationsPerWorkgroup);
        }

        if (!cachedShaderCode) {
            const response = await fetch('js/gpu/kernel.wgsl');
            if (!response.ok) {
                statusEl.innerText = "Erreur de chargement du shader WGSL.";
                return;
            }
            cachedShaderCode = await response.text();
        }
        const shaderCode = cachedShaderCode.replace('WORKGROUP_SIZE', workgroupSize.toString());

        const module = device.createShaderModule({ code: shaderCode });
        let pipeline;
        try {
            pipeline = await device.createComputePipelineAsync({
                layout: 'auto',
                compute: { module, entryPoint: 'main' }
            });
        } catch (e) {
            console.error("Erreur pipeline GPU:", e);
            statusEl.innerText = "Erreur Pipeline. Réduisez Threads/WG.";
            return;
        }

        // --- Configuration du Double Buffering ---
        const NUM_BUFFERS = 2;
        const resultBuffers = [];
        const readBuffers = [];
        const globalsBuffers = [];

        for (let i = 0; i < NUM_BUFFERS; i++) {
            resultBuffers.push(device.createBuffer({ size: 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST }));
            readBuffers.push(device.createBuffer({ size: 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }));
            const gBuf = device.createBuffer({ size: 84, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
            device.queue.writeBuffer(gBuf, 64, targetHashU32, 0, 5);
            globalsBuffers.push(gBuf);
        }

        const gTableU32 = new Uint32Array(1024 * 16);
        let base_power = { x: Gx, y: Gy };
        for (let w = 0; w < 4; w++) {
            let current_pt = null;
            for (let i = 0; i < 256; i++) {
                if (current_pt !== null) {
                    for (let j = 0; j < 8; j++) {
                        gTableU32[(w * 256 + i) * 16 + j] = Number((current_pt.x >> BigInt(j * 32)) & 0xFFFFFFFFn);
                        gTableU32[(w * 256 + i) * 16 + 8 + j] = Number((current_pt.y >> BigInt(j * 32)) & 0xFFFFFFFFn);
                    }
                }
                current_pt = addPoints(current_pt, base_power);
            }
            base_power = current_pt;
        }
        const gTableBuffer = device.createBuffer({ size: 1024 * 16 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(gTableBuffer, 0, gTableU32);

        const bindGroups = [];
        for (let i = 0; i < NUM_BUFFERS; i++) {
            bindGroups.push(device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: resultBuffers[i] } },
                    { binding: 1, resource: { buffer: globalsBuffers[i] } },
                    { binding: 2, resource: { buffer: gTableBuffer } }
                ]
            }));
        }

        statusEl.innerText = "Lancement des threads GPU...";

        const intensitySetting = document.getElementById(`${type}GpuWorkgroups`).value;
        const isAutoMode = intensitySetting === 'auto';
        let workgroupCount;
        if (isAutoMode) {
            workgroupCount = Math.max(1, Math.floor(8192 / workgroupSize));
        } else {
            const requestedWorkgroups = parseInt(intensitySetting, 10);
            const requestedTotalThreads = requestedWorkgroups * 8;
            workgroupCount = Math.max(1, Math.floor(requestedTotalThreads / workgroupSize));
            workgroupCount = Math.min(workgroupCount, device.limits.maxComputeWorkgroupsPerDimension);
        }

        const endKey = BigInt('0x' + endKeyHex);
        const searchStartKey = BigInt('0x' + searchStartKeyHex);
        const totalKeys = endKey - searchStartKey + 1n;
        let currentBaseKey = BigInt('0x' + startKeyHex);
        const startTime = Date.now();
        let passCounter = 0;
        const targetPassDuration = 250;
        window[`stopGpu_${type}`] = false;

        let bufferIdx = 0;
        let pendingRead = null;

        // Variables pour la sauvegarde automatique (Auto-save)
        let lastAutoSaveTime = Date.now();
        const AUTO_SAVE_INTERVAL_MS = 10000; // Sauvegarde toutes les 10 secondes
        let autoSaveIndicatorTime = 0;

        // Nouvelles variables d'optimisation JS
        const currentBasePtU32 = new Uint32Array(16);
        const zeroResultU32 = new Uint32Array([0, 0]);
        let lastDomUpdateTime = Date.now();
        const gpuInfoEl = document.getElementById(`${type}GpuInfo`);

        // Fonction utilitaire pour lire la passe précédente asynchrone
        async function processPendingRead(readObj) {
            try {
                await readObj.promise;
            } catch (err) {
                if (window[`activeGpuRun_${type}`] !== currentRunId || window[`stopGpu_${type}`]) return false;
                console.error("WebGPU MapAsync Error:", err);
                statusEl.innerText = "Erreur GPU : Timeout. Baissez l'intensité.";
                return false;
            }

            readObj.gpuDuration = performance.now() - readObj.submitTime;

            const output = new Uint32Array(readObj.buf.getMappedRange());
            let found = false;
            let foundKeyStr = null;
            let formattedTime = null;

            if (output[0] === 1) {
                const elapsedTime = (Date.now() - startTime) / 1000;
                formattedTime = formatTime(elapsedTime);
                const foundKey = readObj.baseKey + BigInt(output[1]);
                foundKeyStr = foundKey.toString(16).padStart(64, '0');
                found = true;
            }
                
            readObj.buf.unmap();

            if (found) {
                document.getElementById(`${type}FoundKey`).innerText = foundKeyStr;
                document.getElementById(`${type}Result`).style.display = "block";
                statusEl.innerText = `TROUVÉ PAR LE GPU en ${formattedTime} !`;
                progressBar.style.width = '100%';
                progressBar.style.background = 'var(--green)';
                etaEl.innerText = 'Terminé !';
                
                saveResult(foundKeyStr, targetAddr, bit, formattedTime);
                gpuProgress[type] = null;
                clearGpuState();
                stopWorker(type);
            }
            return found;
        }

        async function gpuPass() {
            if (window[`stopGpu_${type}`] || window[`activeGpuRun_${type}`] !== currentRunId) return;

            if (currentBaseKey > endKey) {
                if (pendingRead) {
                    const found = await processPendingRead(pendingRead);
                    pendingRead = null;
                    if (found) return;
                }
                gpuProgress[type] = null;
                clearGpuState();
                if (!statusEl.innerText.includes('TROUVÉ')) {
                    statusEl.innerText = "Terminé (non trouvé)";
                    progressBar.style.width = '100%';
                    etaEl.innerText = '';
                }
                stopWorker(type);
                return;
            }

            passCounter++;
            const BATCH_SIZE = 8;
            const keysForThisPass = BigInt(workgroupCount * workgroupSize * BATCH_SIZE);

            if (gpuInfoEl && passCounter % 10 === 1) {
                gpuInfoEl.innerHTML = `<strong>WebGPU (Passe #${passCounter.toLocaleString()}) :</strong> ${workgroupCount.toLocaleString()} WGs &times; ${workgroupSize} Thr &times; ${BATCH_SIZE} Batch = <strong>${keysForThisPass.toLocaleString()}</strong> clés/passe`;
            }

            const basePt = multiply(currentBaseKey) || { x: 0n, y: 0n };
            for (let i = 0; i < 8; i++) {
                currentBasePtU32[i] = Number((basePt.x >> BigInt(i * 32)) & 0xFFFFFFFFn);
                currentBasePtU32[8 + i] = Number((basePt.y >> BigInt(i * 32)) & 0xFFFFFFFFn);
            }

            const gBuf = globalsBuffers[bufferIdx];
            const rBuf = resultBuffers[bufferIdx];
            const readBuf = readBuffers[bufferIdx];
            const bg = bindGroups[bufferIdx];

            device.queue.writeBuffer(gBuf, 0, currentBasePtU32);
            device.queue.writeBuffer(rBuf, 0, zeroResultU32);

            const commandEncoder = device.createCommandEncoder();
            const passEncoder = commandEncoder.beginComputePass();
            passEncoder.setPipeline(pipeline);
            passEncoder.setBindGroup(0, bg);
            passEncoder.dispatchWorkgroups(workgroupCount);
            passEncoder.end();
            commandEncoder.copyBufferToBuffer(rBuf, 0, readBuf, 0, 8);
            device.queue.submit([commandEncoder.finish()]);

            const mapPromise = readBuf.mapAsync(GPUMapMode.READ);
            mapPromise.catch(() => {}); // Évite l'alerte d'erreur d'annulation si le worker s'arrête

            const currentPassReadObj = {
                promise: mapPromise,
                buf: readBuf,
                baseKey: currentBaseKey,
                submitTime: performance.now()
            };

            // C'est ICI qu'on attend les résultats de la passe PRECEDENTE
            if (pendingRead) {
                const found = await processPendingRead(pendingRead);
                if (found) return;

                // Auto-ajustement de la charge GPU
                if (isAutoMode && pendingRead.gpuDuration > 0) {
                    const adjustmentRatio = targetPassDuration / pendingRead.gpuDuration;
                    let newWorkgroupCount = Math.floor(workgroupCount * adjustmentRatio);
                    newWorkgroupCount = Math.max(8, newWorkgroupCount);
                    newWorkgroupCount = Math.min(newWorkgroupCount, device.limits.maxComputeWorkgroupsPerDimension);
                    // Lissage pour éviter les sauts brusques
                    workgroupCount = Math.floor(workgroupCount * 0.8 + newWorkgroupCount * 0.2);
                }
            }

            // On sauvegarde la passe actuelle pour la lire au prochain tour
            pendingRead = currentPassReadObj;
            bufferIdx = (bufferIdx + 1) % NUM_BUFFERS;

            currentBaseKey += keysForThisPass;
            gpuProgress[type] = currentBaseKey;

            const now = Date.now();
            // --- Sauvegarde Automatique (Auto-save) ---
            if (now - lastAutoSaveTime > AUTO_SAVE_INTERVAL_MS) {
                saveGpuState(type, currentBaseKey, endKeyHex);
                lastAutoSaveTime = now;
                autoSaveIndicatorTime = now + 1000; // Affiche l'indicateur pendant 1 sec
            }

            let displayKeys = currentBaseKey - searchStartKey;
            if (displayKeys < 0n) displayKeys = 0n;

            // Mise à jour de l'interface utilisateur limitées dans le temps
            if (now - lastDomUpdateTime >= 200 || currentBaseKey > endKey) {
                const elapsedTime = (now - startTime) / 1000;
                if (elapsedTime > 0) {
                const speed = Number(displayKeys) / elapsedTime;
                let statusText = `${displayKeys.toLocaleString()} clés | ${Math.round(speed).toLocaleString()} clés/s (GPU)`;
                    if (now < autoSaveIndicatorTime) {
                    statusText += " 💾";
                }
                statusEl.innerText = statusText;
                const progressPercent = totalKeys > 0n ? Number((displayKeys * 10000n) / totalKeys) / 100 : 0;
                progressBar.style.width = `${Math.min(progressPercent, 100)}%`;
                if (speed > 0) {
                    const remainingKeys = totalKeys - displayKeys;
                    const remainingSeconds = Number(remainingKeys) > 0 ? Number(remainingKeys) / speed : 0;
                    etaEl.innerText = remainingSeconds > 0 ? `ETA: ${formatTime(remainingSeconds)}` : '';
                }
            }
                lastDomUpdateTime = now;
                // Laisser le navigateur faire le rendu avant de continuer
                setTimeout(gpuPass, 0);
            } else {
                // Si pas de maj DOM, enchaîner sans attendre le VSync
                gpuPass();
            }
        }

        gpuPass();

    } catch (err) {
        console.error("Erreur WebGPU:", err);
        statusEl.innerText = "Erreur WebGPU.";
    }
}

// --- General Worker Control ---

export function stopWorker(type) {
    window[`stopGpu_${type}`] = true;
    if (window[`activeGpuDevice_${type}`] && gpuProgress[type]) {
        const endKey = type === 'puzzle'
            ? document.getElementById('puzzleEnd').value.trim()
            : document.getElementById('searchEnd').value.trim() || "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF";
        saveGpuState(type, gpuProgress[type], endKey);
        gpuProgress[type] = null;
    }
    if (window[`activeGpuDevice_${type}`]) {
        try { window[`activeGpuDevice_${type}`].destroy(); } catch (e) { /* ignore */ }
        window[`activeGpuDevice_${type}`] = null;
    }

    if (activeWorkers[type] && activeWorkers[type].length > 0) {
        activeWorkers[type].forEach(w => { if (w) w.terminate(); });
        activeWorkers[type] = [];
    }

    const statusEl = document.getElementById(`${type}Status`);
    if (statusEl && !statusEl.innerText.includes('TROUVÉ') && !statusEl.innerText.includes('Terminé')) {
        statusEl.innerText = "Arrêté";
        const etaEl = document.getElementById(`${type}ETA`);
        if (etaEl) etaEl.innerText = '';
    }
    document.getElementById(type === 'puzzle' ? 'startPuzzleCpuBtn' : 'startSearchCpuBtn').disabled = false;
    document.getElementById(type === 'puzzle' ? 'startPuzzleGpuBtn' : 'startSearchGpuBtn').disabled = false;
}
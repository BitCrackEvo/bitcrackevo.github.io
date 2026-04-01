import { puzzleData } from '../data/puzzleData.js';
import { N, multiply, sha256, ripemd160, toBase58 } from './crypto.js';
import { showToast } from './utils.js';

// --- Global state for UI ---
let puzzles = [];

// --- Tab Navigation ---

/**
 * Opens a specific tab and updates the URL hash.
 * @param {HTMLElement} tabElement The button element of the tab to open.
 */
export function openTab(tabElement) {
    const tabName = tabElement.dataset.tab;
    history.pushState(null, null, '#' + tabName);
    document.querySelectorAll('.content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById(tabName).classList.add('active');
    tabElement.classList.add('active');
}

/**
 * Handles initial tab loading based on the URL hash.
 */
export function handleTabNavigation() {
    const tabFromHash = window.location.hash.substring(1);
    const validTabs = Array.from(document.querySelectorAll('.tab')).map(t => t.dataset.tab);
    let tabToOpen = 'home';
    if (tabFromHash && validTabs.includes(tabFromHash)) {
        tabToOpen = tabFromHash;
    }
    const tabButton = document.querySelector(`.tab[data-tab="${tabToOpen}"]`);
    if (tabButton) {
        openTab(tabButton);
    }
}

// --- Visualizer Tab ---

/**
 * Updates the entire visualizer UI based on the private key input.
 */
export function updateVisualizer() {
    const val = document.getElementById('privInput').value.trim();
    if (!val) return;
    try {
        const priv = BigInt('0x' + val) % N;
        const pt = multiply(priv || 1n);
        if (!pt) return;

        const xHex = pt.x.toString(16).padStart(64, '0');
        const yHex = pt.y.toString(16).padStart(64, '0');
        document.getElementById('pub-uncomp').innerHTML = `<span class="prefix">04</span><span class="coord-x">${xHex}</span><span class="coord-y">${yHex}</span>`;

        const pref = (pt.y % 2n === 0n) ? '02' : '03';
        document.getElementById('pub-comp').innerHTML = `<span class="prefix">${pref}</span><span class="coord-x">${xHex}</span>`;

        const pubKeyHex = pref + xHex;
        const s1 = sha256(pubKeyHex);
        const r1 = ripemd160(new Uint8Array(s1.match(/.{1,2}/g).map(b => parseInt(b, 16))));
        document.getElementById('h160-val').innerText = r1;

        const networkStep = "00" + r1;
        const hashStep1 = sha256(networkStep);
        const hashStep2 = sha256(hashStep1);
        const finalHex = networkStep + hashStep2.substring(0, 8);
        document.getElementById('btc-addr').innerText = toBase58(finalHex);
    } catch (e) {
        console.error("Error updating visualizer:", e);
        document.getElementById('pub-uncomp').innerText = '-';
        document.getElementById('pub-comp').innerText = '-';
        document.getElementById('h160-val').innerText = '-';
        document.getElementById('btc-addr').innerText = '-';
    }
}

/**
 * Generates a new random private key and updates the visualizer.
 */
export function generateRandom() {
    const b = window.crypto.getRandomValues(new Uint8Array(32));
    document.getElementById('privInput').value = Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
    updateVisualizer();
}

/**
 * Adjusts the current private key by a given amount.
 * @param {bigint} n The amount to add or subtract.
 */
export function adjustKey(n) {
    try {
        let v = (BigInt('0x' + (document.getElementById('privInput').value || "1")) + n + N) % N;
        if (v === 0n) v = N - 1n;
        document.getElementById('privInput').value = v.toString(16).padStart(64, '0');
        updateVisualizer();
    } catch (e) {
        console.error("Invalid private key for adjustment.");
        generateRandom();
    }
}

// --- Puzzle Tab ---

/**
 * Initializes the puzzle dropdown and data.
 */
export function initPuzzle() {
    const select = document.getElementById('puzzleSelect');
    if (!select) return;

    puzzles = puzzleData.map(entry => ({
        bit: entry.bit,
        start: entry.rangeStart.startsWith('0x') ? entry.rangeStart.substring(2) : entry.rangeStart,
        end: entry.rangeEnd.startsWith('0x') ? entry.rangeEnd.substring(2) : entry.rangeEnd,
        address: entry.address,
        priv: entry.privateKey,
        solved: entry.solvedDate
    }));

    puzzles.forEach((p, i) => {
        let opt = document.createElement('option');
        opt.value = i;
        opt.textContent = `Bit ${p.bit} (${p.start.substring(0,4)}... - ${p.end.substring(0,4)}...)`;
        if (p.solved) {
            opt.textContent += " ✅";
        }
        select.appendChild(opt);
    });

    select.value = 65;
    updatePuzzleUI();
}

/**
 * Updates the puzzle UI when a new bit is selected.
 */
export function updatePuzzleUI() {
    const idx = document.getElementById('puzzleSelect').value;
    const data = puzzles[idx];
    if (!data) return;

    document.getElementById('puzzleTargetDisplay').innerText = data.address;
    document.getElementById('puzzleStart').value = data.start;
    document.getElementById('puzzleEnd').value = data.end;

    const info = document.getElementById('puzzleSolvedStatus');
    if (data.solved) {
        info.style.display = "block";
        info.innerHTML = `✅ Résolu le ${data.solved}<br>Clé connue : ${data.priv}`;
    } else {
        info.style.display = "none";
    }

    updatePuzzleRangeSize();
}

/**
 * Clamps the user-defined puzzle range to the original puzzle boundaries.
 */
export function clampPuzzleRange() {
    const idx = document.getElementById('puzzleSelect').value;
    if (!puzzles || !puzzles[idx]) return;
    const data = puzzles[idx];
    const originalStart = BigInt('0x' + data.start);
    const originalEnd = BigInt('0x' + data.end);

    const startInput = document.getElementById('puzzleStart');
    const endInput = document.getElementById('puzzleEnd');

    let startValue;
    try {
        startValue = BigInt('0x' + startInput.value.trim());
        if (startValue < originalStart) { startValue = originalStart; }
        if (startValue > originalEnd) { startValue = originalEnd; }
    } catch (e) {
        startValue = originalStart;
    }
    startInput.value = startValue.toString(16);

    let endValue;
    try {
        endValue = BigInt('0x' + endInput.value.trim());
        if (endValue > originalEnd) { endValue = originalEnd; }
        if (endValue < startValue) { endValue = startValue; }
    } catch (e) {
        endValue = originalEnd;
    }
    endInput.value = endValue.toString(16);

    updatePuzzleRangeSize();
}

/**
 * Updates the display of the number of keys in the selected puzzle range.
 */
export function updatePuzzleRangeSize() {
    const startHex = document.getElementById('puzzleStart').value.trim();
    const endHex = document.getElementById('puzzleEnd').value.trim();
    const sizeEl = document.getElementById('puzzleRangeSize');

    if (!startHex || !endHex) {
        sizeEl.innerText = '- clés à tester';
        return;
    }

    try {
        const start = BigInt('0x' + startHex);
        const end = BigInt('0x' + endHex);

        if (end < start) {
            sizeEl.innerText = 'Erreur: la fin est avant le début.';
            sizeEl.style.color = 'var(--red)';
            return;
        }

        const rangeSize = end - start + 1n;
        sizeEl.innerText = `${rangeSize.toLocaleString('fr-FR')} clés à tester`;
        sizeEl.style.color = 'var(--accent)';

    } catch (e) {
        sizeEl.innerText = 'Clés invalides (format hexadécimal attendu).';
        sizeEl.style.color = 'var(--red)';
    }
}

// --- Benchmark Tab ---

/**
 * Toggles the disabled state of benchmark inputs based on the random mode checkbox.
 */
export function toggleBenchInputs() {
    const isRandom = document.getElementById('benchRandom').checked;
    document.getElementById('benchStartKey').disabled = isRandom;
    document.getElementById('benchStep').disabled = isRandom;
}

// --- Generic UI ---

/**
 * Populates the thread selector dropdowns based on hardware concurrency.
 */
export function initThreadSelector() {
    const maxThreads = navigator.hardwareConcurrency || 4;
    ['searchThreads', 'puzzleThreads'].forEach(id => {
        const select = document.getElementById(id);
        if (!select) return;
        for (let i = 1; i <= maxThreads; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = `${i} Thread(s)`;
            select.appendChild(option);
        }
        select.value = maxThreads;
    });
}

/**
 * Fetches and displays CPU and GPU hardware information.
 */
export async function initHardwareInfo() {
    const cpuInfoEl = document.getElementById('cpuInfo');
    if (cpuInfoEl) {
        const coreCount = navigator.hardwareConcurrency || 'N/A';
        cpuInfoEl.innerHTML = `<div class="hex-display" style="font-size: 16px;"><strong>Coeurs logiques :</strong> ${coreCount}</div>`;
    }

    const gpuInfoEl = document.getElementById('gpuInfo');
    if (!gpuInfoEl) return;

    if (!navigator.gpu) {
        gpuInfoEl.innerHTML = '<p style="color: var(--red);">WebGPU non supporté sur ce navigateur.</p>';
        return;
    }

    try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            gpuInfoEl.innerHTML = '<p style="color: var(--yellow);">Aucun adaptateur GPU compatible WebGPU trouvé.</p>';
            return;
        }
        
        const adapterInfo = adapter.info || {};

        let gpuHtml = `
            <div class="hex-display" style="line-height: 1.8;">
                <div><strong>Type :</strong> ${adapter.isFallbackAdapter ? 'Logiciel (Fallback)' : 'Matériel'}</div>
                <div><strong>Vendeur :</strong> ${adapterInfo.vendor || 'Non disponible'}</div>
                <div><strong>Architecture :</strong> ${adapterInfo.architecture || 'Non disponible'}</div>
                <div><strong>Appareil :</strong> ${adapterInfo.device || 'Non disponible'}</div>
                <div><strong>Description :</strong> ${adapterInfo.description || 'Non disponible'}</div>
            </div>
            <div class="stat-grid" style="margin-top: 15px;">
                <div class="stat-box" style="padding: 10px;"><span class="label">Max Threads/Workgroup</span><span class="stat-val" style="font-size: 18px;">${adapter.limits.maxComputeInvocationsPerWorkgroup.toLocaleString()}</span></div>
                <div class="stat-box" style="padding: 10px;"><span class="label">Max Workgroups/Dimension</span><span class="stat-val" style="font-size: 18px;">${adapter.limits.maxComputeWorkgroupsPerDimension.toLocaleString()}</span></div>
                <div class="stat-box" style="padding: 10px;"><span class="label">Max Storage Buffer</span><span class="stat-val" style="font-size: 18px;">${(adapter.limits.maxStorageBufferBindingSize / (1024*1024)).toFixed(0)} Mo</span></div>
            </div>
        `;
        gpuInfoEl.innerHTML = gpuHtml;

    } catch (e) {
        console.error("Erreur lors de la récupération des informations GPU:", e);
        gpuInfoEl.innerHTML = '<p style="color: var(--red);">Erreur lors de l\'accès à l\'adaptateur GPU.</p>';
    }
}

/**
 * Initializes the theme (dark/light) based on localStorage.
 */
export function initTheme() {
    const themeToggle = document.getElementById('theme-toggle');
    if (!themeToggle) return;

    const applyTheme = (theme) => {
        if (theme === 'light') {
            document.documentElement.classList.add('light-mode');
            themeToggle.textContent = '🌙';
        } else {
            document.documentElement.classList.remove('light-mode');
            themeToggle.textContent = '💡';
        }
    };

    themeToggle.addEventListener('click', () => {
        const isLight = document.documentElement.classList.contains('light-mode');
        if (isLight) {
            localStorage.setItem('theme', 'dark');
            applyTheme('dark');
        } else {
            localStorage.setItem('theme', 'light');
            applyTheme('light');
        }
    });

    const savedTheme = localStorage.getItem('theme') || 'dark';
    applyTheme(savedTheme);
}

/**
 * Copies the text content of an element to the clipboard.
 * @param {string} elementId The ID of the element to copy from.
 * @param {string} toastMessage The message to show in the toast.
 */
export function copyTextFromElement(elementId, toastMessage) {
    const text = document.getElementById(elementId)?.innerText;
    if (text) {
        navigator.clipboard.writeText(text);
        showToast(toastMessage);
    }
}

/**
 * Returns the puzzle data for a given index.
 * @param {number} index The index of the puzzle.
 * @returns {object | undefined} The puzzle data object.
 */
export function getPuzzleData(index) {
    return puzzles[index];
}

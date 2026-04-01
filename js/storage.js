import { showToast } from './utils.js';
import { openTab, updatePuzzleUI, getPuzzleData } from './ui.js';

const FOUND_KEYS_STORAGE_KEY = 'foundKeys';
const GPU_STATE_STORAGE_KEY = 'gpuSearchState';

/**
 * Copies a given text to the clipboard and shows a toast.
 * @param {string} text The text to copy.
 */
function copyDirect(text) {
    navigator.clipboard.writeText(text);
    showToast('Clé copiée !');
}

/**
 * Saves a found key to localStorage and reloads the saved list.
 * @param {string} key The private key hex.
 * @param {string} address The corresponding address.
 * @param {number|null} bit The puzzle bit number, if applicable.
 * @param {string|null} duration The time it took to find.
 */
export function saveResult(key, address, bit = null, duration = null) {
    let saved = JSON.parse(localStorage.getItem(FOUND_KEYS_STORAGE_KEY) || '[]');
    saved.push({ key, address, date: new Date().toISOString(), bit, duration });
    localStorage.setItem(FOUND_KEYS_STORAGE_KEY, JSON.stringify(saved));
    loadSavedResults();
}

/**
 * Loads and displays saved keys from localStorage.
 */
export function loadSavedResults() {
    const listEl = document.getElementById('savedList');
    if (!listEl) return;

    const saved = JSON.parse(localStorage.getItem(FOUND_KEYS_STORAGE_KEY) || '[]');
    if (saved.length === 0) {
        listEl.innerHTML = '<div class="section"><span class="label">Statut</span>Aucune clé trouvée pour le moment.</div>';
        return;
    }

    listEl.innerHTML = saved.reverse().map(item => `
        <div class="section" style="border-left-color: var(--green);">
            <span class="label" style="color: var(--green);">${new Date(item.date).toLocaleString()}</span>
            ${item.bit ? `<div style="margin-bottom: 5px;"><strong>Bit :</strong> <span style="color: var(--yellow);">${item.bit}</span></div>` : ''}
            ${item.duration ? `<div style="margin-bottom: 5px;"><strong>Temps de recherche :</strong> <span style="color: var(--accent);">${item.duration}</span></div>` : ''}
            <div style="margin-bottom: 5px;"><strong>Adresse :</strong> <span style="color: var(--yellow);">${item.address}</span></div>
            <div><strong>Clé Privée :</strong> <span class="hex-display" style="color: var(--green); cursor:pointer; text-decoration: underline;" title="Cliquer pour copier" data-key="${item.key}">${item.key}</span></div>
        </div>
    `).join('');

    listEl.querySelectorAll('[data-key]').forEach(span => {
        span.addEventListener('click', () => copyDirect(span.dataset.key));
    });
}

/**
 * Clears all saved keys from localStorage after confirmation.
 */
export function clearSavedResults() {
    if (confirm("Êtes-vous sûr de vouloir effacer tout l'historique des clés trouvées ?")) {
        localStorage.removeItem(FOUND_KEYS_STORAGE_KEY);
        loadSavedResults();
    }
}

// --- GPU State Management ---

/**
 * Saves the current GPU search state to localStorage.
 * @param {string} type 'search' or 'puzzle'.
 * @param {bigint} currentKey The key to resume from.
 * @param {string} endKey The final key of the range.
 */
export function saveGpuState(type, currentKey, endKey) {
    if (!currentKey) return;
    const state = {
        type: type,
        timestamp: Date.now(),
        currentBaseKey: currentKey.toString(16),
        endKey: endKey,
        targetAddr: type === 'puzzle' ? document.getElementById('puzzleTargetDisplay').innerText : document.getElementById('targetAddr').value,
        puzzleIndex: type === 'puzzle' ? document.getElementById('puzzleSelect').value : null,
        searchStart: type === 'search' ? document.getElementById('searchStart').value : (type === 'puzzle' ? document.getElementById('puzzleStart').value : null),
        gpuIntensity: document.getElementById(`${type}GpuWorkgroups`).value,
        gpuThreads: document.getElementById(`${type}GpuThreads`).value,
    };
    localStorage.setItem(GPU_STATE_STORAGE_KEY, JSON.stringify(state));
    console.log('Progression GPU sauvegardée à la clé:', currentKey.toString(16));
}

/**
 * Clears the GPU state from localStorage.
 * @param {boolean} reloadUI Whether to clear the resume UI prompt.
 */
export function clearGpuState(reloadUI = false) {
    localStorage.removeItem(GPU_STATE_STORAGE_KEY);
    if (reloadUI) {
        const searchContainer = document.getElementById('resume-container-search');
        if (searchContainer) searchContainer.innerHTML = '';
        const puzzleContainer = document.getElementById('resume-container-puzzle');
        if (puzzleContainer) puzzleContainer.innerHTML = '';
    }
}

/**
 * Checks for a saved GPU state and displays a resume prompt.
 * @param {function} resumeCallback The function to call to resume the search.
 * @param {function} clearCallback The function to call to clear the state.
 */
export function checkGpuResumeState(resumeCallback, clearCallback) {
    const savedGpuState = localStorage.getItem(GPU_STATE_STORAGE_KEY);
    if (!savedGpuState) return;

    const state = JSON.parse(savedGpuState);
    const container = document.getElementById(`resume-container-${state.type}`);
    if (!container) return;

    const puzzle = state.type === 'puzzle' ? getPuzzleData(state.puzzleIndex) : null;
    const originalStart = state.type === 'puzzle' ? (state.searchStart || puzzle?.start) : state.searchStart;
    
    if (!originalStart) {
        clearGpuState();
        return;
    }

    const totalRange = BigInt('0x' + state.endKey) - BigInt('0x' + originalStart);
    const progressed = BigInt('0x' + state.currentBaseKey) - BigInt('0x' + originalStart);
    const progressPercent = totalRange > 0n ? Number(progressed * 10000n / totalRange) / 100 : 0;

    container.innerHTML = `
        <div class="section" style="border-left-color: var(--pink); margin-bottom: 15px;">
            <span class="label" style="color: var(--pink);">Session précédente détectée</span>
            <p style="margin: 5px 0; font-size: 12px;">Recherche GPU pour <strong>${state.targetAddr}</strong> arrêtée le ${new Date(state.timestamp).toLocaleString()}.</p>
            <p style="margin: 5px 0; font-size: 12px;">Progression: ~${progressPercent.toFixed(2)}%</p>
            <button id="resume-gpu-btn" style="background: var(--pink); color: var(--button-text-on-color);">Reprendre</button>
            <button id="clear-gpu-btn" class="nav">Ignorer</button>
        </div>
    `;

    document.getElementById('resume-gpu-btn').addEventListener('click', () => resumeCallback(state));
    document.getElementById('clear-gpu-btn').addEventListener('click', clearCallback);
}

/**
 * Prepares the UI to resume a GPU search.
 * @param {object} savedState The state object from localStorage.
 */
export function prepareUiForGpuResume(savedState) {
    const tabButton = document.querySelector(`.tab[data-tab="${savedState.type}"]`);
    if (tabButton) openTab(tabButton);

    if (savedState.type === 'puzzle') {
        document.getElementById('puzzleSelect').value = savedState.puzzleIndex;
        updatePuzzleUI();
        if (savedState.searchStart) {
            document.getElementById('puzzleStart').value = savedState.searchStart;
        }
        document.getElementById('puzzleEnd').value = savedState.endKey;
    } else {
        document.getElementById('targetAddr').value = savedState.targetAddr;
        document.getElementById('searchStart').value = savedState.searchStart;
        document.getElementById('searchEnd').value = savedState.endKey;
    }
    document.getElementById(`${savedState.type}GpuWorkgroups`).value = savedState.gpuIntensity;
    document.getElementById(`${savedState.type}GpuThreads`).value = savedState.gpuThreads;

    const container = document.getElementById(`resume-container-${savedState.type}`);
    if (container) container.innerHTML = '';
}

/**
 * Helper to be called from main.js to clear state and UI.
 */
export function clearGpuStateAndReload() {
    clearGpuState(true);
}
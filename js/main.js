import {
    openTab,
    handleTabNavigation,
    updateVisualizer,
    generateRandom,
    adjustKey,
    initPuzzle,
    updatePuzzleUI,
    clampPuzzleRange,
    updatePuzzleRangeSize,
    toggleBenchInputs,
    initThreadSelector,
    initHardwareInfo,
    initTheme,
    copyTextFromElement,
} from './ui.js';

import {
    loadSavedResults,
    clearSavedResults,
    checkGpuResumeState,
    clearGpuStateAndReload,
    prepareUiForGpuResume
} from './storage.js';

import {
    runSearch,
    runWebGPUSearch,
    stopWorker
} from './workers.js';

import {
    runBenchmark,
    stopBenchmark,
    runGpuBenchmark
} from './benchmark.js';

/**
 * Point d'entrée principal de l'application.
 * S'exécute lorsque le DOM est entièrement chargé.
 */
document.addEventListener('DOMContentLoaded', () => {
    // --- Initialisation des composants ---
    initThreadSelector();
    initHardwareInfo();
    initPuzzle();
    initTheme();
    handleTabNavigation();
    loadSavedResults();
    
    checkGpuResumeState((state) => {
        prepareUiForGpuResume(state);
        runWebGPUSearch(state.type, state);
    }, clearGpuStateAndReload);
    
    generateRandom(); // Peuple le visualiseur au démarrage

    // --- Ajout des écouteurs d'événements ---

    // Navigation par onglets
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', (e) => openTab(e.currentTarget));
    });

    // Visualiseur
    document.getElementById('privInput').addEventListener('input', updateVisualizer);
    document.getElementById('adjustKeyMinus').addEventListener('click', () => adjustKey(-1n));
    document.getElementById('adjustKeyPlus').addEventListener('click', () => adjustKey(1n));
    document.getElementById('generateRandom').addEventListener('click', generateRandom);
    document.getElementById('copyAddressBtn').addEventListener('click', () => copyTextFromElement('btc-addr', 'Adresse copiée !'));

    // Benchmark
    document.getElementById('benchRandom').addEventListener('change', toggleBenchInputs);
    document.getElementById('startBenchBtn').addEventListener('click', runBenchmark);
    document.getElementById('startBenchGpuBtn').addEventListener('click', runGpuBenchmark);
    document.getElementById('stopBenchBtn').addEventListener('click', stopBenchmark);

    // Recherche
    document.getElementById('startSearchCpuBtn').addEventListener('click', () => runSearch('search'));
    document.getElementById('startSearchGpuBtn').addEventListener('click', () => runWebGPUSearch('search'));
    document.getElementById('stopSearchBtn').addEventListener('click', () => stopWorker('search'));

    // Puzzle
    document.getElementById('puzzleSelect').addEventListener('change', updatePuzzleUI);
    document.getElementById('puzzleStart').addEventListener('input', updatePuzzleRangeSize);
    document.getElementById('puzzleEnd').addEventListener('input', updatePuzzleRangeSize);
    document.getElementById('puzzleStart').addEventListener('change', clampPuzzleRange);
    document.getElementById('puzzleEnd').addEventListener('change', clampPuzzleRange);
    document.getElementById('startPuzzleCpuBtn').addEventListener('click', () => runSearch('puzzle'));
    document.getElementById('startPuzzleGpuBtn').addEventListener('click', () => runWebGPUSearch('puzzle'));
    document.getElementById('stopPuzzleBtn').addEventListener('click', () => stopWorker('puzzle'));

    // Sauvegardes
    document.getElementById('clearSavedBtn').addEventListener('click', clearSavedResults);
});

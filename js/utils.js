/**
 * Formats a duration in seconds into a human-readable string (j, h, m, s).
 * @param {number} seconds The duration in seconds.
 * @returns {string} The formatted time string.
 */
export function formatTime(seconds) {
    if (seconds === Infinity || isNaN(seconds)) return 'calcul...';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
    const days = Math.floor(seconds / 86400);
    return `${days}j ${Math.floor((seconds % 86400) / 3600)}h`;
}

/**
 * Displays a short-lived notification toast.
 * @param {string} message The message to display.
 */
export function showToast(message) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.innerText = message;
    t.style.display = 'block';
    setTimeout(() => {
        t.style.display = 'none';
    }, 2000);
}
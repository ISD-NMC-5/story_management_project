/**
 * theme.js — Light / Dark mode
 */
(function () {
    const THEME_KEY = 'story-app-theme';

    function getPreferredTheme() {
        const saved = localStorage.getItem(THEME_KEY);
        if (saved === 'light' || saved === 'dark') return saved;
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem(THEME_KEY, theme);
        const btn = document.getElementById('btn-theme-toggle');
        if (btn) {
            btn.textContent = theme === 'dark' ? '☀️' : '🌙';
            btn.title = theme === 'dark' ? 'Chuyển Light mode' : 'Chuyển Dark mode';
        }
    }

    function toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme') || 'light';
        applyTheme(current === 'dark' ? 'light' : 'dark');
        if (typeof showToast === 'function') {
            showToast(
                current === 'dark' ? 'Đã bật Light mode' : 'Đã bật Dark mode',
                'success',
                2200
            );
        }
    }

    function initTheme() {
        applyTheme(getPreferredTheme());
        const btn = document.getElementById('btn-theme-toggle');
        btn && btn.addEventListener('click', toggleTheme);
    }

    window.AppTheme = { init: initTheme, toggle: toggleTheme, apply: applyTheme };
    document.addEventListener('DOMContentLoaded', initTheme);
})();

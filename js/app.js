/**
 * app.js
 * Khởi tạo Workspace. Ghép/Tách/Nhập đã gom vào một khung trong blocks.js.
 */

document.addEventListener('DOMContentLoaded', () => {
    if (window.BlockSystem && typeof window.BlockSystem.init === 'function') {
        window.BlockSystem.init();
    }
});

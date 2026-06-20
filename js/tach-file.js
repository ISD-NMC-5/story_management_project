/**
 * tach-file.js
 * Logic tách 1 file .txt thành nhiều file nhỏ theo regex chương.
 * Trang riêng, không phụ thuộc blocks.js.
 */
(function () {
    'use strict';

    let selectedFile = null;
    let splitChapters = []; // [{title, content}]
    let selectedChapterIndex = -1;

    document.addEventListener('DOMContentLoaded', init);

    function init() {
        const zone = document.getElementById('split-drop-zone');
        const input = document.getElementById('input-split-file');
        const btnPick = document.getElementById('btn-pick-file');
        const btnSplitPreview = document.getElementById('btn-split-preview');
        const btnDownloadAll = document.getElementById('btn-split-download-all');
        const btnDownloadZip = document.getElementById('btn-split-download-zip');
        const btnClear = document.getElementById('btn-clear-split');

        if (!zone || !input) return;

        // Pick file
        btnPick && btnPick.addEventListener('click', () => input.click());
        input.addEventListener('change', (e) => {
            const files = Array.from(e.target.files || []).filter(f => f.name.toLowerCase().endsWith('.txt'));
            if (files.length) {
                setFile(files[0]);
            } else {
                showToast('Vui lòng chọn file .txt', 'warning');
            }
            input.value = '';
        });

        // Drag & drop
        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            zone.classList.add('dragover');
        });
        zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('dragover');
            const files = Array.from(e.dataTransfer.files || []).filter(f => f.name.toLowerCase().endsWith('.txt'));
            if (files.length) {
                setFile(files[0]);
            } else {
                showToast('Vui lòng thả file .txt', 'warning');
            }
        });

        // Actions
        btnSplitPreview && btnSplitPreview.addEventListener('click', doSplit);
        btnDownloadAll && btnDownloadAll.addEventListener('click', downloadAll);
        btnDownloadZip && btnDownloadZip.addEventListener('click', downloadZip);
        btnClear && btnClear.addEventListener('click', clearAll);
    }

    // ─── File handling ────────────────────────────────────

    function setFile(file) {
        selectedFile = file;
        splitChapters = [];
        selectedChapterIndex = -1;

        const summaryEl = document.getElementById('split-file-summary');
        if (summaryEl) {
            summaryEl.textContent = `Đã chọn: ${file.name} · ${formatBytes(file.size)}`;
        }

        const btnSplit = document.getElementById('btn-split-preview');
        if (btnSplit) btnSplit.disabled = false;

        // Auto-fill prefix from filename
        const prefixEl = document.getElementById('split-prefix');
        if (prefixEl && !prefixEl.value.trim()) {
            prefixEl.value = '';  // Let it auto-generate from chapter titles
        }

        // Hide result panel until split
        const resultPanel = document.getElementById('split-result-panel');
        if (resultPanel) resultPanel.style.display = 'none';

        showToast(`Đã chọn file: ${file.name}`, 'success', 2000);
    }

    function clearAll() {
        selectedFile = null;
        splitChapters = [];
        selectedChapterIndex = -1;

        const summaryEl = document.getElementById('split-file-summary');
        if (summaryEl) summaryEl.textContent = 'Chưa chọn file';

        const resultPanel = document.getElementById('split-result-panel');
        if (resultPanel) resultPanel.style.display = 'none';

        const btnSplit = document.getElementById('btn-split-preview');
        const btnAll = document.getElementById('btn-split-download-all');
        const btnZip = document.getElementById('btn-split-download-zip');
        if (btnSplit) btnSplit.disabled = true;
        if (btnAll) btnAll.disabled = true;
        if (btnZip) btnZip.disabled = true;

        showToast('Đã xóa.', 'info', 2000);
    }

    // ─── Split logic ──────────────────────────────────────

    async function doSplit() {
        if (!selectedFile) {
            showToast('Chưa chọn file.', 'warning');
            return;
        }

        const regexEl = document.getElementById('split-regex');
        let regex;
        try {
            regex = new RegExp(
                (regexEl && regexEl.value.trim()) || '^(Chương|Chapter|Hồi|Quyển)\\s+\\d+',
                'i'
            );
        } catch (error) {
            showToast('Regex tách chương không hợp lệ.', 'error');
            return;
        }

        const text = await selectedFile.text();
        splitChapters = splitTextToChapters(text, regex);

        if (splitChapters.length === 0) {
            showToast('Không tìm thấy chương nào với regex đã cho.', 'warning');
            return;
        }

        // Enable download buttons
        const btnAll = document.getElementById('btn-split-download-all');
        const btnZip = document.getElementById('btn-split-download-zip');
        if (btnAll) btnAll.disabled = false;
        if (btnZip) btnZip.disabled = false;

        updateSplitStats();
        renderChapterList();
        showToast(`Đã tách thành ${splitChapters.length} chương.`, 'success');
    }

    function splitTextToChapters(text, regex) {
        const lines = String(text || '').split(/\r?\n/);
        const chapters = [];
        let currentTitle = 'Phần mở đầu';
        let currentLines = [];

        const flush = () => {
            const content = currentLines.join('\n').trim();
            if (!content && chapters.length === 0) return;
            chapters.push({
                title: currentTitle || `Phần ${chapters.length + 1}`,
                content
            });
        };

        for (const line of lines) {
            const trimmed = line.trim();
            regex.lastIndex = 0;
            if (regex.test(trimmed)) {
                if (currentLines.length > 0 || chapters.length > 0) flush();
                currentTitle = trimmed || `Phần ${chapters.length + 1}`;
                currentLines = [];
            } else {
                currentLines.push(line);
            }
        }

        if (currentLines.length > 0 || chapters.length === 0) flush();
        return chapters.length ? chapters : [{ title: 'Toàn bộ', content: text }];
    }

    // ─── Render ───────────────────────────────────────────

    function updateSplitStats() {
        const resultPanel = document.getElementById('split-result-panel');
        if (resultPanel) resultPanel.style.display = '';

        const statCount = document.getElementById('stat-chapter-count');
        const statChars = document.getElementById('stat-split-chars');
        const statMax = document.getElementById('stat-max-chapter');
        const statMin = document.getElementById('stat-min-chapter');

        const totalChars = splitChapters.reduce((s, ch) => s + ch.content.length, 0);
        const maxLen = Math.max(...splitChapters.map(ch => ch.content.length));
        const minLen = Math.min(...splitChapters.map(ch => ch.content.length));

        if (statCount) statCount.textContent = splitChapters.length;
        if (statChars) statChars.textContent = totalChars.toLocaleString('vi-VN') + ' ký tự';
        if (statMax) statMax.textContent = maxLen.toLocaleString('vi-VN') + ' ký tự';
        if (statMin) statMin.textContent = minLen.toLocaleString('vi-VN') + ' ký tự';
    }

    function renderChapterList() {
        const listEl = document.getElementById('split-chapter-list');
        if (!listEl) return;

        listEl.innerHTML = splitChapters.map((ch, i) => {
            const preview = ch.content.substring(0, 120).replace(/\n/g, ' ');
            return `
                <div class="split-chapter-item${i === selectedChapterIndex ? ' selected' : ''}" data-chapter-index="${i}">
                    <div class="split-chapter-head">
                        <strong>${escapeHtml(ch.title)}</strong>
                        <small>${formatBytes(ch.content.length)} · #${i + 1}</small>
                    </div>
                    <p class="split-chapter-preview">${escapeHtml(preview)}...</p>
                </div>
            `;
        }).join('');

        // Click to preview
        listEl.querySelectorAll('.split-chapter-item').forEach(item => {
            item.addEventListener('click', () => {
                const idx = Number(item.dataset.chapterIndex);
                selectedChapterIndex = idx;
                showChapterDetail(idx);

                // Toggle selected class
                listEl.querySelectorAll('.split-chapter-item').forEach(el => el.classList.remove('selected'));
                item.classList.add('selected');
            });
        });
    }

    function showChapterDetail(index) {
        const ch = splitChapters[index];
        if (!ch) return;

        const detailEl = document.getElementById('split-chapter-detail');
        const titleEl = document.getElementById('split-chapter-detail-title');
        const textEl = document.getElementById('split-chapter-detail-text');

        if (detailEl) detailEl.style.display = '';
        if (titleEl) titleEl.textContent = `📖 ${ch.title} (${formatBytes(ch.content.length)})`;
        if (textEl) textEl.value = ch.content;
    }

    // ─── Download ─────────────────────────────────────────

    function getChapterFilename(chapter, index) {
        const prefixEl = document.getElementById('split-prefix');
        const prefix = (prefixEl && prefixEl.value.trim()) || '';

        if (prefix) {
            return sanitizeFilename(`${prefix}_${String(index + 1).padStart(4, '0')}_${chapter.title}`) + '.txt';
        }
        return sanitizeFilename(chapter.title || `Phan_${index + 1}`) + '.txt';
    }

    function sanitizeFilename(name) {
        return String(name || '')
            .replace(/[\\/:*?"<>|]/g, '_')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 120) || 'chapter';
    }

    function downloadAll() {
        if (!splitChapters.length) {
            showToast('Chưa có chương nào để tải.', 'warning');
            return;
        }

        splitChapters.forEach((ch, i) => {
            const filename = getChapterFilename(ch, i);
            const blob = new Blob([ch.content], { type: 'text/plain;charset=utf-8' });
            downloadBlob(blob, filename);
        });

        showToast(`Đã tải ${splitChapters.length} file.`, 'success');
    }

    async function downloadZip() {
        if (!splitChapters.length) {
            showToast('Chưa có chương nào để tải.', 'warning');
            return;
        }

        if (typeof JSZip === 'undefined') {
            showToast('Thư viện JSZip chưa được tải. Vui lòng thử lại.', 'error');
            return;
        }

        const zip = new JSZip();
        splitChapters.forEach((ch, i) => {
            const filename = getChapterFilename(ch, i);
            zip.file(filename, ch.content);
        });

        const baseName = selectedFile
            ? selectedFile.name.replace(/\.txt$/i, '')
            : 'tach-file';

        const blob = await zip.generateAsync({ type: 'blob' });
        downloadBlob(blob, `${sanitizeFilename(baseName)}_tach.zip`);
        showToast(`Đã tải ZIP: ${splitChapters.length} file.`, 'success');
    }

    // ─── Helpers ──────────────────────────────────────────

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
    }
})();

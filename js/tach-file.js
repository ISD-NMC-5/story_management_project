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

        const limitEl = document.getElementById('split-word-limit');
        const wordLimit = parseInt(limitEl ? limitEl.value : '50000', 10) || 50000;

        const keywordsEl = document.getElementById('split-keywords');
        const keywordsStr = keywordsEl ? keywordsEl.value : 'Chương, Chap, Chapter, 第, 卷, Quyển';
        const keywords = keywordsStr.split(',').map(k => k.trim()).filter(Boolean);

        const text = await selectedFile.text();
        splitChapters = splitTextToChapters(text, wordLimit, keywords);

        if (splitChapters.length === 0) {
            showToast('Không tìm thấy nội dung để tách.', 'warning');
            return;
        }

        // Enable download buttons
        const btnAll = document.getElementById('btn-split-download-all');
        const btnZip = document.getElementById('btn-split-download-zip');
        if (btnAll) btnAll.disabled = false;
        if (btnZip) btnZip.disabled = false;

        updateSplitStats();
        renderChapterList();
        showToast(`Đã tách thành ${splitChapters.length} phần.`, 'success');
    }

    function findChapterTitle(textSegment, keywords) {
        const lines = textSegment.split(/\r?\n/);
        const escapedKeywords = keywords.map(kw => kw.trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')).filter(Boolean);
        if (escapedKeywords.length === 0) return null;
        
        const pattern = new RegExp('^\\s*(?:' + escapedKeywords.join('|') + ')', 'i');
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (pattern.test(line)) {
                let fullTitle = line;
                if (line.length < 30) {
                    for (let j = i + 1; j < Math.min(lines.length, i + 3); j++) {
                        const nextLine = lines[j].trim();
                        if (nextLine) {
                            if (!pattern.test(nextLine) && nextLine.length < 60) {
                                fullTitle = line + ' ' + nextLine;
                            }
                            break;
                        }
                    }
                }
                return fullTitle;
            }
        }
        return null;
    }

    function splitTextToChapters(text, targetWordLimit, keywords) {
        const tokens = text.match(/\S+|\s+/g) || [];
        const chapters = [];
        let currentTokens = [];
        let currentWordCount = 0;
        const sentenceEndings = new Set(['.', '!', '?', '。', '！', '？']);

        const flush = () => {
            const content = currentTokens.join('');
            if (!content.trim()) return;
            const title = findChapterTitle(content, keywords);
            chapters.push({
                title: title || '',
                content: content
            });
            currentTokens = [];
            currentWordCount = 0;
        };

        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            currentTokens.push(token);

            if (isCountableWord(token)) {
                currentWordCount++;

                if (currentWordCount >= targetWordLimit) {
                    const lastChar = token.slice(-1);
                    if (sentenceEndings.has(lastChar) || currentWordCount >= targetWordLimit * 1.5) {
                        if (i + 1 < tokens.length && /^\s+$/.test(tokens[i + 1])) {
                            currentTokens.push(tokens[i + 1]);
                            i++;
                        }
                        flush();
                    }
                }
            }
        }

        if (currentTokens.length > 0) {
            flush();
        }

        return chapters;
    }

    function isCountableWord(value) {
        return /[\p{L}\p{N}]/u.test(String(value || ''));
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
            const title = ch.title || `Phần ${i + 1} (Không tìm thấy chương)`;
            return `
                <div class="split-chapter-item${i === selectedChapterIndex ? ' selected' : ''}" data-chapter-index="${i}">
                    <div class="split-chapter-head">
                        <strong>${escapeHtml(title)}</strong>
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
        if (titleEl) titleEl.textContent = `📖 ${ch.title || `Phần ${index + 1}`} (${formatBytes(ch.content.length)})`;
        if (textEl) textEl.value = ch.content;
    }

    // ─── Download ─────────────────────────────────────────

    function getChapterFilename(chapter, index) {
        const prefixEl = document.getElementById('split-prefix');
        const prefix = (prefixEl && prefixEl.value.trim()) || '';

        let name = '';
        if (chapter.title) {
            name = prefix + chapter.title;
        } else {
            name = prefix + `Part_${String(index + 1).padStart(3, '0')}`;
        }
        return sanitizeFilename(name) + '.txt';
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

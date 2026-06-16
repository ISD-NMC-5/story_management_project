/**
 * link-filter.js
 * Lọc link http/https từ file .txt hoặc văn bản — danh sách không trùng.
 */
(function () {
    const URL_PATTERN = /https?:\/\/[^\s<>"'`\[\]{}|\\^]+/gi;

    let selectedFiles = [];
    let uniqueLinks = [];
    let lastStats = { total: 0, unique: 0, removed: 0, sources: 0 };

    function init() {
        const zone = document.getElementById('link-file-zone');
        const input = document.getElementById('input-txt-files');
        const btnPick = document.getElementById('btn-pick-txt-files');
        const btnExtract = document.getElementById('btn-extract-links');
        const btnClear = document.getElementById('btn-clear-input');
        const btnCopy = document.getElementById('btn-copy-links');
        const btnExport = document.getElementById('btn-export-links');
        const searchInput = document.getElementById('link-search-input');

        btnPick && btnPick.addEventListener('click', () => input && input.click());
        input && input.addEventListener('change', (e) => addFiles(e.target.files, false));
        btnExtract && btnExtract.addEventListener('click', () => extractAndRender());
        btnClear && btnClear.addEventListener('click', clearAllInput);
        btnCopy && btnCopy.addEventListener('click', copyLinks);
        btnExport && btnExport.addEventListener('click', exportLinks);
        searchInput && searchInput.addEventListener('input', () => renderResultsList(filterLinks(searchInput.value)));

        if (zone) {
            zone.addEventListener('dragover', (e) => {
                e.preventDefault();
                zone.classList.add('dragover');
            });
            zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
            zone.addEventListener('drop', (e) => {
                e.preventDefault();
                zone.classList.remove('dragover');
                addFiles(e.dataTransfer.files, true);
            });
        }

        renderFileList();
    }

    function addFiles(fileList, append) {
        const files = Array.from(fileList || []).filter(f =>
            f.name.toLowerCase().endsWith('.txt') || f.type === 'text/plain'
        );
        if (!files.length) {
            showToast('Vui lòng chọn file .txt', 'warning');
            return;
        }
        selectedFiles = append
            ? sortFiles([...selectedFiles, ...files])
            : sortFiles(files);
        if (inputClear()) document.getElementById('input-txt-files').value = '';
        renderFileList();
        showToast(`Đã thêm ${files.length} file.`, 'success');
    }

    function inputClear() {
        const input = document.getElementById('input-txt-files');
        if (input) input.value = '';
        return true;
    }

    function sortFiles(files) {
        return files.sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
        );
    }

    function renderFileList() {
        const summary = document.getElementById('link-file-summary');
        const list = document.getElementById('link-file-list');
        const count = selectedFiles.length;

        if (summary) {
            summary.textContent = count
                ? `Đã chọn ${count} file`
                : 'Chưa chọn file';
        }

        if (!list) return;
        list.innerHTML = selectedFiles.map((file, index) => `
            <li>
                <span>${index + 1}. ${escapeHtml(file.name)}</span>
                <button type="button" data-remove-file="${index}" title="Bỏ file">✕</button>
            </li>
        `).join('');

        list.querySelectorAll('[data-remove-file]').forEach(btn => {
            btn.addEventListener('click', () => {
                selectedFiles.splice(Number(btn.dataset.removeFile), 1);
                renderFileList();
                showToast('Đã bỏ file khỏi danh sách.', 'info', 1800);
            });
        });
    }

    function clearAllInput() {
        selectedFiles = [];
        const paste = document.getElementById('link-paste-input');
        if (paste) paste.value = '';
        renderFileList();
        showToast('Đã xóa nội dung nhập.', 'info');
    }

    async function readAllSources() {
        const parts = [];
        let sourceCount = 0;

        for (const file of selectedFiles) {
            const text = await file.text();
            parts.push(text);
            sourceCount++;
        }

        const paste = document.getElementById('link-paste-input');
        const pasted = paste ? paste.value.trim() : '';
        if (pasted) {
            parts.push(pasted);
            sourceCount++;
        }

        return {
            combined: parts.join('\n\n'),
            sourceCount
        };
    }

    function stripTrailingPunctuation(url) {
        return String(url || '').replace(/[.,;:!?)>\]'"]+$/g, '');
    }

    function normalizeUrl(url, shouldNormalize) {
        let cleaned = stripTrailingPunctuation(url.trim());
        if (!shouldNormalize) return cleaned;

        try {
            const parsed = new URL(cleaned);
            parsed.hash = '';
            let href = parsed.href;
            if (href.endsWith('/') && parsed.pathname !== '/') {
                href = href.replace(/\/+$/, '');
            }
            return href;
        } catch {
            return cleaned;
        }
    }

    function extractLinksFromText(text, options = {}) {
        const {
            normalize = true,
            httpOnly = false,
            sort = true
        } = options;

        const rawMatches = String(text || '').match(URL_PATTERN) || [];
        const allFound = rawMatches.map(m => stripTrailingPunctuation(m)).filter(Boolean);

        const seen = new Set();
        const unique = [];

        allFound.forEach(raw => {
            if (httpOnly && !/^http:\/\//i.test(raw)) return;

            const key = normalizeUrl(raw, normalize).toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            unique.push(normalizeUrl(raw, normalize));
        });

        if (sort) {
            unique.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        }

        return {
            total: allFound.length,
            unique,
            removed: Math.max(0, allFound.length - unique.length)
        };
    }

    async function extractAndRender() {
        const btn = document.getElementById('btn-extract-links');
        if (btn) btn.disabled = true;

        try {
            const { combined, sourceCount } = await readAllSources();
            if (!combined.trim()) {
                showToast('Chưa có file hoặc văn bản để lọc.', 'warning');
                return;
            }

            const normalize = document.getElementById('chk-normalize-url')?.checked !== false;
            const sort = document.getElementById('chk-sort-links')?.checked !== false;
            const httpOnly = document.getElementById('chk-include-http-only')?.checked === true;

            const started = performance.now();
            const result = extractLinksFromText(combined, { normalize, sort, httpOnly });
            const elapsed = Math.round(performance.now() - started);

            uniqueLinks = result.unique;
            lastStats = {
                total: result.total,
                unique: result.unique.length,
                removed: result.removed,
                sources: sourceCount
            };

            updateStats();
            renderResultsList(uniqueLinks);
            toggleOutputActions(uniqueLinks.length > 0);

            const searchInput = document.getElementById('link-search-input');
            if (searchInput) {
                searchInput.disabled = uniqueLinks.length === 0;
                searchInput.value = '';
            }

            if (result.unique.length) {
                showToast(
                    `Lọc xong: ${result.unique.length} link không trùng (loại ${result.removed} trùng) · ${elapsed}ms`,
                    'success',
                    3400
                );
            } else {
                showToast('Không tìm thấy link http/https trong nội dung.', 'warning', 3200);
            }
        } catch (error) {
            showToast('Không đọc được file. Hãy thử lại.', 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    function updateStats() {
        setText('stat-total-links', lastStats.total.toLocaleString('vi-VN'));
        setText('stat-unique-links', lastStats.unique.toLocaleString('vi-VN'));
        setText('stat-removed-dupes', lastStats.removed.toLocaleString('vi-VN'));
        setText('stat-source-info', lastStats.sources ? `${lastStats.sources} nguồn` : '—');
    }

    function setText(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    function filterLinks(query) {
        const q = String(query || '').trim().toLowerCase();
        if (!q) return uniqueLinks;
        return uniqueLinks.filter(link => link.toLowerCase().includes(q));
    }

    function renderResultsList(links) {
        const list = document.getElementById('link-results-list');
        if (!list) return;

        if (!links.length) {
            list.innerHTML = uniqueLinks.length
                ? '<li class="link-results-empty muted">Không có link khớp bộ lọc tìm kiếm.</li>'
                : '<li class="link-results-empty muted">Chưa có kết quả. Hãy gửi file .txt hoặc dán văn bản rồi bấm Lọc link.</li>';
            return;
        }

        list.innerHTML = links.map(link => `
            <li>
                <a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link)}</a>
            </li>
        `).join('');
    }

    function toggleOutputActions(enabled) {
        const btnCopy = document.getElementById('btn-copy-links');
        const btnExport = document.getElementById('btn-export-links');
        if (btnCopy) btnCopy.disabled = !enabled;
        if (btnExport) btnExport.disabled = !enabled;
    }

    async function copyLinks() {
        if (!uniqueLinks.length) {
            showToast('Chưa có link để copy.', 'warning');
            return;
        }
        const text = uniqueLinks.join('\n');
        try {
            await navigator.clipboard.writeText(text);
            showToast(`Đã copy ${uniqueLinks.length} link.`, 'success');
        } catch {
            showToast('Không copy được. Hãy dùng Tải .txt.', 'error');
        }
    }

    function exportLinks() {
        if (!uniqueLinks.length) {
            showToast('Chưa có link để tải.', 'warning');
            return;
        }
        const blob = new Blob([uniqueLinks.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' });
        downloadBlob(blob, 'links-khong-trung.txt');
        showToast(`Đã tải links-khong-trung.txt (${uniqueLinks.length} link).`, 'success');
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    function escapeHtml(str) {
        return String(str)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;');
    }

    document.addEventListener('DOMContentLoaded', init);
})();

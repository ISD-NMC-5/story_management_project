/**
 * rename-file.js
 * Trang riêng: dịch tên file Trung → thêm tiếng Việt sau tên (txt, rar).
 * Đổi tên tại chỗ qua File System Access API hoặc tải ZIP.
 */

(function () {
    const DICT_KEY = 'story-cn-vi-dict';
    const SETTINGS_KEY = 'story-cn-vi-settings';
    const DEFAULT_ARGOS_URL = 'https://libretranslate.com/translate';
    const ALLOWED_EXT = ['.txt', '.rar'];
    const MYMEMORY_DELAY_MS = 350;

    let dict = {};
    let settings = { argosUrl: DEFAULT_ARGOS_URL, useArgos: true, useMyMemory: true };
    let fileEntries = [];
    let previewRows = [];
    let directoryHandle = null;
    let pickMode = 'none'; // 'folder' | 'files'
    let dictSearchQuery = '';

    function loadData() {
        try {
            const saved = localStorage.getItem(DICT_KEY);
            dict = saved ? JSON.parse(saved) : {};
            if (typeof dict !== 'object' || Array.isArray(dict)) dict = {};
        } catch (e) {
            dict = {};
        }
        try {
            const savedSettings = localStorage.getItem(SETTINGS_KEY);
            if (savedSettings) settings = { ...settings, ...JSON.parse(savedSettings) };
        } catch (e) {
            /* ignore */
        }
    }

    function saveDict() {
        localStorage.setItem(DICT_KEY, JSON.stringify(dict));
    }

    function saveSettings() {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }

    function hasChinese(text) {
        return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(String(text || ''));
    }

    function hasVietnamese(text) {
        return /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ]/u.test(String(text || ''));
    }

    function splitName(filename) {
        const name = String(filename || '');
        const dot = name.lastIndexOf('.');
        if (dot <= 0) return { base: name, ext: '' };
        return { base: name.slice(0, dot), ext: name.slice(dot) };
    }

    function isAllowedFile(name) {
        const lower = String(name || '').toLowerCase();
        return ALLOWED_EXT.some(ext => lower.endsWith(ext));
    }

    function sanitizeFilename(name) {
        return String(name || '')
            .replace(/[\\/:*?"<>|]/g, '_')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function alreadyHasViSuffix(base) {
        const trimmed = String(base || '').trim();
        const match = trimmed.match(/^(.+?[\u4e00-\u9fff\u3400-\u4dbf]+)\s+(.+)$/);
        if (!match) return false;
        const after = match[2];
        return hasVietnamese(after) || /^[A-Za-z0-9_(\)\-\.]/.test(after);
    }

    function buildNewFilename(oldName, viText) {
        const { base, ext } = splitName(oldName);
        const vi = sanitizeFilename(viText);
        if (!vi) return oldName;
        if (base.includes(vi)) return oldName;
        return sanitizeFilename(`${base} ${vi}${ext}`);
    }

    function escapeHtml(str) {
        return String(str)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;');
    }

    function escapeAttr(str) {
        return escapeHtml(str).replaceAll("'", '&#39;');
    }

    async function fetchArgosTranslate(text) {
        const url = (settings.argosUrl || DEFAULT_ARGOS_URL).replace(/\/$/, '');
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ q: text, source: 'zh', target: 'vi', format: 'text' })
        });
        if (!res.ok) throw new Error(`Argos HTTP ${res.status}`);
        const data = await res.json();
        const translated = data.translatedText || data.translation || '';
        if (!translated) throw new Error('Argos trả về rỗng');
        return translated.trim();
    }

    async function fetchMyMemory(text) {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=zh-CN|vi`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`);
        const data = await res.json();
        const translated = data?.responseData?.translatedText || '';
        if (!translated || data.responseStatus === 429) throw new Error('MyMemory giới hạn/lỗi');
        return translated.trim();
    }

    async function fetchOnlineTranslation(text) {
        const errors = [];
        if (settings.useArgos) {
            try {
                return { text: await fetchArgosTranslate(text), source: 'argos' };
            } catch (e) {
                errors.push(e.message);
            }
        }
        if (settings.useMyMemory) {
            try {
                await sleep(MYMEMORY_DELAY_MS);
                return { text: await fetchMyMemory(text), source: 'mymemory' };
            } catch (e) {
                errors.push(e.message);
            }
        }
        throw new Error(errors.join(' · ') || 'Không dịch được online');
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function translateText(cnText) {
        const text = String(cnText || '').trim();
        if (!text) return { cn: '', vi: '', source: 'empty' };
        if (dict[text]) return { cn: text, vi: dict[text], source: 'dict' };
        if (!hasChinese(text)) return { cn: text, vi: text, source: 'plain' };

        const keys = Object.keys(dict).filter(Boolean).sort((a, b) => b.length - a.length);
        let vi = '';
        let unknown = '';
        let usedDict = false;
        let usedOnline = false;
        let onlineSource = '';

        const flushUnknown = async () => {
            if (!unknown) return;
            if (hasChinese(unknown)) {
                const online = await fetchOnlineTranslation(unknown);
                vi += online.text;
                usedOnline = true;
                onlineSource = online.source;
            } else {
                vi += unknown;
            }
            unknown = '';
        };

        let pos = 0;
        while (pos < text.length) {
            let matched = false;
            for (const key of keys) {
                if (text.startsWith(key, pos)) {
                    await flushUnknown();
                    vi += dict[key];
                    usedDict = true;
                    pos += key.length;
                    matched = true;
                    break;
                }
            }
            if (!matched) {
                unknown += text[pos];
                pos += 1;
            }
        }
        await flushUnknown();

        vi = vi.trim();
        let source = onlineSource || 'online';
        if (usedDict && usedOnline) source = 'dict+online';
        else if (usedDict) source = 'dict';

        return { cn: text, vi, source };
    }

    function updateSummary() {
        const el = document.getElementById('rename-file-summary');
        if (!el) return;
        if (!fileEntries.length) {
            el.textContent = 'Chưa chọn file';
            return;
        }
        const mode = pickMode === 'folder' ? 'thư mục (đổi tên tại chỗ)' : 'danh sách file';
        el.textContent = `${fileEntries.length} file · ${mode}`;
    }

    function updateActionButtons() {
        const hasFiles = fileEntries.length > 0;
        const hasPreview = previewRows.some(r => r.willChange);
        document.getElementById('btn-preview-rename').disabled = !hasFiles;
        document.getElementById('btn-apply-rename').disabled = !(hasPreview && pickMode === 'folder' && directoryHandle);
        document.getElementById('btn-download-zip').disabled = !hasPreview;
        document.getElementById('btn-copy-names').disabled = !previewRows.length;
    }

    function updateModeNote() {
        const el = document.getElementById('rename-mode-note');
        if (!el) return;
        if (pickMode === 'folder' && directoryHandle) {
            el.textContent = 'Chế độ thư mục: có thể bấm "Đổi tên tại chỗ" — chỉ đổi tên, không sửa nội dung file.';
        } else if (pickMode === 'files') {
            el.textContent = 'Chế độ chọn file: dùng "Tải ZIP (tên mới)" để lấy file cùng nội dung, tên mới.';
        } else {
            el.textContent = 'Chưa quét file.';
        }
    }

    async function loadFromDirectory(dirHandle) {
        directoryHandle = dirHandle;
        pickMode = 'folder';
        fileEntries = [];

        for await (const [name, handle] of dirHandle.entries()) {
            if (handle.kind !== 'file') continue;
            if (!isAllowedFile(name)) continue;
            fileEntries.push({
                oldName: name,
                handle,
                file: null,
                mode: 'folder'
            });
        }

        fileEntries.sort((a, b) => a.oldName.localeCompare(b.oldName, undefined, { numeric: true }));
        previewRows = [];
        renderPreview();
        updateSummary();
        updateModeNote();
        updateActionButtons();
        showToast(`Đã quét ${fileEntries.length} file .txt/.rar trong thư mục.`, 'success');
    }

    async function loadFromFileList(fileList) {
        directoryHandle = null;
        pickMode = 'files';
        fileEntries = [];

        for (const file of Array.from(fileList || [])) {
            if (!isAllowedFile(file.name)) continue;
            fileEntries.push({
                oldName: file.name,
                handle: null,
                file,
                mode: 'files'
            });
        }

        fileEntries.sort((a, b) => a.oldName.localeCompare(b.oldName, undefined, { numeric: true }));
        previewRows = [];
        renderPreview();
        updateSummary();
        updateModeNote();
        updateActionButtons();

        if (!fileEntries.length) {
            showToast('Không có file .txt hoặc .rar.', 'warning');
        } else {
            showToast(`Đã chọn ${fileEntries.length} file.`, 'success');
        }
    }

    async function buildPreview() {
        const chkSkip = document.getElementById('chk-skip-renamed');
        const chkOnlyCn = document.getElementById('chk-only-chinese');
        const skipRenamed = chkSkip ? chkSkip.checked : true;
        const onlyChinese = chkOnlyCn ? chkOnlyCn.checked : true;

        const btn = document.getElementById('btn-preview-rename');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Đang dịch...';
        }

        previewRows = [];
        let changeCount = 0;
        let skipCount = 0;

        try {
            for (let i = 0; i < fileEntries.length; i++) {
                const entry = fileEntries[i];
                const { base } = splitName(entry.oldName);
                let row = {
                    index: i,
                    oldName: entry.oldName,
                    newName: entry.oldName,
                    vi: '',
                    source: 'skip',
                    willChange: false,
                    reason: ''
                };

                if (onlyChinese && !hasChinese(base)) {
                    row.reason = 'Không có chữ Hán';
                    skipCount++;
                    previewRows.push(row);
                    continue;
                }

                if (skipRenamed && alreadyHasViSuffix(base)) {
                    row.reason = 'Đã có phần Việt';
                    skipCount++;
                    previewRows.push(row);
                    continue;
                }

                const translated = await translateText(base);
                const newName = buildNewFilename(entry.oldName, translated.vi);

                if (newName === entry.oldName) {
                    row.reason = 'Giữ nguyên';
                    skipCount++;
                } else {
                    row.newName = newName;
                    row.vi = translated.vi;
                    row.source = translated.source;
                    row.willChange = true;
                    row.reason = '';
                    changeCount++;
                }

                previewRows.push(row);
            }

            renderPreview(changeCount, skipCount);
            updateActionButtons();
            showToast(`Xong: ${changeCount} file sẽ đổi tên, ${skipCount} bỏ qua.`, 'success', 3500);
        } catch (e) {
            showToast(`Lỗi dịch: ${e.message}`, 'error', 4500);
        } finally {
            if (btn) {
                btn.disabled = fileEntries.length === 0;
                btn.textContent = 'Xem trước / Dịch tên';
            }
        }
    }

    function renderPreview(changeCount = 0, skipCount = 0) {
        const tbody = document.getElementById('rename-preview-body');
        const totalEl = document.getElementById('rename-stat-total');
        const changeEl = document.getElementById('rename-stat-change');
        const skipEl = document.getElementById('rename-stat-skip');

        if (totalEl) totalEl.textContent = String(fileEntries.length);
        if (changeEl) changeEl.textContent = String(changeCount || previewRows.filter(r => r.willChange).length);
        if (skipEl) skipEl.textContent = String(skipCount || previewRows.filter(r => !r.willChange).length);

        if (!tbody) return;

        if (!previewRows.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="muted rename-empty">Chọn file rồi bấm Xem trước / Dịch tên.</td></tr>';
            return;
        }

        tbody.innerHTML = previewRows.map((row, idx) => {
            const cls = row.willChange ? 'rename-row-change' : 'rename-row-skip';
            return `
                <tr class="${cls}">
                    <td>${idx + 1}</td>
                    <td>${escapeHtml(row.oldName)}</td>
                    <td class="arrow">→</td>
                    <td>${row.willChange ? `<strong>${escapeHtml(row.newName)}</strong>` : escapeHtml(row.oldName)}</td>
                    <td>${escapeHtml(row.source || row.reason || '—')}</td>
                </tr>`;
        }).join('');
    }

    async function applyRenameInPlace() {
        if (!directoryHandle || pickMode !== 'folder') {
            showToast('Chọn thư mục trước để đổi tên tại chỗ.', 'warning');
            return;
        }

        const toApply = previewRows.filter(r => r.willChange);
        if (!toApply.length) {
            showToast('Không có file nào cần đổi tên.', 'warning');
            return;
        }

        if (!window.confirm(`Đổi tên ${toApply.length} file trong thư mục?\n\nChỉ đổi tên — nội dung file giữ nguyên.`)) return;

        const btn = document.getElementById('btn-apply-rename');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Đang đổi...';
        }

        let ok = 0;
        const errors = [];

        try {
            const perm = await directoryHandle.requestPermission({ mode: 'readwrite' });
            if (perm !== 'granted') {
                showToast('Cần quyền ghi thư mục.', 'error');
                return;
            }

            for (const row of toApply) {
                const entry = fileEntries[row.index];
                if (!entry) continue;
                try {
                    // Lấy handle tươi mới từ thư mục để tránh lỗi bộ nhớ đệm trạng thái cũ
                    const freshHandle = await directoryHandle.getFileHandle(entry.oldName);
                    if (typeof freshHandle.move === 'function') {
                        await freshHandle.move(row.newName);
                    } else {
                        showToast('Trình duyệt không hỗ trợ move(). Dùng Chrome/Edge mới hoặc tải ZIP.', 'error');
                        return;
                    }
                    entry.oldName = row.newName;
                    ok++;
                } catch (e) {
                    errors.push(`${row.oldName}: ${e.message}`);
                }
            }

            if (errors.length) {
                showToast(`Đổi ${ok}/${toApply.length}. Lỗi: ${errors[0]}`, 'warning', 5000);
            } else {
                showToast(`Đã đổi tên ${ok} file tại chỗ.`, 'success');
            }

            await loadFromDirectory(directoryHandle);
            await buildPreview();
        } finally {
            if (btn) {
                btn.disabled = !(pickMode === 'folder' && directoryHandle);
                btn.textContent = 'Đổi tên tại chỗ';
            }
        }
    }

    async function downloadRenamedZip() {
        const toPack = previewRows.filter(r => r.willChange);
        if (!toPack.length) {
            showToast('Không có file nào để tải.', 'warning');
            return;
        }

        if (!window.JSZip) {
            showToast('JSZip chưa sẵn sàng.', 'error');
            return;
        }

        const btn = document.getElementById('btn-download-zip');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Đang nén...';
        }

        try {
            const zip = new JSZip();
            const used = new Set();

            for (const row of toPack) {
                const entry = fileEntries[row.index];
                let blob;
                if (entry.file) {
                    blob = entry.file;
                } else if (entry.handle) {
                    const f = await entry.handle.getFile();
                    blob = f;
                } else {
                    continue;
                }

                let name = row.newName;
                let dup = 1;
                while (used.has(name)) {
                    const { base, ext } = splitName(row.newName);
                    name = `${base}_${dup}${ext}`;
                    dup++;
                }
                used.add(name);
                zip.file(name, blob);
            }

            const out = await zip.generateAsync({ type: 'blob' });
            downloadBlob(out, 'file-da-doi-ten.zip');
            showToast(`Đã tải ZIP ${used.size} file (nội dung giữ nguyên).`, 'success');
        } catch (e) {
            showToast(`Lỗi tạo ZIP: ${e.message}`, 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Tải ZIP (tên mới)';
            }
        }
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

    async function copyNameList() {
        const lines = previewRows
            .filter(r => r.willChange)
            .map(r => `${r.oldName}\t${r.newName}`);
        if (!lines.length) {
            showToast('Chưa có tên mới để copy.', 'warning');
            return;
        }
        try {
            await navigator.clipboard.writeText(lines.join('\n'));
            showToast(`Đã copy ${lines.length} dòng (cũ → mới).`, 'success');
        } catch (e) {
            showToast('Không copy được.', 'error');
        }
    }

    function clearList() {
        fileEntries = [];
        previewRows = [];
        directoryHandle = null;
        pickMode = 'none';
        renderPreview();
        updateSummary();
        updateModeNote();
        updateActionButtons();
        showToast('Đã xóa danh sách.', 'info');
    }

    function renderDictTable() {
        const tbody = document.getElementById('dict-table-body');
        const countEl = document.getElementById('dict-count');
        if (!tbody) return;

        const query = dictSearchQuery.trim().toLowerCase();
        let entries = Object.entries(dict).sort((a, b) => a[0].localeCompare(b[0], 'zh-Hans'));
        
        // Cập nhật tổng số từ trước khi lọc
        if (countEl) countEl.textContent = String(entries.length);

        // Lọc theo tìm kiếm
        if (query) {
            entries = entries.filter(([cn, vi]) => 
                cn.toLowerCase().includes(query) || vi.toLowerCase().includes(query)
            );
        }

        if (!entries.length) {
            tbody.innerHTML = `<tr><td colspan="4" class="muted rename-empty">${query ? 'Không tìm thấy từ phù hợp.' : 'Chưa có từ.'}</td></tr>`;
            return;
        }

        tbody.innerHTML = entries.map(([cn, vi], idx) => `
            <tr>
                <td>${idx + 1}</td>
                <td>${escapeHtml(cn)}</td>
                <td contenteditable="true" class="dict-vi-editable" data-cn="${escapeAttr(cn)}" title="Nhấp đúp hoặc bấm để sửa trực tiếp">${escapeHtml(vi)}</td>
                <td><button type="button" class="btn btn-small btn-danger" data-dict-del="${escapeAttr(cn)}">✕</button></td>
            </tr>
        `).join('');
    }

    function addDictEntry(cn, vi) {
        const cnText = String(cn || '').trim();
        const viText = String(vi || '').trim();
        if (!cnText || !viText) {
            showToast('Nhập cả Trung và Việt.', 'warning');
            return;
        }
        dict[cnText] = viText;
        saveDict();
        renderDictTable();
        showToast(`Đã lưu: ${cnText} → ${viText}`, 'success');
    }

    function addDictBulk() {
        const inputEl = document.getElementById('dict-bulk-input');
        const statusEl = document.getElementById('dict-bulk-status');
        if (!inputEl) return;
        
        const text = inputEl.value;
        if (!text.trim()) {
            showToast('Hãy dán danh sách từ trước.', 'warning');
            return;
        }

        const cnRegex = /[\u4e00-\u9fff\u3400-\u4dbf]+/g;
        const matches = [];
        let match;
        while ((match = cnRegex.exec(text)) !== null) {
            matches.push({
                key: match[0],
                index: match.index,
                end: cnRegex.lastIndex
            });
        }

        let added = 0;
        let skipped = 0;

        for (let i = 0; i < matches.length; i++) {
            const current = matches[i];
            const next = matches[i + 1];
            const valStart = current.end;
            const valEnd = next ? next.index : text.length;
            
            let val = text.substring(valStart, valEnd);
            // Clean value: remove leading/trailing spaces and leading delimiters
            val = val.trim();
            val = val.replace(/^(?:\||→|=>|=|-|:)\s*/, '').trim();
            
            if (current.key && val) {
                dict[current.key] = val;
                added++;
            } else {
                skipped++;
            }
        }

        if (added > 0) {
            saveDict();
            renderDictTable();
            if (statusEl) {
                statusEl.textContent = `Thêm thành công ${added} từ, bỏ qua ${skipped} từ không hợp lệ hoặc thiếu nghĩa.`;
                statusEl.style.color = 'var(--app-success, #2ecc71)';
            }
            showToast(`Đã nhập thành công ${added} từ!`, 'success');
        } else {
            if (statusEl) {
                statusEl.textContent = `Không tìm thấy từ tiếng Trung hợp lệ để nhập.`;
                statusEl.style.color = 'var(--app-danger, #e74c3c)';
            }
            showToast('Không nhập được từ nào, hãy kiểm tra lại định dạng.', 'warning');
        }
    }

    function clearAllDict() {
        if (!Object.keys(dict).length) {
            showToast('Từ điển trống sẵn.', 'info');
            return;
        }
        if (!window.confirm('Bạn có chắc chắn muốn xóa TOÀN BỘ từ điển không? Hành động này không thể hoàn tác.')) {
            return;
        }
        dict = {};
        saveDict();
        renderDictTable();
        showToast('Đã xóa toàn bộ từ điển.', 'success');
    }

    function init() {
        loadData();
        renderDictTable();

        const zone = document.getElementById('rename-file-zone');
        const inputFiles = document.getElementById('input-rename-files');
        const cnEl = document.getElementById('dict-cn');
        const viEl = document.getElementById('dict-vi');
        const argosUrlEl = document.getElementById('dict-argos-url');

        if (argosUrlEl) argosUrlEl.value = settings.argosUrl || DEFAULT_ARGOS_URL;
        document.getElementById('chk-use-argos').checked = settings.useArgos !== false;
        document.getElementById('chk-use-mymemory').checked = settings.useMyMemory !== false;

        document.getElementById('btn-pick-folder')?.addEventListener('click', async () => {
            if (!window.showDirectoryPicker) {
                showToast('Trình duyệt không hỗ trợ chọn thư mục. Dùng Chrome/Edge hoặc chọn file + ZIP.', 'warning', 4500);
                return;
            }
            try {
                const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
                await loadFromDirectory(dir);
            } catch (e) {
                if (e.name !== 'AbortError') showToast(`Không mở được thư mục: ${e.message}`, 'error');
            }
        });

        document.getElementById('btn-pick-files')?.addEventListener('click', () => inputFiles?.click());
        inputFiles?.addEventListener('change', (e) => {
            loadFromFileList(e.target.files);
            e.target.value = '';
        });

        zone?.addEventListener('dragover', (e) => {
            e.preventDefault();
            zone.classList.add('dragover');
        });
        zone?.addEventListener('dragleave', () => zone.classList.remove('dragover'));
        zone?.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('dragover');
            loadFromFileList(e.dataTransfer.files);
        });

        document.getElementById('btn-preview-rename')?.addEventListener('click', buildPreview);
        document.getElementById('btn-apply-rename')?.addEventListener('click', applyRenameInPlace);
        document.getElementById('btn-download-zip')?.addEventListener('click', downloadRenamedZip);
        document.getElementById('btn-copy-names')?.addEventListener('click', copyNameList);
        document.getElementById('btn-clear-rename-list')?.addEventListener('click', clearList);

        document.getElementById('btn-add-dict')?.addEventListener('click', () => {
            addDictEntry(cnEl?.value, viEl?.value);
            if (cnEl) cnEl.value = '';
            if (viEl) viEl.value = '';
        });
        document.getElementById('btn-bulk-add-dict')?.addEventListener('click', addDictBulk);
        document.getElementById('btn-bulk-clear')?.addEventListener('click', () => {
            const inputEl = document.getElementById('dict-bulk-input');
            const statusEl = document.getElementById('dict-bulk-status');
            if (inputEl) inputEl.value = '';
            if (statusEl) statusEl.textContent = '';
            showToast('Đã xóa nội dung ô nhập hàng loạt.', 'info');
        });
        document.getElementById('btn-clear-dict')?.addEventListener('click', clearAllDict);
        document.getElementById('dict-search')?.addEventListener('input', (e) => {
            dictSearchQuery = e.target.value;
            renderDictTable();
        });

        document.getElementById('btn-export-dict')?.addEventListener('click', () => {
            downloadBlob(new Blob([JSON.stringify(dict, null, 2)], { type: 'application/json' }), 'tu-dien-trung-viet.json');
        });
        document.getElementById('btn-import-dict')?.addEventListener('click', () => document.getElementById('input-import-dict')?.click());
        document.getElementById('input-import-dict')?.addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            try {
                dict = { ...dict, ...JSON.parse(await file.text()) };
                saveDict();
                renderDictTable();
                showToast('Đã nhập từ điển.', 'success');
            } catch (err) {
                showToast('File từ điển không hợp lệ.', 'error');
            }
            e.target.value = '';
        });

        const tableBody = document.getElementById('dict-table-body');
        tableBody?.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-dict-del]');
            if (!btn) return;
            const cn = btn.dataset.dictDel;
            delete dict[cn];
            saveDict();
            renderDictTable();
            showToast(`Đã xóa từ: ${cn}`, 'info');
        });

        tableBody?.addEventListener('blur', (e) => {
            if (e.target.classList.contains('dict-vi-editable')) {
                const cn = e.target.dataset.cn;
                const newVi = e.target.textContent.trim();
                if (cn && newVi) {
                    if (dict[cn] !== newVi) {
                        dict[cn] = newVi;
                        saveDict();
                        showToast(`Đã cập nhật: ${cn} → ${newVi}`, 'success');
                    }
                } else if (cn && !newVi) {
                    e.target.textContent = dict[cn] || '';
                    showToast('Không thể để trống bản dịch.', 'warning');
                }
            }
        }, true);

        tableBody?.addEventListener('keydown', (e) => {
            if (e.target.classList.contains('dict-vi-editable') && e.key === 'Enter') {
                e.preventDefault();
                e.target.blur();
            }
        });

        argosUrlEl?.addEventListener('change', () => {
            settings.argosUrl = argosUrlEl.value.trim() || DEFAULT_ARGOS_URL;
            saveSettings();
        });
        document.getElementById('chk-use-argos')?.addEventListener('change', (e) => {
            settings.useArgos = e.target.checked;
            saveSettings();
        });
        document.getElementById('chk-use-mymemory')?.addEventListener('change', (e) => {
            settings.useMyMemory = e.target.checked;
            saveSettings();
        });

        document.getElementById('btn-test-argos')?.addEventListener('click', async () => {
            const btn = document.getElementById('btn-test-argos');
            btn.disabled = true;
            try {
                const sample = cnEl?.value.trim() || '第一章';
                const r = await translateText(sample);
                showToast(`${sample} → ${r.vi} (${r.source})`, 'success', 4000);
            } catch (e) {
                showToast(`Thử thất bại: ${e.message}`, 'error');
            } finally {
                btn.disabled = false;
            }
        });

        updateActionButtons();
        updateModeNote();
    }

    document.addEventListener('DOMContentLoaded', init);
})();

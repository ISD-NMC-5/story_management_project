/**
 * ghep-truyen.js
 * Logic ghép nhiều file .txt/.epub/.erub thành 1 file duy nhất.
 * Hỗ trợ chọn thư mục, tích chọn file để loại trừ, gợi ý tên, chọn nơi lưu mặc định và xuất EPUB.
 */
(function () {
    'use strict';

    let selectedFiles = []; // { id, name, size, text, checked, fileObj }
    let epubSelectedFiles = []; // { id, name, size, fileObj, checked }
    let mergeSizeRanges = [
        { from: 0, fromUnit: 'KB', to: 100, toUnit: 'KB' },
        { from: 100, fromUnit: 'KB', to: 1, toUnit: 'GB' }
    ];
    let epubSizeRanges = [
        { from: 0, fromUnit: 'KB', to: 100, toUnit: 'KB' },
        { from: 100, fromUnit: 'KB', to: 1, toUnit: 'GB' }
    ];
    let defaultSaveDirHandle = null;
    let mergeNameTouched = false;
    let limitCache = null;

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        const zone = document.getElementById('merge-drop-zone');
        const inputFiles = document.getElementById('input-merge-files');
        const inputFolder = document.getElementById('input-merge-folder');
        const btnPickFiles = document.getElementById('btn-pick-files');
        const btnPickFolder = document.getElementById('btn-pick-folder');
        const btnMerge = document.getElementById('btn-merge');
        const btnPreview = document.getElementById('btn-preview-merge');
        const btnClear = document.getElementById('btn-clear-files');
        const filenameEl = document.getElementById('merge-filename');
        const formatSelect = document.getElementById('merge-format');
        const extLabel = document.getElementById('merge-ext-label');
        const btnPickSaveDir = document.getElementById('btn-pick-save-dir');
        const btnClearSaveDir = document.getElementById('btn-clear-save-dir');
        const btnRefreshLimits = document.getElementById('btn-refresh-limits');

        if (!zone || !inputFiles) return;

        // Tab selection elements
        const btnTabMerge = document.getElementById('btn-tab-merge');
        const btnTabEpub2txt = document.getElementById('btn-tab-epub2txt');
        const containerTabMerge = document.getElementById('container-tab-merge');
        const containerTabEpub2txt = document.getElementById('container-tab-epub2txt');

        if (btnTabMerge && btnTabEpub2txt && containerTabMerge && containerTabEpub2txt) {
            btnTabMerge.addEventListener('click', () => {
                btnTabMerge.classList.add('btn-primary');
                btnTabMerge.classList.remove('btn-secondary');
                btnTabMerge.style.background = '';
                btnTabMerge.style.color = '';
                btnTabMerge.style.border = '';
                
                btnTabEpub2txt.classList.remove('btn-primary');
                btnTabEpub2txt.style.background = 'var(--app-soft)';
                btnTabEpub2txt.style.color = 'var(--app-text)';
                btnTabEpub2txt.style.border = '1px solid var(--app-border)';

                containerTabMerge.style.display = '';
                containerTabEpub2txt.style.display = 'none';
            });

            btnTabEpub2txt.addEventListener('click', () => {
                btnTabEpub2txt.classList.add('btn-primary');
                btnTabEpub2txt.classList.remove('btn-secondary');
                btnTabEpub2txt.style.background = '';
                btnTabEpub2txt.style.color = '';
                btnTabEpub2txt.style.border = '';

                btnTabMerge.classList.remove('btn-primary');
                btnTabMerge.style.background = 'var(--app-soft)';
                btnTabMerge.style.color = 'var(--app-text)';
                btnTabMerge.style.border = '1px solid var(--app-border)';

                containerTabMerge.style.display = 'none';
                containerTabEpub2txt.style.display = '';
            });
        }

        // EPUB controls
        const epubZone = document.getElementById('epub-drop-zone');
        const inputEpubFiles = document.getElementById('input-epub-files');
        const inputEpubFolder = document.getElementById('input-epub-folder');
        const btnPickEpub = document.getElementById('btn-pick-epub');
        const btnPickEpubFolder = document.getElementById('btn-pick-epub-folder');
        const btnEpubStartConvert = document.getElementById('btn-epub-start-convert');
        const btnEpubClearList = document.getElementById('btn-epub-clear-list');
        const epubExportMode = document.getElementById('epub-export-mode');
        const btnEpubPickSaveDir = document.getElementById('btn-epub-pick-save-dir');
        const btnEpubClearSaveDir = document.getElementById('btn-epub-clear-save-dir');

        btnPickEpub && btnPickEpub.addEventListener('click', () => inputEpubFiles.click());
        btnPickEpubFolder && btnPickEpubFolder.addEventListener('click', () => inputEpubFolder.click());

        inputEpubFiles && inputEpubFiles.addEventListener('change', (e) => handleEpubFileInput(e.target.files));
        inputEpubFolder && inputEpubFolder.addEventListener('change', (e) => handleEpubFileInput(e.target.files));

        epubZone && epubZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            epubZone.classList.add('dragover');
        });
        epubZone && epubZone.addEventListener('dragleave', () => epubZone.classList.remove('dragover'));
        epubZone && epubZone.addEventListener('drop', async (e) => {
            e.preventDefault();
            epubZone.classList.remove('dragover');
            await handleEpubDropInput(e.dataTransfer);
        });

        epubExportMode && epubExportMode.addEventListener('change', (e) => {
            const fieldMergedName = document.getElementById('field-epub-merged-name');
            if (fieldMergedName) {
                fieldMergedName.style.display = e.target.value === 'merged' ? '' : 'none';
            }
        });

        btnEpubPickSaveDir && btnEpubPickSaveDir.addEventListener('click', chooseSaveDirectory);
        btnEpubClearSaveDir && btnEpubClearSaveDir.addEventListener('click', clearSaveDirectory);

        btnEpubStartConvert && btnEpubStartConvert.addEventListener('click', doEpubConvert);
        btnEpubClearList && btnEpubClearList.addEventListener('click', clearAllEpub);

        // Load default save directory from IndexedDB
        try {
            defaultSaveDirHandle = await getSavedDirHandle();
            if (defaultSaveDirHandle) {
                updateSaveDirUI(defaultSaveDirHandle.name);
            }
        } catch (err) {
            pushFloatingLog('Không thể tải thư mục lưu mặc định: ' + err.message, 'warning');
        }

        // File pickers
        btnPickFiles && btnPickFiles.addEventListener('click', () => inputFiles.click());
        btnPickFolder && btnPickFolder.addEventListener('click', () => inputFolder.click());

        inputFiles.addEventListener('change', (e) => handleFileInput(e.target.files, false));
        inputFolder.addEventListener('change', (e) => handleFileInput(e.target.files, true));

        // Drag & drop
        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            zone.classList.add('dragover');
        });
        zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
        zone.addEventListener('drop', async (e) => {
            e.preventDefault();
            zone.classList.remove('dragover');
            await handleDropInput(e.dataTransfer);
        });

        // Format selector change
        formatSelect && formatSelect.addEventListener('change', (e) => {
            if (extLabel) extLabel.textContent = '.' + e.target.value;
        });

        // Save directory picker
        btnPickSaveDir && btnPickSaveDir.addEventListener('click', chooseSaveDirectory);
        btnClearSaveDir && btnClearSaveDir.addEventListener('click', clearSaveDirectory);

        // Name change tracking
        filenameEl && filenameEl.addEventListener('input', () => {
            mergeNameTouched = true;
        });

        // Actions
        btnMerge && btnMerge.addEventListener('click', doMerge);
        btnPreview && btnPreview.addEventListener('click', doPreview);
        btnClear && btnClear.addEventListener('click', clearAll);
        btnRefreshLimits && btnRefreshLimits.addEventListener('click', () => renderLimits(true));

        // Initialize size filters
        initSizeFilters();

        // Initial system limits run
        renderLimits(false);
    }

    // ─── IndexedDB Helpers ─────────────────────────────────
    function getDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('StoryManagementDB', 1);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings');
                }
            };
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async function getSavedDirHandle() {
        try {
            const db = await getDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('settings', 'readonly');
                const store = tx.objectStore('settings');
                const req = store.get('defaultSaveDir');
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        } catch (e) {
            return null;
        }
    }

    async function saveDirHandle(handle) {
        try {
            const db = await getDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('settings', 'readwrite');
                const store = tx.objectStore('settings');
                const req = store.put(handle, 'defaultSaveDir');
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        } catch (e) {}
    }

    async function clearDirHandle() {
        try {
            const db = await getDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('settings', 'readwrite');
                const store = tx.objectStore('settings');
                const req = store.delete('defaultSaveDir');
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        } catch (e) {}
    }

    async function verifyPermission(fileHandle, readWrite) {
        const options = {};
        if (readWrite) {
            options.mode = 'readwrite';
        }
        if ((await fileHandle.queryPermission(options)) === 'granted') {
            return true;
        }
        if ((await fileHandle.requestPermission(options)) === 'granted') {
            return true;
        }
        return false;
    }

    // ─── UI / Logger ───────────────────────────────────────
    function pushFloatingLog(message, type = 'info') {
        const container = document.getElementById('floating-logs-container');
        if (!container) return;

        const log = document.createElement('div');
        log.className = `floating-log-item log-${type}`;

        const textSpan = document.createElement('span');
        textSpan.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        log.appendChild(textSpan);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'btn-close-log';
        closeBtn.innerHTML = '✕';
        closeBtn.type = 'button';
        closeBtn.addEventListener('click', () => {
            log.classList.add('fade-out');
            setTimeout(() => log.remove(), 500);
        });
        log.appendChild(closeBtn);

        container.appendChild(log);

        // Auto remove after 20s
        setTimeout(() => {
            if (log.parentNode) {
                log.classList.add('fade-out');
                setTimeout(() => log.remove(), 500);
            }
        }, 20000);
    }

    function updateSaveDirUI(name) {
        const pathEl = document.getElementById('save-dir-path');
        const clearBtn = document.getElementById('btn-clear-save-dir');
        if (pathEl) {
            pathEl.textContent = name ? `📁 ${name}` : 'Tải về trình duyệt (mặc định)';
            pathEl.style.color = name ? 'var(--app-text-strong)' : 'var(--app-muted)';
        }
        if (clearBtn) {
            clearBtn.style.display = name ? 'inline-block' : 'none';
        }

        // Also update EPUB directory UI
        const epubPathEl = document.getElementById('epub-save-dir-path');
        const epubClearBtn = document.getElementById('btn-epub-clear-save-dir');
        if (epubPathEl) {
            epubPathEl.textContent = name ? `📁 ${name}` : 'Tải về trình duyệt (mặc định)';
            epubPathEl.style.color = name ? 'var(--app-text-strong)' : 'var(--app-muted)';
        }
        if (epubClearBtn) {
            epubClearBtn.style.display = name ? 'inline-block' : 'none';
        }
    }

    async function chooseSaveDirectory() {
        if (!window.showDirectoryPicker) {
            pushFloatingLog('Trình duyệt của bạn không hỗ trợ lưu trực tiếp vào thư mục. File sẽ được tải xuống tự động.', 'warning');
            return;
        }
        try {
            const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
            defaultSaveDirHandle = handle;
            await saveDirHandle(handle);
            updateSaveDirUI(handle.name);
            pushFloatingLog(`Đã chọn thư mục lưu mặc định: ${handle.name}`, 'success');
        } catch (err) {
            if (err.name !== 'AbortError') {
                pushFloatingLog('Lỗi chọn thư mục: ' + err.message, 'error');
            }
        }
    }

    async function clearSaveDirectory() {
        defaultSaveDirHandle = null;
        await clearDirHandle();
        updateSaveDirUI(null);
        pushFloatingLog('Đã hủy thư mục lưu mặc định. File sẽ tải xuống qua trình duyệt.', 'info');
    }

    // ─── Input Handling ────────────────────────────────────
    async function handleFileInput(fileList, isFolder) {
        const filtered = Array.from(fileList || []).filter(f =>
            /\.(txt|epub|erub)$/i.test(f.name)
        );

        if (!filtered.length) {
            pushFloatingLog('Không tìm thấy file hợp lệ (.txt, .epub, .erub) để tải lên.', 'warning');
            return;
        }

        let folderName = '';
        if (isFolder && filtered[0].webkitRelativePath) {
            const parts = filtered[0].webkitRelativePath.split('/');
            if (parts.length > 1) folderName = parts[0];
        }

        await processAndAddFiles(filtered, folderName);
    }

    async function handleDropInput(dataTransfer) {
        const files = [];
        const items = dataTransfer.items;
        let topFolderName = '';

        if (items) {
            const entries = [];
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (item.kind === 'file') {
                    const entry = item.webkitGetAsEntry();
                    if (entry) {
                        entries.push(entry);
                        if (entry.isDirectory && !topFolderName) {
                            topFolderName = entry.name;
                        }
                    }
                }
            }

            for (const entry of entries) {
                await scanEntry(entry, files);
            }
        } else {
            const rawFiles = Array.from(dataTransfer.files).filter(f =>
                /\.(txt|epub|erub)$/i.test(f.name)
            );
            files.push(...rawFiles);
        }

        if (!files.length) {
            pushFloatingLog('Không tìm thấy file hợp lệ trong mục thả vào.', 'warning');
            return;
        }

        await processAndAddFiles(files, topFolderName);
    }

    async function scanEntry(entry, fileList) {
        if (entry.isFile) {
            const file = await new Promise((resolve) => entry.file(resolve));
            if (/\.(txt|epub|erub)$/i.test(file.name)) {
                fileList.push(file);
            }
        } else if (entry.isDirectory) {
            const reader = entry.createReader();
            const entries = await new Promise((resolve) => {
                reader.readEntries((res) => resolve(res), () => resolve([]));
            });
            for (const sub of entries) {
                await scanEntry(sub, fileList);
            }
        }
    }

    async function processAndAddFiles(files, parentFolderName) {
        pushFloatingLog(`Đang xử lý ${files.length} file...`, 'info');
        const items = [];

        for (const file of files) {
            try {
                let text = '';
                if (file.name.toLowerCase().endsWith('.txt')) {
                    text = await file.text();
                } else if (/\.(epub|erub)$/i.test(file.name)) {
                    text = await extractEpubText(file);
                }

                items.push({
                    id: Math.random().toString(36).substr(2, 9),
                    name: file.name,
                    size: file.size,
                    text: text,
                    checked: true,
                    fileObj: file
                });
            } catch (err) {
                pushFloatingLog(`Lỗi xử lý file ${file.name}: ${err.message}`, 'error');
            }
        }

        // Sort files naturally
        items.sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
        );

        selectedFiles = [...selectedFiles, ...items];
        
        // Auto fill filename
        const filenameEl = document.getElementById('merge-filename');
        if (filenameEl && !mergeNameTouched) {
            if (parentFolderName) {
                filenameEl.value = sanitizeBasename(parentFolderName);
            } else if (selectedFiles.length > 0) {
                filenameEl.value = sanitizeBasename(stripExt(selectedFiles[0].name));
            }
        }

        pushFloatingLog(`Đã tải lên thành công ${items.length} file.`, 'success');
        renderFileList();
    }

    // Extract text from EPUB
    async function extractEpubText(file) {
        try {
            const zip = await JSZip.loadAsync(file);
            // Search container.xml
            const containerXml = await zip.file('META-INF/container.xml')?.async('string');
            if (!containerXml) {
                return '[(EPUB không có container.xml)]';
            }

            const parser = new DOMParser();
            const containerDoc = parser.parseFromString(containerXml, 'text/xml');
            const opfPath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
            if (!opfPath) return '[(EPUB không xác định được content.opf)]';

            const opfContent = await zip.file(opfPath)?.async('string');
            if (!opfContent) return '[(EPUB thiếu file cấu hình .opf)]';

            const opfDoc = parser.parseFromString(opfContent, 'text/xml');
            
            // Get spin items
            const itemrefs = Array.from(opfDoc.querySelectorAll('spine itemref'));
            const manifestItems = {};
            opfDoc.querySelectorAll('manifest item').forEach(item => {
                manifestItems[item.getAttribute('id')] = item.getAttribute('href');
            });

            const opfDir = opfPath.substring(0, opfPath.lastIndexOf('/') + 1);
            let combinedText = '';

            for (const ref of itemrefs) {
                const idref = ref.getAttribute('idref');
                const relativeHref = manifestItems[idref];
                if (!relativeHref) continue;

                // Resolve path relative to OPF dir
                const fullHref = normalizePath(opfDir + relativeHref);
                const htmlContent = await zip.file(fullHref)?.async('string');
                if (htmlContent) {
                    const doc = parser.parseFromString(htmlContent, 'text/html');
                    // Get body text content
                    const bodyText = doc.body ? doc.body.textContent : doc.documentElement.textContent;
                    combinedText += bodyText.trim() + '\n\n';
                }
            }

            return combinedText.trim();
        } catch (e) {
            return `[(Lỗi trích xuất EPUB: ${e.message})]`;
        }
    }

    function normalizePath(path) {
        const parts = path.split('/');
        const stack = [];
        for (const part of parts) {
            if (part === '.' || part === '') continue;
            if (part === '..') {
                stack.pop();
            } else {
                stack.push(part);
            }
        }
        return stack.join('/');
    }

    // ─── Render ───────────────────────────────────────────
    function renderFileList() {
        const listEl = document.getElementById('merge-file-list');
        const summaryEl = document.getElementById('merge-file-summary');
        const btnMerge = document.getElementById('btn-merge');
        const btnPreview = document.getElementById('btn-preview-merge');

        const totalCount = selectedFiles.length;
        const checkedFiles = selectedFiles.filter(f => f.checked);
        const checkedCount = checkedFiles.length;
        const totalBytes = checkedFiles.reduce((s, f) => s + f.size, 0);

        if (summaryEl) {
            summaryEl.innerHTML = totalCount
                ? `Đã nạp ${totalCount} file · Đang tích chọn <b>${checkedCount}</b> file · Tổng: <b>${formatBytes(totalBytes)}</b>`
                : 'Chưa chọn file';
        }

        if (listEl) {
            listEl.innerHTML = selectedFiles.map((file, i) => `
                <div class="ghep-tach-file-row ${file.checked ? '' : 'file-unchecked'}" draggable="true" data-id="${file.id}" data-index="${i}">
                    <div class="ghep-tach-file-row-left">
                        <input type="checkbox" class="file-checkbox" data-chk-id="${file.id}" ${file.checked ? 'checked' : ''}>
                        <span class="file-name">${i + 1}. ${escapeHtml(file.name)}</span>
                    </div>
                    <span class="file-size">${formatBytes(file.size)}</span>
                    <button type="button" class="btn-delete" data-del-id="${file.id}">✕</button>
                </div>
            `).join('');

            // Checkbox changes
            listEl.querySelectorAll('.file-checkbox').forEach(chk => {
                chk.addEventListener('change', (e) => {
                    const id = e.target.dataset.chkId;
                    const file = selectedFiles.find(f => f.id === id);
                    if (file) {
                        file.checked = e.target.checked;
                        renderFileList();
                        renderLimits(false);
                    }
                });
            });

            // Delete item
            listEl.querySelectorAll('.btn-delete').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const id = e.currentTarget.dataset.delId;
                    selectedFiles = selectedFiles.filter(f => f.id !== id);
                    renderFileList();
                    renderLimits(false);
                });
            });

            setupDragReorder(listEl);
        }

        if (btnMerge) btnMerge.disabled = checkedCount < 1;
        if (btnPreview) btnPreview.disabled = checkedCount < 1;

        renderLimits(false);
    }

    function setupDragReorder(listEl) {
        let draggedId = null;

        listEl.querySelectorAll('.ghep-tach-file-row').forEach(row => {
            row.addEventListener('dragstart', (e) => {
                draggedId = row.dataset.id;
                e.dataTransfer.effectAllowed = 'move';
                row.style.opacity = '0.5';
            });

            row.addEventListener('dragend', () => {
                row.style.opacity = '';
                draggedId = null;
            });

            row.addEventListener('dragover', (e) => {
                e.preventDefault();
                row.style.borderColor = 'var(--app-primary)';
            });

            row.addEventListener('dragleave', () => {
                row.style.borderColor = '';
            });

            row.addEventListener('drop', (e) => {
                e.preventDefault();
                row.style.borderColor = '';
                const targetId = row.dataset.id;
                if (!draggedId || draggedId === targetId) return;

                const draggedIdx = selectedFiles.findIndex(f => f.id === draggedId);
                const targetIdx = selectedFiles.findIndex(f => f.id === targetId);

                const [moved] = selectedFiles.splice(draggedIdx, 1);
                selectedFiles.splice(targetIdx, 0, moved);
                renderFileList();
                pushFloatingLog('Đã sắp xếp lại thứ tự file.', 'info');
            });
        });
    }

    // ─── Actions & Merge ───────────────────────────────────
    function getSeparator() {
        const sel = document.getElementById('merge-separator');
        const val = sel ? sel.value : 'newline2';
        switch (val) {
            case 'newline1': return '\n';
            case 'line': return '\n──────────────\n';
            case 'none': return '';
            default: return '\n\n';
        }
    }

    async function doMerge() {
        const checkedFiles = selectedFiles.filter(f => f.checked);
        if (checkedFiles.length === 0) {
            pushFloatingLog('Không có file nào được chọn để ghép.', 'warning');
            return;
        }

        const formatSelect = document.getElementById('merge-format');
        const format = formatSelect ? formatSelect.value : 'txt';

        const filenameEl = document.getElementById('merge-filename');
        const defaultName = sanitizeBasename(stripExt(checkedFiles[0].name));
        const filename = sanitizeBasename((filenameEl && filenameEl.value.trim()) || defaultName || 'tonghop');

        pushFloatingLog(`Bắt đầu ghép ${checkedFiles.length} file sang định dạng .${format}...`, 'info');

        try {
            let blob;
            if (format === 'txt') {
                const separator = getSeparator();
                const mergedText = checkedFiles.map(f => f.text).join(separator);
                blob = new Blob([mergedText], { type: 'text/plain;charset=utf-8' });
                
                // Warn size
                if (mergedText.length > 5000000) {
                    pushFloatingLog('Cảnh báo: File văn bản ghép lại cực lớn (> 5 triệu ký tự). Có thể gây giật lag khi mở bằng Wordpad/Notepad.', 'warning');
                }
            } else {
                // epub or erub (both generated as standard EPUB zip format)
                blob = await buildEpubBlob(checkedFiles, filename);
            }

            const fullName = `${filename}.${format}`;
            if (defaultSaveDirHandle) {
                // Request permission write
                const hasPermission = await verifyPermission(defaultSaveDirHandle, true);
                if (hasPermission) {
                    const fileHandle = await defaultSaveDirHandle.getFileHandle(fullName, { create: true });
                    const writable = await fileHandle.createWritable();
                    await writable.write(blob);
                    await writable.close();
                    pushFloatingLog(`Đã lưu trực tiếp file thành công vào thư mục mặc định: ${fullName}`, 'success');
                } else {
                    pushFloatingLog('Không có quyền ghi vào thư mục. Chuyển sang tải trực tiếp qua trình duyệt.', 'warning');
                    downloadBlob(blob, fullName);
                }
            } else {
                downloadBlob(blob, fullName);
                pushFloatingLog(`Ghép file thành công! Đã bắt đầu tải xuống: ${fullName}`, 'success');
            }

            // Update preview stats
            updateMergeStats(checkedFiles, format === 'txt' ? checkedFiles.map(f => f.text).join(getSeparator()) : '');
        } catch (e) {
            pushFloatingLog('Lỗi khi ghép file: ' + e.message, 'error');
        }
    }

    async function doPreview() {
        const checkedFiles = selectedFiles.filter(f => f.checked);
        if (checkedFiles.length === 0) {
            pushFloatingLog('Không có file nào được chọn để xem trước.', 'warning');
            return;
        }

        const separator = getSeparator();
        const mergedText = checkedFiles.map(f => f.text).join(separator);

        const previewEl = document.getElementById('merge-preview-text');
        if (previewEl) {
            previewEl.value = mergedText;
        }

        updateMergeStats(checkedFiles, mergedText);
        pushFloatingLog('Đã tạo bản xem trước nội dung thành công.', 'success');
    }

    function updateMergeStats(checkedFiles, mergedText) {
        const resultPanel = document.getElementById('merge-result-panel');
        if (resultPanel) resultPanel.style.display = '';

        const statCount = document.getElementById('stat-file-count');
        const statChars = document.getElementById('stat-total-chars');
        const statSize = document.getElementById('stat-total-size');

        if (statCount) statCount.textContent = checkedFiles.length;
        if (statChars) {
            statChars.textContent = mergedText 
                ? mergedText.length.toLocaleString('vi-VN') + ' ký tự'
                : 'N/A (Sách điện tử)';
        }
        if (statSize) {
            const size = mergedText 
                ? new Blob([mergedText]).size
                : checkedFiles.reduce((s, f) => s + f.size, 0);
            statSize.textContent = formatBytes(size);
        }
    }

    function clearAll() {
        selectedFiles = [];
        mergeNameTouched = false;
        const el = document.getElementById('merge-filename');
        if (el) el.value = 'tonghop';

        const resultPanel = document.getElementById('merge-result-panel');
        if (resultPanel) resultPanel.style.display = 'none';

        renderFileList();
        pushFloatingLog('Đã xóa sạch danh sách file nạp.', 'info');
    }

    // ─── EPUB Builder ──────────────────────────────────────
    async function buildEpubBlob(checkedFiles, title) {
        const zip = new JSZip();

        // 1. mimetype (Must be first, and uncompressed)
        zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

        // 2. container.xml
        zip.file('META-INF/container.xml', `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:opennames:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);

        // 3. Chapters content XHTML
        let manifestItems = '';
        let spineRefs = '';
        let ncxPoints = '';

        checkedFiles.forEach((file, idx) => {
            const chName = `chapter_${idx + 1}`;
            const chTitle = stripExt(file.name);
            const filename = `text/${chName}.xhtml`;

            // Convert paragraphs
            const paragraphs = file.text.split('\n')
                .map(p => p.trim())
                .filter(Boolean)
                .map(p => `<p>${escapeHtml(p)}</p>`)
                .join('\n');

            const xhtmlContent = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${escapeHtml(chTitle)}</title>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <style type="text/css">
    body { font-family: sans-serif; padding: 1em; }
    h1 { text-align: center; margin-bottom: 1.2em; font-size: 1.5em; }
    p { text-indent: 1.5em; margin: 0.5em 0; line-height: 1.5; }
  </style>
</head>
<body>
  <h1>${escapeHtml(chTitle)}</h1>
  ${paragraphs}
</body>
</html>`;

            zip.file(`OEBPS/${filename}`, xhtmlContent);

            manifestItems += `    <item id="${chName}" href="${filename}" media-type="application/xhtml+xml"/>\n`;
            spineRefs += `    <itemref idref="${chName}"/>\n`;
            ncxPoints += `    <navPoint id="${chName}" playOrder="${idx + 1}">
      <navLabel><text>${escapeHtml(chTitle)}</text></navLabel>
      <content src="${filename}"/>
    </navPoint>\n`;
        });

        // 4. content.opf
        const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>${escapeHtml(title)}</dc:title>
    <dc:language>vi</dc:language>
    <dc:identifier id="BookId">urn:uuid:${Math.random().toString(36).substr(2, 12)}</dc:identifier>
    <dc:creator>Story Management app</dc:creator>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
${manifestItems}  </manifest>
  <spine toc="ncx">
${spineRefs}  </spine>
</package>`;

        zip.file('OEBPS/content.opf', opf);

        // 5. toc.ncx
        const ncx = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD NCX 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2013-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="BookId"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle>
    <text>${escapeHtml(title)}</text>
  </docTitle>
  <navMap>
${ncxPoints}  </navMap>
</ncx>`;

        zip.file('OEBPS/toc.ncx', ncx);

        return await zip.generateAsync({ type: 'blob' });
    }


    // ─── EPUB to TXT Converter ─────────────────────────────
    async function handleEpubFileInput(fileList) {
        const filtered = Array.from(fileList || []).filter(f =>
            /\.epub$/i.test(f.name)
        );

        if (!filtered.length) {
            pushFloatingLog('Không tìm thấy file EPUB hợp lệ để tải lên.', 'warning');
            return;
        }

        await processAndAddEpubFiles(filtered);
    }

    async function handleEpubDropInput(dataTransfer) {
        const files = [];
        const items = dataTransfer.items;

        if (items) {
            const entries = [];
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (item.kind === 'file') {
                    const entry = item.webkitGetAsEntry();
                    if (entry) {
                        entries.push(entry);
                    }
                }
            }

            for (const entry of entries) {
                await scanEpubEntry(entry, files);
            }
        } else {
            const rawFiles = Array.from(dataTransfer.files).filter(f =>
                /\.epub$/i.test(f.name)
            );
            files.push(...rawFiles);
        }

        if (!files.length) {
            pushFloatingLog('Không tìm thấy file EPUB hợp lệ trong mục thả vào.', 'warning');
            return;
        }

        await processAndAddEpubFiles(files);
    }

    async function scanEpubEntry(entry, fileList) {
        if (entry.isFile) {
            const file = await new Promise((resolve) => entry.file(resolve));
            if (/\.epub$/i.test(file.name)) {
                fileList.push(file);
            }
        } else if (entry.isDirectory) {
            const reader = entry.createReader();
            const entries = await new Promise((resolve) => {
                reader.readEntries((res) => resolve(res), () => resolve([]));
            });
            for (const sub of entries) {
                await scanEpubEntry(sub, fileList);
            }
        }
    }

    async function processAndAddEpubFiles(files) {
        pushFloatingLog(`Đang xử lý ${files.length} file EPUB...`, 'info');
        const items = [];

        for (const file of files) {
            items.push({
                id: Math.random().toString(36).substr(2, 9),
                name: file.name,
                size: file.size,
                fileObj: file,
                checked: true
            });
        }

        items.sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
        );

        epubSelectedFiles = [...epubSelectedFiles, ...items];
        pushFloatingLog(`Đã tải lên thành công ${items.length} file.`, 'success');
        renderEpubFileList();
    }

    function renderEpubFileList() {
        const listEl = document.getElementById('epub-file-list');
        const summaryEl = document.getElementById('epub-file-summary');
        const btnConvert = document.getElementById('btn-epub-start-convert');

        const totalCount = epubSelectedFiles.length;
        const checkedFiles = epubSelectedFiles.filter(f => f.checked);
        const checkedCount = checkedFiles.length;
        const totalBytes = checkedFiles.reduce((s, f) => s + f.size, 0);

        if (summaryEl) {
            summaryEl.innerHTML = totalCount
                ? `Đã nạp ${totalCount} file EPUB · Đang tích chọn <b>${checkedCount}</b> file · Tổng: <b>${formatBytes(totalBytes)}</b>`
                : 'Chưa chọn file EPUB';
        }

        if (listEl) {
            listEl.innerHTML = epubSelectedFiles.map((file, i) => `
                <div class="ghep-tach-file-row ${file.checked ? '' : 'file-unchecked'}" draggable="true" data-id="${file.id}" data-index="${i}">
                    <div class="ghep-tach-file-row-left">
                        <input type="checkbox" class="epub-file-checkbox" data-chk-id="${file.id}" ${file.checked ? 'checked' : ''}>
                        <span class="file-name">${i + 1}. ${escapeHtml(file.name)}</span>
                    </div>
                    <span class="file-size">${formatBytes(file.size)}</span>
                    <button type="button" class="btn-epub-delete" data-del-id="${file.id}">✕</button>
                </div>
            `).join('');

            listEl.querySelectorAll('.epub-file-checkbox').forEach(chk => {
                chk.addEventListener('change', (e) => {
                    const id = e.target.dataset.chkId;
                    const file = epubSelectedFiles.find(f => f.id === id);
                    if (file) {
                        file.checked = e.target.checked;
                        renderEpubFileList();
                    }
                });
            });

            listEl.querySelectorAll('.btn-epub-delete').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const id = e.currentTarget.dataset.delId;
                    epubSelectedFiles = epubSelectedFiles.filter(f => f.id !== id);
                    renderEpubFileList();
                });
            });

            setupEpubDragReorder(listEl);
        }

        if (btnConvert) btnConvert.disabled = checkedCount < 1;
    }

    function setupEpubDragReorder(listEl) {
        let draggedId = null;

        listEl.querySelectorAll('.ghep-tach-file-row').forEach(row => {
            row.addEventListener('dragstart', (e) => {
                draggedId = row.dataset.id;
                e.dataTransfer.effectAllowed = 'move';
                row.style.opacity = '0.5';
            });

            row.addEventListener('dragend', () => {
                row.style.opacity = '';
                draggedId = null;
            });

            row.addEventListener('dragover', (e) => {
                e.preventDefault();
                row.style.borderColor = 'var(--app-primary)';
            });

            row.addEventListener('dragleave', () => {
                row.style.borderColor = '';
            });

            row.addEventListener('drop', (e) => {
                e.preventDefault();
                row.style.borderColor = '';
                const targetId = row.dataset.id;
                if (!draggedId || draggedId === targetId) return;

                const draggedIdx = epubSelectedFiles.findIndex(f => f.id === draggedId);
                const targetIdx = epubSelectedFiles.findIndex(f => f.id === targetId);

                const [moved] = epubSelectedFiles.splice(draggedIdx, 1);
                epubSelectedFiles.splice(targetIdx, 0, moved);
                renderEpubFileList();
                pushFloatingLog('Đã sắp xếp lại thứ tự file EPUB.', 'info');
            });
        });
    }

    function clearAllEpub() {
        epubSelectedFiles = [];
        const consoleEl = document.getElementById('epub-console-log');
        if (consoleEl) consoleEl.value = '';
        const progressBar = document.getElementById('epub-progress-bar');
        if (progressBar) progressBar.style.width = '0%';
        renderEpubFileList();
        pushFloatingLog('Đã xóa danh sách file EPUB.', 'info');
    }

    function writeEpubConsoleLog(message, isError = false) {
        const consoleEl = document.getElementById('epub-console-log');
        if (consoleEl) {
            const time = new Date().toLocaleTimeString();
            const prefix = isError ? '✗' : '✓';
            consoleEl.value += `[${time}] ${prefix} ${message}\n`;
            consoleEl.scrollTop = consoleEl.scrollHeight;
        }
    }

    function convertTraditionalToSimplified(text) {
        const t = "萬與醜專業叢東絲丟兩嚴喪個豐臨為麗舉麼義烏樂喬習鄉書買亂爭於虧亞產畝親介信俁儔儼倆儷儉債傾儻儺億儀儂優元儲儷兌茲兗黨蘭關興茲寫冬馮減凈凜凝幾鳳憑凱擊剮劉劃劊劍劑勁動務勛勞勢勩勻匭匱區協卻厙叄參雙發疊變敘葉號嘆愛憂傷傳體國歡隨無親寫機屬圖樹敵戰隊辦兒頭點貝車東見風門馬龍龔舊強壯幾國將專尋導盡導尷尷屆歲豈層崗島嶺嶄帥帶帳幀幾龐莊庫慶廬廟開張彈彌彎彥徹徑復微征德憶憂懷態慪憂態懨憐憫懷懸懺懼戀攣摑攪攬支敘敵斂斃斬斷時晉晝暈暉暢暫書會朧東欄樹棲樣檁櫚櫛櫝欄樹檢樣櫛櫝欄樹檢櫛櫝欄樹檢櫛櫝櫝歡歟歐殲殘段殼毀畢毛毿氈氌氣氫氬氣氬水永決沒況滬涇淶淒淺淥淪淵淥淪淶淒淺淥淪淥淪淥";
        const s = "万与丑专业丛东丝丢两严丧个丰临为丽举么义乌乐乔习乡书买乱争于亏亚产亩亲介信俣俦俨俩俪俭债倾傥条亿仪侬优元储俪兑兹兖党兰关兴兹写冬冯减净凛凝几凤凭凯击剐刘划刽剑剂劲动务勋劳势勩匀匭匮区协却厙叄参双发叠变叙叶号叹爱忧伤传体国欢随无亲写机属图树敌战队办儿头点贝车东见风门马龙龚旧强壮几国将专寻导尽导尴尬届岁岂层岗岛岭崭帅带帐帧几庞庄库庆庐庙开张弹弥弯彦彻径复微征德忆忧怀态怄忧态恹怜悯怀悬忏惧恋挛掴搅揽支叙敌敛毙斩断时晋昼晕晖畅暂时书会胧东栏树栖样檩榈栉椟栏树检样栉椟栏树检栉椟栏树检栉椟椟欢欤欧歼残段壳毁毕毛毿毡氌气氢氩气氩水永决没况沪泾涞凄浅渌沦渊渌沦涞凄浅渌沦渌沦渌";
        
        let result = '';
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const idx = t.indexOf(char);
            if (idx !== -1) {
                result += s[idx];
            } else {
                result += char;
            }
        }
        return result;
    }

    async function doEpubConvert() {
        const checkedFiles = epubSelectedFiles.filter(f => f.checked);
        if (checkedFiles.length === 0) {
            pushFloatingLog('Không có file EPUB nào được chọn để chuyển đổi.', 'warning');
            return;
        }

        const exportMode = document.getElementById('epub-export-mode').value;
        const keepChapterName = document.getElementById('chk-epub-keep-chapter-name').checked;
        const addParagraphSpace = document.getElementById('chk-epub-add-paragraph-space').checked;
        const removeBlankLines = document.getElementById('chk-epub-remove-blank-lines').checked;
        const convertT2S = document.getElementById('chk-epub-t2s').checked;
        
        const mergedFilenameEl = document.getElementById('epub-merged-filename');
        const mergedFilename = sanitizeBasename(mergedFilenameEl ? mergedFilenameEl.value.trim() : 'epub_tonghop') + '.txt';

        const consoleEl = document.getElementById('epub-console-log');
        if (consoleEl) consoleEl.value = '';
        
        const progressBar = document.getElementById('epub-progress-bar');
        const progressBarContainer = document.getElementById('epub-progress-bar-container');
        if (progressBarContainer) progressBarContainer.style.display = 'block';
        if (progressBar) progressBar.style.width = '0%';

        writeEpubConsoleLog(`Bắt đầu chuyển đổi ${checkedFiles.length} file EPUB...`);

        const total = checkedFiles.length;
        let mergedTexts = [];

        // Setup save dir permission if available
        let hasPermission = false;
        if (defaultSaveDirHandle) {
            hasPermission = await verifyPermission(defaultSaveDirHandle, true);
        }

        for (let i = 0; i < total; i++) {
            const fileItem = checkedFiles[i];
            const pct = Math.floor((i / total) * 100);
            if (progressBar) progressBar.style.width = `${pct}%`;

            writeEpubConsoleLog(`[${i + 1}/${total}] Đang xử lý: ${fileItem.name}...`);

            try {
                const zip = await JSZip.loadAsync(fileItem.fileObj);
                const containerXml = await zip.file('META-INF/container.xml')?.async('string');
                if (!containerXml) {
                    throw new Error('Không có META-INF/container.xml');
                }

                const parser = new DOMParser();
                const containerDoc = parser.parseFromString(containerXml, 'text/xml');
                const opfPath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
                if (!opfPath) {
                    throw new Error('Không xác định được file OPF');
                }

                const opfContent = await zip.file(opfPath)?.async('string');
                if (!opfContent) {
                    throw new Error('Không đọc được file OPF');
                }

                const opfDoc = parser.parseFromString(opfContent, 'text/xml');
                const itemrefs = Array.from(opfDoc.querySelectorAll('spine itemref'));
                const manifestItems = {};
                opfDoc.querySelectorAll('manifest item').forEach(item => {
                    manifestItems[item.getAttribute('id')] = item.getAttribute('href');
                });

                const opfDir = opfPath.substring(0, opfPath.lastIndexOf('/') + 1);
                
                // Try NCX/nav chapter titles
                let ncxHref = '';
                opfDoc.querySelectorAll('manifest item').forEach(item => {
                    if (item.getAttribute('media-type') === 'application/x-dtbncx+xml') {
                        ncxHref = item.getAttribute('href');
                    }
                });

                const chapterTitles = {};
                if (ncxHref) {
                    const ncxPath = normalizePath(opfDir + ncxHref);
                    const ncxContent = await zip.file(ncxPath)?.async('string');
                    if (ncxContent) {
                        const ncxDoc = parser.parseFromString(ncxContent, 'text/xml');
                        ncxDoc.querySelectorAll('navPoint').forEach(np => {
                            const labelText = np.querySelector('navLabel text')?.textContent;
                            const src = np.querySelector('content')?.getAttribute('src');
                            if (labelText && src) {
                                const cleanSrc = src.split('#')[0];
                                chapterTitles[cleanSrc] = labelText.trim();
                            }
                        });
                    }
                }

                let fileCombinedText = '';

                for (const ref of itemrefs) {
                    const idref = ref.getAttribute('idref');
                    const relativeHref = manifestItems[idref];
                    if (!relativeHref) continue;

                    const fullHref = normalizePath(opfDir + relativeHref);
                    const htmlContent = await zip.file(fullHref)?.async('string');
                    if (htmlContent) {
                        const doc = parser.parseFromString(htmlContent, 'text/html');
                        
                        doc.querySelectorAll('script, style, link, meta').forEach(el => el.remove());

                        let chapterTitle = '';
                        if (keepChapterName) {
                            const relativeSrc = relativeHref.split('#')[0];
                            if (chapterTitles[relativeSrc]) {
                                chapterTitle = chapterTitles[relativeSrc];
                            } else {
                                chapterTitle = doc.querySelector('title')?.textContent || doc.querySelector('h1, h2')?.textContent || '';
                            }
                            chapterTitle = chapterTitle.trim();
                        }

                        let text = '';
                        if (doc.body) {
                            const pEls = doc.body.querySelectorAll('p, div, br, tr');
                            if (pEls.length > 0) {
                                const lines = [];
                                pEls.forEach(el => {
                                    if (el.tagName.toLowerCase() === 'br') {
                                        lines.push('');
                                    } else {
                                        const txt = el.textContent.trim();
                                        if (txt) lines.push(txt);
                                    }
                                });
                                text = lines.join('\n');
                            } else {
                                text = doc.body.textContent || '';
                            }
                        } else {
                            text = doc.documentElement.textContent || '';
                        }

                        if (addParagraphSpace) {
                            text = text.split('\n')
                                       .map(line => line.trim())
                                       .filter(Boolean)
                                       .join('\n\n');
                        } else if (removeBlankLines) {
                            text = text.split('\n')
                                       .map(line => line.trim())
                                       .filter(Boolean)
                                       .join('\n');
                        }

                        if (keepChapterName && chapterTitle) {
                            fileCombinedText += `=== ${chapterTitle} ===\n\n` + text.trim() + '\n\n';
                        } else {
                            fileCombinedText += text.trim() + '\n\n';
                        }
                    }
                }

                let finalResultText = fileCombinedText.trim();
                if (convertT2S) {
                    finalResultText = convertTraditionalToSimplified(finalResultText);
                }

                if (exportMode === 'individual') {
                    const txtFilename = stripExt(fileItem.name) + '.txt';
                    const blob = new Blob([finalResultText], { type: 'text/plain;charset=utf-8' });

                    if (defaultSaveDirHandle && hasPermission) {
                        const fileHandle = await defaultSaveDirHandle.getFileHandle(txtFilename, { create: true });
                        const writable = await fileHandle.createWritable();
                        await writable.write(blob);
                        await writable.close();
                        writeEpubConsoleLog(`Lưu thành công: ${txtFilename}`);
                    } else {
                        downloadBlob(blob, txtFilename);
                        writeEpubConsoleLog(`Tải xuống trình duyệt: ${txtFilename}`);
                    }
                } else {
                    mergedTexts.push(`=== BẮT ĐẦU EPUB: ${stripExt(fileItem.name)} ===\n\n` + finalResultText);
                    writeEpubConsoleLog(`Xử lý xong (chờ gộp): ${fileItem.name}`);
                }

            } catch (err) {
                writeEpubConsoleLog(`${fileItem.name}: Không đọc được EPUB (${err.message})`, true);
            }
        }

        if (progressBar) progressBar.style.width = '100%';

        if (exportMode === 'merged' && mergedTexts.length > 0) {
            const finalMergedText = mergedTexts.join('\n\n=========================================\n\n');
            const blob = new Blob([finalMergedText], { type: 'text/plain;charset=utf-8' });

            if (defaultSaveDirHandle && hasPermission) {
                const fileHandle = await defaultSaveDirHandle.getFileHandle(mergedFilename, { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(blob);
                await writable.close();
                writeEpubConsoleLog(`Lưu file gộp thành công: ${mergedFilename}`);
            } else {
                downloadBlob(blob, mergedFilename);
                writeEpubConsoleLog(`Tải xuống file gộp qua trình duyệt: ${mergedFilename}`);
            }
        }

        writeEpubConsoleLog('--- Hoàn tất quá trình chuyển đổi ---');
        pushFloatingLog('Đã hoàn tất chuyển đổi toàn bộ file EPUB!', 'success');
    }

    // ─── Limit Measurement ────────────────────────────────
    async function collectLimits(force = false) {
        if (limitCache && !force) return limitCache;

        // Measure localstorage
        const testKey = '__storage_estimate_test__';
        let lsCapacity = 5 * 1024 * 1024; // fallback
        try {
            localStorage.removeItem(testKey);
            let low = 0, high = 12 * 1024 * 1024, best = 0;
            while (low <= high) {
                const mid = Math.floor((low + high) / 2);
                try {
                    localStorage.setItem(testKey, 'x'.repeat(mid));
                    best = mid;
                    low = mid + 1;
                } catch {
                    high = mid - 1;
                }
            }
            localStorage.removeItem(testKey);
            if (best) lsCapacity = best;
        } catch {}

        let storageEstimate = null;
        if (navigator.storage && navigator.storage.estimate) {
            try {
                storageEstimate = await navigator.storage.estimate();
            } catch {}
        }

        limitCache = {
            lsCapacity,
            storageEstimate,
            jsStringTheoretical: 536870912
        };
        return limitCache;
    }

    async function renderLimits(force = false) {
        const container = document.getElementById('system-limits-info');
        if (!container) return;

        const limits = await collectLimits(force);
        const quotaInfo = limits.storageEstimate
            ? `Quota trình duyệt: <b>${formatBytes(limits.storageEstimate.quota)}</b> · Đã dùng <b>${formatBytes(limits.storageEstimate.usage)}</b>.`
            : 'Trình duyệt không báo Storage Quota.';

        // Calculate current active chars
        const checkedFiles = selectedFiles.filter(f => f.checked);
        const totalChars = checkedFiles.reduce((s, f) => s + f.text.length, 0);

        let warnClass = '';
        let safetyHint = 'Dung lượng an toàn cho Notepad/Word.';
        if (totalChars > 2000000) {
            warnClass = 'warn';
            safetyHint = 'Khuyên dùng: Bạn nên tách nhỏ hoặc xuất EPUB để mở mượt mà.';
        }

        container.innerHTML = `
            <div class="limit-card highlight">
                <strong>Tổng ký tự ghép (hiện tại)</strong>
                <span><b>${totalChars.toLocaleString('vi-VN')}</b> ký tự.<br>Tổng số file đã tích: <b>${checkedFiles.length}</b>.</span>
            </div>
            <div class="limit-card">
                <strong>Giới hạn lý thuyết JS</strong>
                <span>Giới hạn chuỗi JS: <b>536.87 triệu ký tự</b>.<br>Hỗ trợ ghép lượng file văn bản cực lớn.</span>
            </div>
            <div class="limit-card ${warnClass}">
                <strong>Gợi ý an toàn đầu ra</strong>
                <span>Nên xuất &lt; 2.00 triệu ký tự/file TXT.<br>${safetyHint}</span>
            </div>
            <div class="limit-card">
                <strong>Bộ nhớ trình duyệt</strong>
                <span>localStorage tối đa: ~<b>${formatBytes(limits.lsCapacity)}</b>.<br>${quotaInfo}</span>
            </div>
        `;
    }

    // ─── File Size Filtering ───────────────────────────────
    function initSizeFilters() {
        setupSizeFilter('merge');
        setupSizeFilter('epub');
    }

    function setupSizeFilter(tab) {
        const toggleBtn = document.getElementById(`btn-toggle-size-filter-${tab}`);
        const contentDiv = document.getElementById(`size-filter-content-${tab}`);
        const indicator = document.getElementById(`indicator-size-filter-${tab}`);
        const container = document.getElementById(`size-ranges-container-${tab}`);
        const btnAddRange = document.getElementById(`btn-add-range-${tab}`);
        const btnApply = document.getElementById(`btn-apply-filter-${tab}`);
        const btnClear = document.getElementById(`btn-clear-filter-${tab}`);

        if (!toggleBtn || !contentDiv) return;

        // Toggle collapse
        toggleBtn.addEventListener('click', () => {
            const isHidden = contentDiv.style.display === 'none';
            contentDiv.style.display = isHidden ? 'block' : 'none';
            if (indicator) {
                indicator.textContent = isHidden ? 'Ẩn ▲' : 'Hiện ▼';
            }
        });

        const ranges = tab === 'merge' ? mergeSizeRanges : epubSizeRanges;

        function renderRanges() {
            container.innerHTML = '';
            ranges.forEach((range, idx) => {
                const row = document.createElement('div');
                row.className = 'size-range-row';
                row.innerHTML = `
                    <span class="size-range-label">Phạm vi ${idx + 1}</span>
                    <div class="size-range-inputs">
                        <span>Từ:</span>
                        <input type="number" class="range-from" min="0" value="${range.from}" data-idx="${idx}">
                        <select class="range-from-unit" data-idx="${idx}">
                            <option value="KB" ${range.fromUnit === 'KB' ? 'selected' : ''}>KB</option>
                            <option value="MB" ${range.fromUnit === 'MB' ? 'selected' : ''}>MB</option>
                            <option value="GB" ${range.fromUnit === 'GB' ? 'selected' : ''}>GB</option>
                        </select>
                        <span>Đến:</span>
                        <input type="number" class="range-to" min="0" value="${range.to}" data-idx="${idx}">
                        <select class="range-to-unit" data-idx="${idx}">
                            <option value="KB" ${range.toUnit === 'KB' ? 'selected' : ''}>KB</option>
                            <option value="MB" ${range.toUnit === 'MB' ? 'selected' : ''}>MB</option>
                            <option value="GB" ${range.toUnit === 'GB' ? 'selected' : ''}>GB</option>
                        </select>
                    </div>
                    ${ranges.length > 1 ? `<button type="button" class="btn-delete-range" data-idx="${idx}">✕</button>` : ''}
                `;

                // Event listeners for inputs
                row.querySelector('.range-from').addEventListener('input', (e) => {
                    range.from = parseFloat(e.target.value) || 0;
                });
                row.querySelector('.range-from-unit').addEventListener('change', (e) => {
                    range.fromUnit = e.target.value;
                });
                row.querySelector('.range-to').addEventListener('input', (e) => {
                    range.to = parseFloat(e.target.value) || 0;
                });
                row.querySelector('.range-to-unit').addEventListener('change', (e) => {
                    range.toUnit = e.target.value;
                });

                if (ranges.length > 1) {
                    row.querySelector('.btn-delete-range').addEventListener('click', () => {
                        ranges.splice(idx, 1);
                        renderRanges();
                    });
                }

                container.appendChild(row);
            });
        }

        btnAddRange.addEventListener('click', () => {
            let nextFrom = 0;
            let nextFromUnit = 'KB';
            if (ranges.length > 0) {
                const last = ranges[ranges.length - 1];
                nextFrom = last.to;
                nextFromUnit = last.toUnit;
            }
            ranges.push({
                from: nextFrom,
                fromUnit: nextFromUnit,
                to: nextFrom * 10 || 100,
                toUnit: nextFromUnit
            });
            renderRanges();
        });

        btnApply.addEventListener('click', () => {
            applySizeFilter(tab);
        });

        btnClear.addEventListener('click', () => {
            clearSizeFilter(tab);
        });

        renderRanges();
    }

    function parseToBytes(value, unit) {
        const factor = {
            'KB': 1024,
            'MB': 1024 * 1024,
            'GB': 1024 * 1024 * 1024
        };
        return value * (factor[unit] || 1);
    }

    function applySizeFilter(tab) {
        const ranges = tab === 'merge' ? mergeSizeRanges : epubSizeRanges;
        const fileList = tab === 'merge' ? selectedFiles : epubSelectedFiles;

        if (fileList.length === 0) {
            pushFloatingLog('Danh sách file trống, không có gì để lọc.', 'warning');
            return;
        }

        let matchCount = 0;
        fileList.forEach(file => {
            const sizeInBytes = file.size;
            const matches = ranges.some(range => {
                const fromBytes = parseToBytes(range.from, range.fromUnit);
                const toBytes = parseToBytes(range.to, range.toUnit);
                return sizeInBytes >= fromBytes && sizeInBytes <= toBytes;
            });
            file.checked = matches;
            if (matches) matchCount++;
        });

        if (tab === 'merge') {
            renderFileList();
        } else {
            renderEpubFileList();
        }

        pushFloatingLog(`Đã áp dụng bộ lọc: Tích chọn ${matchCount} file phù hợp kích thước.`, 'success');
    }

    function clearSizeFilter(tab) {
        const fileList = tab === 'merge' ? selectedFiles : epubSelectedFiles;
        if (fileList.length === 0) return;

        fileList.forEach(file => {
            file.checked = true;
        });

        if (tab === 'merge') {
            renderFileList();
        } else {
            renderEpubFileList();
        }

        pushFloatingLog('Đã tích chọn lại tất cả các file.', 'info');
    }

    // ─── Helpers ──────────────────────────────────────────
    function stripExt(name) {
        return String(name || '').replace(/\.[^/.]+$/, '');
    }

    function sanitizeBasename(name) {
        return String(name || '')
            .replace(/[\\/:*?"<>|]/g, '_')
            .replace(/\s+/g, ' ')
            .trim() || 'tonghop';
    }

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

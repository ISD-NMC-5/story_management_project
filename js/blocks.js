/**
 * blocks.js
 * Hệ thống Block tạm trong bộ nhớ cho ứng dụng.
 */

(function () {
    const STORAGE_KEY = 'story-blocks-project';
    const CLIPBOARD_HISTORY_KEY = 'story-clipboard-history';
    const AUTOSAVE_DELAY = 500;
    const MAX_HISTORY = 100;
    const MAX_CLIPBOARD_HISTORY = 80;
    let autosaveTimer = null;
    let undoStack = [];
    let redoStack = [];
    let historySessionActive = false;
    let historySessionTimer = null;
    let clipboardPreviewBlocks = [];
    let lastSeenClipboardText = '';
    let lastAppendText = '';
    let lastAppendTime = 0;
    let clipboardAutoCaptureReady = false;
    let clipboardPanelOpen = false;
    let clipboardPollTimer = null;
    let lastListClickIndex = -1;
    let cachedLocalStorageLimitBytes = null;
    const LS_LIMIT_CACHE_KEY = 'story-ls-limit-cache';
    const VIRTUAL_SCROLL_THRESHOLD = 60;
    const BLOCK_ITEM_HEIGHT = 76;
    const BLOCK_LIST_OVERSCAN = 5;
    const EDITOR_CLEAR_KEY = 'story-editor-clear-after-save';
    let duplicateMap = new Map();
    let duplicatePairs = [];
    let listScrollBound = false;
    let listRenderRaf = null;

    window.BlockSystem = {
        blocks: [],
        selectedId: null,
        init,
        addBlock,
        setBlocks,
        render,
        saveProject,
        openProjectFile,
        undoLastAction,
        redoLastAction,
        exportTxt,
        exportDocx,
        pasteQuick,
        loadClipboardBlocks,
        addClipboardBlock,
        addSelectedClipboardBlocks,
        splitAtCursor,
        mergeWithPrevious,
        mergeWithNext,
        duplicateBlock,
        renameBlock,
        removeBlock,
        downloadBlockFile,
        downloadSelectedBlocks,
        toggleSelectedBlock
    };

    function init() {
        const listEl = document.getElementById('block-list');
        const editorEl = document.getElementById('block-editor');
        const titleEl = document.getElementById('block-editor-title');
        const btnSave = document.getElementById('btn-save-block');
        const btnPaste = document.getElementById('btn-paste-quick');
        const btnAddBlock = document.getElementById('btn-add-block');
        const btnAddBlockSidebar = document.getElementById('btn-add-block-sidebar');
        const btnClipboardBlocksSidebar = document.getElementById('btn-clipboard-blocks-sidebar');
        const btnSaveProject = document.getElementById('btn-save-project');
        const btnOpenProject = document.getElementById('btn-open-project');
        const inputOpenProject = document.getElementById('input-open-project');
        const btnUndoBlock = document.getElementById('btn-undo-block');
        const btnRedoBlock = document.getElementById('btn-redo-block');
        const btnClipboardBlocks = document.getElementById('btn-clipboard-blocks');
        const btnExportTxt = document.getElementById('btn-export-txt');
        const btnExportDocx = document.getElementById('btn-export-docx');
        const btnSplitAtCursor = document.getElementById('btn-split-at-cursor');
        const btnMergePrev = document.getElementById('btn-merge-prev');
        const btnMergeNext = document.getElementById('btn-merge-next');
        const btnDownloadBlockFile = document.getElementById('btn-download-block-file');
        const btnDownloadSelectedBlocks = document.getElementById('btn-download-selected-blocks');
        const btnDownloadSelectedBlocksSidebar = document.getElementById('btn-download-selected-blocks-sidebar');
        const chkLimitChars = document.getElementById('chk-limit-chars');
        const inputCharLimit = document.getElementById('export-char-limit');

        // New sidebar controls
        const chkSelectAllBlocks = document.getElementById('chk-select-all-blocks');
        const btnClearBlockSelection = document.getElementById('btn-clear-block-selection');
        const btnImportFilesTrigger = document.getElementById('btn-import-files-trigger');
        const inputImportFiles = document.getElementById('input-import-files');
        const btnDeleteSelectedBlocks = document.getElementById('btn-delete-selected-blocks');
        const btnClearAllBlocks = document.getElementById('btn-clear-all-blocks');

        if (!listEl || !editorEl) return;

        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed.blocks)) {
                    window.BlockSystem.blocks = parsed.blocks.map(normalizeBlock);
                }
            } catch (e) {
                console.warn('Không đọc được project.json cũ:', e);
            }
        }

        if (!window.BlockSystem.blocks.length) {
            window.BlockSystem.blocks = [createBlock(getDefaultBlockTitle(0), '')];
        }

        window.BlockSystem.selectedId = window.BlockSystem.blocks[0].id;
        window.BlockSystem.selectedDownloadIds = new Set();

        listEl.addEventListener('dragstart', (e) => {
            const item = e.target.closest('.block-item');
            if (!item) return;
            e.dataTransfer.setData('text/plain', item.dataset.id);
            item.classList.add('dragging');
        });

        listEl.addEventListener('dragend', (e) => {
            const item = e.target.closest('.block-item');
            if (item) item.classList.remove('dragging');
        });

        listEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            const item = e.target.closest('.block-item');
            if (item) item.classList.add('drag-over');
        });

        listEl.addEventListener('dragleave', (e) => {
            const item = e.target.closest('.block-item');
            if (item) item.classList.remove('drag-over');
        });

        listEl.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const draggedId = e.dataTransfer.getData('text/plain');
            const target = e.target.closest('.block-item');
            if (!draggedId || !target) return;
            reorderBlocks(draggedId, target.dataset.id);
            render();
            showToast('Đã đổi thứ tự block.', 'success', 2000);
        });

        listEl.addEventListener('click', (e) => {
            const actionBtn = e.target.closest('[data-action]');
            if (!actionBtn) return;
            const id = actionBtn.closest('.block-item').dataset.id;
            const action = actionBtn.dataset.action;

            if (action === 'toggle-select') {
                window.BlockSystem.toggleSelectedBlock(id);
                return;
            }

            if (action === 'edit') {
                saveEditorToSelectedBlock();
                selectBlock(id);
                editorEl.classList.remove('hidden');
            }
            if (action === 'rename') {
                renameBlock(id);
            }
            if (action === 'delete') {
                removeBlock(id);
            }
            if (action === 'duplicate') {
                duplicateBlock(id);
            }
            if (action === 'merge-prev') {
                mergeWithPrevious(id);
            }
            if (action === 'merge-next') {
                mergeWithNext(id);
            }
            if (action === 'download') {
                downloadBlockFile(id);
            }
        });

        listEl.addEventListener('click', (e) => {
            const item = e.target.closest('.block-item');
            if (!item) return;
            if (e.target.closest('button')) return;
            if (e.target.closest('[data-action="toggle-select"]')) return;

            const id = item.dataset.id;
            const index = window.BlockSystem.blocks.findIndex(block => block.id === id);
            if (index === -1) return;

            saveEditorToSelectedBlock();

            if (e.shiftKey && lastListClickIndex >= 0) {
                const start = Math.min(lastListClickIndex, index);
                const end = Math.max(lastListClickIndex, index);
                for (let i = start; i <= end; i++) {
                    window.BlockSystem.selectedDownloadIds.add(window.BlockSystem.blocks[i].id);
                }
                lastListClickIndex = index;
                selectBlock(id);
                showToast(`Đã chọn ${end - start + 1} block liên tiếp.`, 'info', 1800);
                return;
            }

            if (e.ctrlKey || e.metaKey) {
                if (window.BlockSystem.selectedDownloadIds.has(id)) {
                    window.BlockSystem.selectedDownloadIds.delete(id);
                } else {
                    window.BlockSystem.selectedDownloadIds.add(id);
                }
                lastListClickIndex = index;
                selectBlock(id);
                return;
            }

            lastListClickIndex = index;
            selectBlock(id);
            editorEl.classList.remove('hidden');
        });

        btnSave.addEventListener('click', () => {
            const block = getSelectedBlock();
            if (!block) return;
            const hadContent = Boolean(editorEl.value.trim());
            pushHistory('lưu block');
            block.title = titleEl.value.trim() || 'Block mới';
            block.content = editorEl.value;
            block.characterCount = block.content.length;
            persist();
            render();
            showToast('Đã lưu block', 'success');

            const chkClear = document.getElementById('chk-editor-clear-after-save');
            if (chkClear?.checked && hadContent) {
                addBlock('', '', { silent: true });
                showToast('Đã tạo block trống mới — dán nội dung tiếp theo.', 'info', 2600);
            }
        });

        const chkEditorClear = document.getElementById('chk-editor-clear-after-save');
        if (chkEditorClear) {
            const savedClear = localStorage.getItem(EDITOR_CLEAR_KEY);
            if (savedClear !== null) chkEditorClear.checked = savedClear === '1';
            chkEditorClear.addEventListener('change', () => {
                localStorage.setItem(EDITOR_CLEAR_KEY, chkEditorClear.checked ? '1' : '0');
            });
        }

        titleEl.addEventListener('input', scheduleAutosave);
        editorEl.addEventListener('input', scheduleAutosave);

        btnPaste.addEventListener('click', () => window.BlockSystem.pasteQuick());

        const quickPasteInstant = document.getElementById('input-quick-paste-instant');
        if (quickPasteInstant) {
            quickPasteInstant.addEventListener('input', (e) => {
                const text = quickPasteInstant.value;
                if (!text || !text.trim()) return;
                
                saveEditorToSelectedBlock();
                
                pushHistory('nhập nhanh tức thì');
                const parsed = parseClipboardToBlocks(text);
                if (parsed.length > 0) {
                    const startIndex = window.BlockSystem.blocks.length;
                    const newBlocks = parsed.map((entry, offset) =>
                        createBlockFromClipboardEntry(entry, startIndex + offset)
                    );
                    window.BlockSystem.blocks.push(...newBlocks);
                    window.BlockSystem.selectedId = newBlocks[newBlocks.length - 1].id;
                    persist();
                    render();
                    showToast(`Đã tạo nhanh ${newBlocks.length} block mới.`, 'success');
                } else {
                    const cleanText = text.replace(/\r\n/g, '\n');
                    const title = inferBlockTitle(cleanText, getDefaultBlockTitle(window.BlockSystem.blocks.length));
                    const block = createBlock(title, cleanText);
                    window.BlockSystem.blocks.push(block);
                    window.BlockSystem.selectedId = block.id;
                    persist();
                    render();
                    showToast('Đã tạo nhanh Block mới.', 'success');
                }
                
                quickPasteInstant.value = '';
                quickPasteInstant.blur();
                setTimeout(() => quickPasteInstant.focus(), 50);
            });
        }
        btnAddBlock.addEventListener('click', () => addBlock());
        btnAddBlockSidebar && btnAddBlockSidebar.addEventListener('click', () => addBlock());
        btnClipboardBlocksSidebar && btnClipboardBlocksSidebar.addEventListener('click', () => openClipboardPanel(true));
        btnSaveProject.addEventListener('click', () => window.BlockSystem.saveProject());
        btnOpenProject && btnOpenProject.addEventListener('click', () => inputOpenProject && inputOpenProject.click());
        inputOpenProject && inputOpenProject.addEventListener('change', (e) => window.BlockSystem.openProjectFile(e.target.files && e.target.files[0], e.target));
        btnUndoBlock && btnUndoBlock.addEventListener('click', () => window.BlockSystem.undoLastAction());
        btnRedoBlock && btnRedoBlock.addEventListener('click', () => window.BlockSystem.redoLastAction());
        btnClipboardBlocks && btnClipboardBlocks.addEventListener('click', () => openClipboardPanel(true));
        btnExportTxt.addEventListener('click', () => window.BlockSystem.exportTxt());
        btnExportDocx.addEventListener('click', () => window.BlockSystem.exportDocx());
        btnSplitAtCursor.addEventListener('click', () => window.BlockSystem.splitAtCursor());
        btnMergePrev.addEventListener('click', () => window.BlockSystem.mergeWithPrevious(window.BlockSystem.selectedId));
        btnMergeNext.addEventListener('click', () => window.BlockSystem.mergeWithNext(window.BlockSystem.selectedId));
        btnDownloadBlockFile && btnDownloadBlockFile.addEventListener('click', () => window.BlockSystem.downloadBlockFile(window.BlockSystem.selectedId));
        btnDownloadSelectedBlocks && btnDownloadSelectedBlocks.addEventListener('click', () => window.BlockSystem.downloadSelectedBlocks());
        btnDownloadSelectedBlocksSidebar && btnDownloadSelectedBlocksSidebar.addEventListener('click', () => window.BlockSystem.downloadSelectedBlocks());
        chkLimitChars && chkLimitChars.addEventListener('change', updateWorkspaceStats);
        inputCharLimit && inputCharLimit.addEventListener('input', updateWorkspaceStats);

        // Event listeners for checkbox controls
        chkSelectAllBlocks && chkSelectAllBlocks.addEventListener('change', (e) => {
            const checked = e.target.checked;
            if (checked) {
                window.BlockSystem.blocks.forEach(block => {
                    window.BlockSystem.selectedDownloadIds.add(block.id);
                });
                showToast(`Đã tích tất cả ${window.BlockSystem.blocks.length} block.`, 'info', 2000);
            } else {
                window.BlockSystem.selectedDownloadIds.clear();
                showToast('Đã bỏ tích tất cả block.', 'info', 2000);
            }
            render();
        });

        btnClearBlockSelection && btnClearBlockSelection.addEventListener('click', () => {
            window.BlockSystem.selectedDownloadIds.clear();
            if (chkSelectAllBlocks) chkSelectAllBlocks.checked = false;
            render();
            showToast('Đã bỏ tích chọn block.', 'info', 2000);
        });

        // Event listeners for import/delete controls
        btnImportFilesTrigger && btnImportFilesTrigger.addEventListener('click', () => inputImportFiles.click());
        inputImportFiles && inputImportFiles.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files).filter(f => f.name.toLowerCase().endsWith('.txt'));
            if (files.length === 0) return;

            const clearOld = window.confirm("Bạn có muốn xóa sạch các block hiện tại trước khi nhập file mới không?");
            pushHistory('nhập file');
            if (clearOld) {
                window.BlockSystem.blocks = [];
                window.BlockSystem.selectedDownloadIds.clear();
            }

            files.sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true, sensitivity: 'base'}));

            for (const file of files) {
                const text = await file.text();
                const title = file.name.replace(/\.txt$/i, '');
                const block = createBlock(title, text);
                window.BlockSystem.blocks.push(block);
            }

            if (window.BlockSystem.blocks.length > 0) {
                window.BlockSystem.selectedId = window.BlockSystem.blocks[window.BlockSystem.blocks.length - 1].id;
            }

            e.target.value = '';
            persist();
            render();
            showToast(`Đã nhập thành công ${files.length} block mới.`, 'success');
        });

        btnDeleteSelectedBlocks && btnDeleteSelectedBlocks.addEventListener('click', () => {
            const idsToDelete = Array.from(window.BlockSystem.selectedDownloadIds || []);
            if (idsToDelete.length === 0) {
                showToast('Chưa tích chọn block nào để xóa.', 'warning');
                return;
            }
            if (!window.confirm(`Bạn có chắc muốn xóa ${idsToDelete.length} block đã chọn?`)) return;

            pushHistory('xóa block đã chọn');
            window.BlockSystem.blocks = window.BlockSystem.blocks.filter(block => !idsToDelete.includes(block.id));
            window.BlockSystem.selectedDownloadIds.clear();
            if (chkSelectAllBlocks) chkSelectAllBlocks.checked = false;

            if (!window.BlockSystem.blocks.length) {
                window.BlockSystem.blocks = [createBlock(getDefaultBlockTitle(0), '')];
            }
            if (!window.BlockSystem.blocks.find(b => b.id === window.BlockSystem.selectedId)) {
                window.BlockSystem.selectedId = window.BlockSystem.blocks[0].id;
            }
            persist();
            render();
            showToast('Đã xóa các block được chọn.', 'success');
        });

        btnClearAllBlocks && btnClearAllBlocks.addEventListener('click', () => {
            if (!window.confirm('Bạn có chắc chắn muốn xóa sạch TOÀN BỘ các block?')) return;
            pushHistory('xóa sạch');
            window.BlockSystem.blocks = [createBlock(getDefaultBlockTitle(0), '')];
            window.BlockSystem.selectedId = window.BlockSystem.blocks[0].id;
            window.BlockSystem.selectedDownloadIds.clear();
            if (chkSelectAllBlocks) chkSelectAllBlocks.checked = false;
            persist();
            render();
            showToast('Đã xóa sạch không gian làm việc.', 'success');
        });

        loadClipboardHistory();
        setupUnifiedFileTools();
        setupClipboardPanel();
        setupClipboardWatcher();
        setupTextDropZone();
        setupSettingsModal();
        setupDuplicateFinder();
        setupKeyboardShortcuts();
        ensureListScrollHandler();
        render();
        renderClipboardPanel();
        scheduleDuplicateScan(false);
    }

    function ensureListScrollHandler() {
        if (listScrollBound) return;
        const listEl = document.getElementById('block-list');
        if (!listEl) return;
        listEl.addEventListener('scroll', () => {
            if (window.BlockSystem.blocks.length < VIRTUAL_SCROLL_THRESHOLD) return;
            if (listRenderRaf) cancelAnimationFrame(listRenderRaf);
            listRenderRaf = requestAnimationFrame(() => renderBlockList());
        }, { passive: true });
        listScrollBound = true;
    }

    function setupDuplicateFinder() {
        const btnScan = document.getElementById('btn-scan-duplicates');
        const thresholdEl = document.getElementById('duplicate-threshold');
        const labelEl = document.getElementById('duplicate-threshold-label');
        const resultsEl = document.getElementById('duplicate-results');

        thresholdEl && thresholdEl.addEventListener('input', () => {
            if (labelEl) labelEl.textContent = `${thresholdEl.value}%`;
        });

        btnScan && btnScan.addEventListener('click', () => {
            const threshold = Number(thresholdEl?.value || 90);
            scheduleDuplicateScan(true, threshold);
        });

        resultsEl && resultsEl.addEventListener('click', (e) => {
            const row = e.target.closest('[data-dup-index]');
            if (!row) return;
            const index = Number(row.dataset.dupIndex);
            const block = window.BlockSystem.blocks[index];
            if (!block) return;
            selectBlock(block.id);
            showToast(`Đã mở Block #${index + 1}`, 'info', 1800);
        });
    }

    function normalizeForCompare(text) {
        return String(text || '').replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function bigramSimilarity(s1, s2) {
        if (s1 === s2) return 1;
        if (!s1 || !s2) return 0;
        const toBigrams = (s) => {
            const set = new Set();
            for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
            return set;
        };
        const a = toBigrams(s1);
        const b = toBigrams(s2);
        let inter = 0;
        a.forEach(bg => { if (b.has(bg)) inter++; });
        return (2 * inter) / (a.size + b.size) || 0;
    }

    function computeSimilarityPercent(contentA, contentB) {
        const na = normalizeForCompare(contentA);
        const nb = normalizeForCompare(contentB);
        if (!na && !nb) return 100;
        if (na === nb) return 100;
        if (!na || !nb) return 0;
        const lenRatio = Math.min(na.length, nb.length) / Math.max(na.length, nb.length);
        if (lenRatio < 0.55) return Math.round(lenRatio * 40);
        return Math.round(bigramSimilarity(na, nb) * 100);
    }

    async function scanDuplicateBlocks(threshold = 90) {
        const blocks = window.BlockSystem.blocks;
        const pairs = [];
        duplicateMap.clear();

        const entries = blocks.map((block, index) => {
            const normalized = normalizeForCompare(block.content);
            return { index, normalized, length: normalized.length };
        });

        const exactMap = new Map();
        entries.forEach(entry => {
            if (!entry.normalized) return;
            if (exactMap.has(entry.normalized)) {
                pairs.push({ a: exactMap.get(entry.normalized), b: entry.index, percent: 100 });
            } else {
                exactMap.set(entry.normalized, entry.index);
            }
        });

        const buckets = new Map();
        entries.forEach(entry => {
            if (!entry.normalized) return;
            const key = Math.floor(entry.length / 500);
            if (!buckets.has(key)) buckets.set(key, []);
            buckets.get(key).push(entry);
        });

        const bucketKeys = Array.from(buckets.keys());
        let bucketIdx = 0;

        while (bucketIdx < bucketKeys.length) {
            const group = buckets.get(bucketKeys[bucketIdx]);
            for (let i = 0; i < group.length; i++) {
                for (let j = i + 1; j < group.length; j++) {
                    const A = group[i];
                    const B = group[j];
                    const lenRatio = Math.min(A.length, B.length) / Math.max(A.length, B.length);
                    if (lenRatio < 0.65) continue;

                    const sampleA = A.normalized.slice(0, 280);
                    const sampleB = B.normalized.slice(0, 280);
                    if (sampleA !== sampleB && bigramSimilarity(sampleA, sampleB) < 0.45 && lenRatio < 0.88) {
                        continue;
                    }

                    const percent = computeSimilarityPercent(blocks[A.index].content, blocks[B.index].content);
                    if (percent >= threshold) {
                        pairs.push({ a: A.index, b: B.index, percent });
                    }
                }
            }
            bucketIdx++;
            if (bucketIdx % 3 === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        pairs.sort((x, y) => y.percent - x.percent);
        duplicatePairs = pairs;

        pairs.forEach(pair => {
            const existingA = duplicateMap.get(blocks[pair.a].id);
            const existingB = duplicateMap.get(blocks[pair.b].id);
            if (!existingA || pair.percent > existingA.percent) {
                duplicateMap.set(blocks[pair.a].id, { partnerIndex: pair.b, percent: pair.percent });
            }
            if (!existingB || pair.percent > existingB.percent) {
                duplicateMap.set(blocks[pair.b].id, { partnerIndex: pair.a, percent: pair.percent });
            }
        });

        return pairs;
    }

    function scheduleDuplicateScan(showToastOnDone = true, threshold = 90) {
        const resultsEl = document.getElementById('duplicate-results');
        if (showToastOnDone && resultsEl) {
            resultsEl.innerHTML = '<p class="muted duplicate-empty">Đang quét block giống nhau...</p>';
        }

        const started = performance.now();
        scanDuplicateBlocks(threshold).then(pairs => {
            renderDuplicateResults(pairs);
            renderBlockList();
            updateDuplicateSummary();
            const elapsed = Math.round(performance.now() - started);
            if (showToastOnDone) {
                if (pairs.length) {
                    showToast(`Tìm thấy ${pairs.length} cặp block giống nhau (${elapsed}ms)`, 'warning', 3200);
                } else {
                    showToast(`Không có block trùng (≥${threshold}%) · ${elapsed}ms`, 'success', 2600);
                }
            }
        });
    }

    function renderDuplicateResults(pairs) {
        const resultsEl = document.getElementById('duplicate-results');
        if (!resultsEl) return;

        if (!pairs.length) {
            resultsEl.innerHTML = '<p class="muted duplicate-empty">Không tìm thấy block giống nhau ở ngưỡng hiện tại.</p>';
            return;
        }

        resultsEl.innerHTML = pairs.slice(0, 40).map(pair => `
            <div class="duplicate-result-row" data-dup-index="${pair.a}" title="Nhấn để mở Block #${pair.a + 1}">
                <span>Block <strong>#${pair.a + 1}</strong> ≈ Block <strong>#${pair.b + 1}</strong></span>
                <strong>${pair.percent}%</strong>
            </div>
        `).join('');

        if (pairs.length > 40) {
            resultsEl.innerHTML += `<p class="muted duplicate-empty">+${pairs.length - 40} cặp nữa (cuộn danh sách block để xem badge).</p>`;
        }
    }

    function updateDuplicateSummary() {
        const el = document.getElementById('duplicate-summary-stat');
        if (!el) return;
        el.textContent = duplicatePairs.length
            ? `Trùng: ${duplicatePairs.length} cặp`
            : 'Trùng: không có';
    }

    function buildBlockItemClass(block) {
        let cls = 'block-item';
        if (block.id === window.BlockSystem.selectedId) cls += ' selected';
        if (window.BlockSystem.selectedDownloadIds?.has(block.id)) cls += ' export-selected';
        if (duplicateMap.has(block.id)) cls += ' has-duplicate';
        return cls;
    }

    function createBlockListItem(block, index) {
        const dupInfo = duplicateMap.get(block.id);
        const item = document.createElement('article');
        item.className = buildBlockItemClass(block);
        item.draggable = true;
        item.dataset.id = block.id;
        item.style.minHeight = `${BLOCK_ITEM_HEIGHT}px`;

        const dupBadge = dupInfo
            ? `<span class="block-dup-badge">≈ Block #${dupInfo.partnerIndex + 1} (${dupInfo.percent}%)</span>`
            : '';

        item.innerHTML = `
            <label class="checkbox-row" style="display:flex;align-items:center;gap:8px;">
                <input type="checkbox" data-action="toggle-select" data-id="${block.id}" ${window.BlockSystem.selectedDownloadIds?.has(block.id) ? 'checked' : ''}>
                <span>Chọn</span>
            </label>
            <div class="block-item-main">
                <div style="min-width:0;flex:1;">
                    <strong data-block-title>${escapeHtml(block.title)}</strong>
                    ${dupBadge}
                </div>
                <small data-block-meta>${formatBytes(block.content.length)} · #${index + 1}</small>
            </div>
            <div class="block-action-row">
                <button type="button" data-action="edit" class="btn btn-small" title="Xem/sửa block">👁</button>
                <button type="button" data-action="download" class="btn btn-small" title="Tải file .txt">⬇</button>
                <button type="button" data-action="rename" class="btn btn-small" title="Đổi tên">✏</button>
                <button type="button" data-action="delete" class="btn btn-small btn-danger" title="Xóa block">🗑</button>
            </div>`;
        return item;
    }

    function renderBlockListFull(listEl, blocks) {
        listEl.innerHTML = '';
        const frag = document.createDocumentFragment();
        blocks.forEach((block, index) => frag.appendChild(createBlockListItem(block, index)));
        listEl.appendChild(frag);
    }

    function renderBlockListVirtual(listEl, blocks) {
        const totalHeight = blocks.length * BLOCK_ITEM_HEIGHT;
        const scrollTop = listEl.scrollTop;
        const viewportHeight = listEl.clientHeight || 400;
        let startIndex = Math.floor(scrollTop / BLOCK_ITEM_HEIGHT) - BLOCK_LIST_OVERSCAN;
        let endIndex = Math.ceil((scrollTop + viewportHeight) / BLOCK_ITEM_HEIGHT) + BLOCK_LIST_OVERSCAN;
        startIndex = Math.max(0, startIndex);
        endIndex = Math.min(blocks.length, endIndex);

        listEl.innerHTML = '';
        const spacer = document.createElement('div');
        spacer.className = 'block-list-spacer';
        spacer.style.height = `${totalHeight}px`;

        const viewport = document.createElement('div');
        viewport.className = 'block-list-viewport';
        viewport.style.transform = `translateY(${startIndex * BLOCK_ITEM_HEIGHT}px)`;

        const frag = document.createDocumentFragment();
        for (let i = startIndex; i < endIndex; i++) {
            frag.appendChild(createBlockListItem(blocks[i], i));
        }
        viewport.appendChild(frag);
        spacer.appendChild(viewport);
        listEl.appendChild(spacer);
    }

    function renderBlockList() {
        const listEl = document.getElementById('block-list');
        if (!listEl) return;
        const blocks = window.BlockSystem.blocks;
        if (blocks.length >= VIRTUAL_SCROLL_THRESHOLD) {
            renderBlockListVirtual(listEl, blocks);
        } else {
            renderBlockListFull(listEl, blocks);
        }
    }

    function syncBlockListSelection(prevId, nextId) {
        const listEl = document.getElementById('block-list');
        if (!listEl) return;
        if (prevId) {
            const prev = listEl.querySelector(`[data-id="${CSS.escape(prevId)}"]`);
            prev?.classList.remove('selected');
        }
        const next = listEl.querySelector(`[data-id="${CSS.escape(nextId)}"]`);
        if (next) {
            next.classList.add('selected');
            next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    function syncEditorPanel() {
        const editorEl = document.getElementById('block-editor');
        const titleEl = document.getElementById('block-editor-title');
        const selected = getSelectedBlock();
        if (!selected || !editorEl || !titleEl) return;
        titleEl.value = selected.title;
        editorEl.value = selected.content;
        updateBlockEditorLimitHint();
    }

    function isTypingTarget(element) {
        if (!element) return false;
        const tag = element.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable;
    }

    function setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            const modal = document.getElementById('settings-modal');
            if (modal && !modal.classList.contains('hidden') && e.key === 'Escape') {
                closeSettingsModal();
                return;
            }

            if (!e.ctrlKey || !e.shiftKey || e.altKey) return;
            if (isTypingTarget(e.target)) return;

            const key = e.key.toLowerCase();
            if (key === 'n') {
                e.preventDefault();
                addBlock(undefined, '', { silent: true });
                showToast('Đã tạo block mới (Ctrl+Shift+N)', 'success', 2200);
            } else if (key === 'd') {
                e.preventDefault();
                if (!window.BlockSystem.selectedId) {
                    showToast('Chưa chọn block để nhân bản.', 'warning');
                    return;
                }
                duplicateBlock(window.BlockSystem.selectedId);
            } else if (key === 'm') {
                e.preventDefault();
                mergeSelectedBlocksQuick();
            }
        });
    }

    function setupSettingsModal() {
        const modal = document.getElementById('settings-modal');
        const btnOpen = document.getElementById('btn-open-settings');
        const btnClose = document.getElementById('btn-close-settings');
        const btnRefresh = document.getElementById('btn-refresh-limits');
        const backdrop = modal && modal.querySelector('[data-close-settings]');

        if (!modal) return;

        btnOpen && btnOpen.addEventListener('click', () => openSettingsModal());
        btnClose && btnClose.addEventListener('click', () => closeSettingsModal());
        backdrop && backdrop.addEventListener('click', () => closeSettingsModal());
        btnRefresh && btnRefresh.addEventListener('click', () => renderSystemLimits(true));
    }

    function openSettingsModal() {
        const modal = document.getElementById('settings-modal');
        if (!modal) return;
        modal.classList.remove('hidden');
        modal.setAttribute('aria-hidden', 'false');
        renderSystemLimits(false);
        showToast('Đã mở Cài đặt', 'info', 1600);
    }

    function closeSettingsModal() {
        const modal = document.getElementById('settings-modal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.setAttribute('aria-hidden', 'true');
        showToast('Đã đóng Cài đặt', 'info', 1400);
    }

    function formatLimitNumber(num) {
        const value = Number(num) || 0;
        if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} triệu ký tự`;
        if (value >= 10_000) return `${Math.round(value / 1000)} nghìn ký tự`;
        return `${value.toLocaleString('vi-VN')} ký tự`;
    }

    function formatLimitBytes(bytes) {
        const value = Number(bytes) || 0;
        if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`;
        if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
        return `${Math.round(value)} B`;
    }

    function getLocalStorageUsedBytes() {
        let total = 0;
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key) continue;
            total += key.length + String(localStorage.getItem(key) || '').length;
        }
        return total * 2;
    }

    function measureLocalStorageCapacityBytes(force = false) {
        if (!force && cachedLocalStorageLimitBytes) return cachedLocalStorageLimitBytes;

        if (!force) {
            try {
                const cached = sessionStorage.getItem(LS_LIMIT_CACHE_KEY);
                if (cached) {
                    const parsed = JSON.parse(cached);
                    if (parsed.bytes && parsed.ts && Date.now() - parsed.ts < 3600000) {
                        cachedLocalStorageLimitBytes = parsed.bytes;
                        return parsed.bytes;
                    }
                }
            } catch (error) {
                /* ignore cache read errors */
            }
        }

        const testKey = '__story_storage_limit_test__';
        localStorage.removeItem(testKey);

        let low = 0;
        let high = 12 * 1024 * 1024;
        let best = 0;

        try {
            while (low <= high) {
                const mid = Math.floor((low + high) / 2);
                try {
                    localStorage.setItem(testKey, 'x'.repeat(mid));
                    best = mid;
                    low = mid + 1;
                } catch (error) {
                    high = mid - 1;
                }
            }
        } finally {
            localStorage.removeItem(testKey);
        }

        cachedLocalStorageLimitBytes = best || (5 * 1024 * 1024);
        sessionStorage.setItem(LS_LIMIT_CACHE_KEY, JSON.stringify({
            bytes: cachedLocalStorageLimitBytes,
            ts: Date.now()
        }));
        updateBlockEditorLimitHint();
        return cachedLocalStorageLimitBytes;
    }

    async function collectSystemLimits(forceMeasure = false) {
        saveEditorToSelectedBlock();

        const blocks = window.BlockSystem.blocks || [];
        const totalChars = blocks.reduce((sum, block) => sum + (block.content || '').length, 0);
        const maxBlockNow = blocks.reduce((max, block) => Math.max(max, (block.content || '').length), 0);
        const projectJson = JSON.stringify({ blocks });
        const projectBytes = new Blob([projectJson]).size;
        const lsUsed = getLocalStorageUsedBytes();
        const lsCapacity = measureLocalStorageCapacityBytes(forceMeasure);
        const lsFree = Math.max(lsCapacity - lsUsed, 0);
        const jsonOverhead = 2.3;
        const estimatedMaxBlockChars = Math.floor(lsFree / jsonOverhead);
        const estimatedMaxProjectChars = Math.floor((lsCapacity * 0.92) / jsonOverhead);
        const jsStringTheoretical = 536_870_888;
        const practicalEditorMax = Math.min(estimatedMaxBlockChars, 50_000_000);
        const exportTxtPractical = Math.min(jsStringTheoretical, 200_000_000);

        let storageEstimate = null;
        if (navigator.storage && navigator.storage.estimate) {
            try {
                storageEstimate = await navigator.storage.estimate();
            } catch (error) {
                storageEstimate = null;
            }
        }

        return {
            blockCount: blocks.length,
            totalChars,
            maxBlockNow,
            projectBytes,
            lsUsed,
            lsCapacity,
            lsFree,
            estimatedMaxBlockChars: Math.max(practicalEditorMax, 0),
            estimatedMaxProjectChars: Math.max(estimatedMaxProjectChars, 0),
            jsStringTheoretical,
            exportTxtPractical,
            storageEstimate
        };
    }

    async function renderSystemLimits(forceMeasure = false) {
        const container = document.getElementById('system-limits-info');
        if (!container) return;

        container.innerHTML = '<p class="muted">Đang đo giới hạn trên máy bạn...</p>';

        const limits = await collectSystemLimits(forceMeasure);
        const quotaLine = limits.storageEstimate
            ? `Quota origin (Storage API): ${formatLimitBytes(limits.storageEstimate.quota)} · đã dùng ${formatLimitBytes(limits.storageEstimate.usage)}.`
            : 'Trình duyệt không cung cấp Storage API chi tiết.';

        const warnProject = limits.projectBytes > limits.lsCapacity * 0.75;
        const warnBlock = limits.maxBlockNow > limits.estimatedMaxBlockChars * 0.8 && limits.estimatedMaxBlockChars > 0;

        container.innerHTML = `
            <div class="limit-card highlight">
                <strong>1 block viết tối đa (ước tính)</strong>
                <span>Khoảng <b>${formatLimitNumber(limits.estimatedMaxBlockChars)}</b> trên máy bạn.<br>Block lớn nhất hiện có: <b>${formatLimitNumber(limits.maxBlockNow)}</b>.</span>
            </div>
            <div class="limit-card highlight">
                <strong>Toàn project lưu tạm tối đa</strong>
                <span>Khoảng <b>${formatLimitNumber(limits.estimatedMaxProjectChars)}</b> (localStorage ~${formatLimitBytes(limits.lsCapacity)}).<br>Project hiện tại: <b>${formatLimitNumber(limits.totalChars)}</b> · ${formatLimitBytes(limits.projectBytes)}.</span>
            </div>
            <div class="limit-card">
                <strong>1 file TXT xuất ra (thực tế)</strong>
                <span>Có thể xuất rất lớn (hàng chục triệu ký tự).<br>Giới hạn lý thuyết chuỗi JS: <b>${formatLimitNumber(limits.jsStringTheoretical)}</b>.</span>
            </div>
            <div class="limit-card ${warnProject ? 'warn' : ''}">
                <strong>Bộ nhớ trình duyệt (localStorage)</strong>
                <span>Đã dùng <b>${formatLimitBytes(limits.lsUsed)}</b> / <b>${formatLimitBytes(limits.lsCapacity)}</b> · còn trống ~<b>${formatLimitBytes(limits.lsFree)}</b>.<br>${quotaLine}</span>
            </div>
            <div class="limit-card">
                <strong>Thống kê hiện tại</strong>
                <span><b>${limits.blockCount}</b> block · tổng <b>${formatLimitNumber(limits.totalChars)}</b>.<br>Nên tách file xuất ~500.000–1.000.000 ký tự/file để mở Word/Notepad ổn định.</span>
            </div>
            <div class="limit-card ${warnBlock ? 'warn' : ''}">
                <strong>Gợi ý an toàn</strong>
                <span>Giữ mỗi block dưới <b>${formatLimitNumber(Math.min(limits.estimatedMaxBlockChars, 1_000_000))}</b> để tránh lag editor.<br>Dùng “Giới hạn ký tự” khi tải nhiều file con.</span>
            </div>
        `;
    }

    function mergeSelectedBlocksQuick() {
        const selectedIds = Array.from(window.BlockSystem.selectedDownloadIds || []);
        const ordered = window.BlockSystem.blocks.filter(block => selectedIds.includes(block.id));

        if (ordered.length >= 2) {
            pushHistory('gộp block');
            const mergedContent = ordered.map(block => block.content || '').filter(Boolean).join('\n\n');
            const first = ordered[0];
            first.content = mergedContent;
            first.characterCount = mergedContent.length;
            first.title = first.title || inferBlockTitle(mergedContent, 'Block mới');

            const removeIds = new Set(ordered.slice(1).map(block => block.id));
            window.BlockSystem.blocks = window.BlockSystem.blocks.filter(block => !removeIds.has(block.id));
            window.BlockSystem.selectedId = first.id;
            window.BlockSystem.selectedDownloadIds = new Set([first.id]);
            persist();
            render();
            showToast(`Đã gộp ${ordered.length} block (Ctrl+Shift+M)`, 'success', 2400);
            return;
        }

        if (window.BlockSystem.selectedId) {
            mergeWithNext(window.BlockSystem.selectedId);
            return;
        }

        showToast('Tích chọn từ 2 block trở lên, hoặc chọn 1 block để gộp với block sau.', 'warning');
    }

    function setupUnifiedFileTools() {
        const zone = document.getElementById('block-file-zone');
        const input = document.getElementById('input-block-files');
        const btnPick = document.getElementById('btn-pick-block-files');
        const btnImport = document.getElementById('btn-unified-import');
        const btnMerge = document.getElementById('btn-unified-merge');
        const btnSplit = document.getElementById('btn-unified-split');
        const btnClear = document.getElementById('btn-unified-clear-files');
        const listEl = document.getElementById('block-file-list');
        const summaryEl = document.getElementById('block-file-summary');
        const mergeNameEl = document.getElementById('unified-merge-filename');
        const regexEl = document.getElementById('unified-chapter-regex');

        if (!zone || !input) return;

        let selectedFiles = [];
        let mergeNameTouched = false;

        const sortFiles = (files) => files.sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
        );

        const autoFillMergeName = () => {
            if (!mergeNameEl || !selectedFiles.length) return;
            if (mergeNameTouched) return;
            mergeNameEl.value = sanitizeMergeBasename(stripTxtBasename(selectedFiles[0].name));
        };

        mergeNameEl && mergeNameEl.addEventListener('input', () => {
            mergeNameTouched = true;
        });

        const setFiles = (fileList, append = false) => {
            const files = sortFiles(Array.from(fileList || []).filter(file => file.name.toLowerCase().endsWith('.txt')));
            if (!files.length) {
                showToast('Vui lòng chọn file .txt', 'warning');
                return;
            }
            selectedFiles = append ? sortFiles([...selectedFiles, ...files]) : files;
            if (!append) mergeNameTouched = false;
            input.value = '';
            autoFillMergeName();
            renderFilePicker();
        };

        const renderFilePicker = () => {
            const count = selectedFiles.length;
            const totalChars = selectedFiles.reduce((sum, file) => sum + file.size, 0);

            if (summaryEl) {
                summaryEl.textContent = count
                    ? `Đã chọn ${count} file · khoảng ${(totalChars / 1024).toFixed(1)} KB`
                    : 'Chưa chọn file';
            }

            if (listEl) {
                listEl.innerHTML = selectedFiles.map((file, index) => `
                    <div class="unified-file-row">
                        <span>${index + 1}. ${escapeHtml(file.name)}</span>
                        <button type="button" class="btn-delete" data-file-index="${index}">✕</button>
                    </div>
                `).join('');

                listEl.querySelectorAll('[data-file-index]').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        const index = Number(e.currentTarget.dataset.fileIndex);
                        selectedFiles.splice(index, 1);
                        renderFilePicker();
                    });
                });
            }

            if (btnImport) btnImport.disabled = count === 0;
            if (btnMerge) btnMerge.disabled = count < 2;
            if (btnSplit) btnSplit.disabled = count !== 1;
        };

        btnPick && btnPick.addEventListener('click', () => input.click());
        input.addEventListener('change', (e) => setFiles(e.target.files));

        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            zone.classList.add('dragover');
        });

        zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));

        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('dragover');
            setFiles(e.dataTransfer.files);
        });

        btnClear && btnClear.addEventListener('click', () => {
            selectedFiles = [];
            mergeNameTouched = false;
            if (mergeNameEl) mergeNameEl.value = 'tonghop';
            renderFilePicker();
        });

        btnImport && btnImport.addEventListener('click', async () => {
            if (!selectedFiles.length) {
                showToast('Chưa chọn file.', 'warning');
                return;
            }
            const clearOld = window.confirm('Bạn có muốn xóa sạch các block hiện tại trước khi nhập file mới không?');
            pushHistory('nhập file');
            if (clearOld) {
                window.BlockSystem.blocks = [];
                window.BlockSystem.selectedDownloadIds.clear();
            }

            const blocks = await readFilesAsBlocks(selectedFiles);
            window.BlockSystem.blocks.push(...blocks);
            window.BlockSystem.selectedId = window.BlockSystem.blocks[window.BlockSystem.blocks.length - 1].id;
            persist();
            render();
            showToast(`Đã nhập ${blocks.length} file thành Block.`, 'success');
        });

        btnMerge && btnMerge.addEventListener('click', async () => {
            if (selectedFiles.length < 2) {
                showToast('Chọn ít nhất 2 file để ghép.', 'warning');
                return;
            }

            const blocks = await readFilesAsBlocks(selectedFiles);
            const mergedText = blocks.map(block => block.content.trim()).filter(Boolean).join('\n\n');
            const defaultName = sanitizeMergeBasename(stripTxtBasename(selectedFiles[0].name));
            const filename = sanitizeMergeBasename((mergeNameEl && mergeNameEl.value.trim()) || defaultName || 'tonghop');

            pushHistory('ghép file');
            window.BlockSystem.setBlocks(blocks, { skipHistory: true });
            downloadBlob(new Blob([mergedText], { type: 'text/plain;charset=utf-8' }), `${filename}.txt`);
            showToast(`Đã ghép ${blocks.length} file, tải xuống ${filename}.txt và nạp vào Workspace.`, 'success');
        });

        btnSplit && btnSplit.addEventListener('click', async () => {
            if (selectedFiles.length !== 1) {
                showToast('Chỉ chọn 1 file để tách.', 'warning');
                return;
            }

            let regex;
            try {
                regex = new RegExp((regexEl && regexEl.value.trim()) || '^(Chương|Chapter|Hồi|Quyển)\\s+\\d+', 'i');
            } catch (error) {
                showToast('Regex tách chương không hợp lệ.', 'error');
                return;
            }

            const text = await selectedFiles[0].text();
            const blocks = splitTextToBlocks(text, regex);
            pushHistory('tách file');
            window.BlockSystem.setBlocks(blocks, { skipHistory: true });
            showToast(`Đã tách thành ${blocks.length} Block và nạp vào Workspace.`, 'success');
        });

        renderFilePicker();
    }

    function sanitizeMergeBasename(name) {
        return String(name || '')
            .replace(/[\\/:*?"<>|]/g, '_')
            .replace(/\s+/g, ' ')
            .trim() || 'tonghop';
    }

    function setupClipboardPanel() {
        const panel = document.getElementById('clipboard-blocks-panel');
        const listEl = document.getElementById('clipboard-blocks-list');
        const btnClose = document.getElementById('btn-close-clipboard-panel');
        const btnRefresh = document.getElementById('btn-refresh-clipboard');
        const btnAddSelected = document.getElementById('btn-add-selected-clipboard');
        const btnClearHistory = document.getElementById('btn-clear-clipboard-history');
        const btnPasteAdd = document.getElementById('btn-clipboard-paste-add');
        const pasteInput = document.getElementById('clipboard-paste-input');
        const chkAuto = document.getElementById('chk-clipboard-auto');
        const chkSelectAll = document.getElementById('chk-select-all-clipboard');

        if (!panel || !listEl) return;

        btnClose && btnClose.addEventListener('click', () => {
            clipboardPanelOpen = false;
            stopClipboardPoll();
            panel.classList.add('hidden');
        });
        btnRefresh && btnRefresh.addEventListener('click', () => captureFromSystemClipboard(true));
        btnAddSelected && btnAddSelected.addEventListener('click', () => addSelectedClipboardBlocks());
        btnClearHistory && btnClearHistory.addEventListener('click', () => clearClipboardHistory());

        chkAuto && chkAuto.addEventListener('change', (e) => {
            if (e.target.checked) {
                clipboardAutoCaptureReady = true;
                captureFromSystemClipboard(false);
            }
        });

        const addFromPasteBox = (silent = false) => {
            if (!pasteInput) return 0;
            const text = pasteInput.value;
            const added = appendClipboardFromText(text);
            if (added > 0) {
                pasteInput.value = '';
                renderClipboardPanel(true);
                if (!silent) {
                    showToast(`Đã thêm mục #${clipboardPreviewBlocks.length} vào danh sách.`, 'success');
                }
            }
            return added;
        };

        btnPasteAdd && btnPasteAdd.addEventListener('click', () => {
            if (!addFromPasteBox()) {
                showToast('Ô dán đang trống.', 'warning');
            }
        });

        pasteInput && pasteInput.addEventListener('focus', () => {
            clipboardAutoCaptureReady = true;
        });

        pasteInput && pasteInput.addEventListener('paste', () => {
            setTimeout(() => addFromPasteBox(true), 0);
        });

        pasteInput && pasteInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                addFromPasteBox();
            }
        });

        panel.addEventListener('paste', (e) => {
            if (e.target === pasteInput) return;
            const text = e.clipboardData && e.clipboardData.getData('text/plain');
            if (!text || !text.trim()) return;
            e.preventDefault();
            const added = appendClipboardFromText(text);
            if (added > 0) {
                lastSeenClipboardText = String(text).replace(/\r\n/g, '\n').trim();
                renderClipboardPanel(true);
                showToast(`Đã thêm mục #${clipboardPreviewBlocks.length} vào danh sách.`, 'success');
            }
        });

        chkSelectAll && chkSelectAll.addEventListener('change', (e) => {
            listEl.querySelectorAll('[data-clipboard-index]').forEach(input => {
                input.checked = e.target.checked;
            });
        });

        listEl.addEventListener('click', (e) => {
            const row = e.target.closest('[data-clipboard-row]');
            if (!row || e.target.closest('input[type="checkbox"]') || e.target.closest('button')) return;
            const index = Number(row.dataset.clipboardRow);
            if (Number.isNaN(index)) return;
            addClipboardBlock(index);
        });

        listEl.addEventListener('change', () => {
            if (!chkSelectAll) return;
            const inputs = listEl.querySelectorAll('[data-clipboard-index]');
            chkSelectAll.checked = inputs.length > 0 && Array.from(inputs).every(input => input.checked);
        });
    }

    function setupClipboardWatcher() {
        const tryAutoCapture = () => {
            const chkAuto = document.getElementById('chk-clipboard-auto');
            if (chkAuto && !chkAuto.checked) return;
            if (!clipboardAutoCaptureReady) return;
            captureFromSystemClipboard(false);
        };

        window.addEventListener('focus', tryAutoCapture);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') tryAutoCapture();
        });
    }

    function startClipboardPoll() {
        stopClipboardPoll();
        clipboardPollTimer = setInterval(() => {
            if (!clipboardPanelOpen) return;
            const chkAuto = document.getElementById('chk-clipboard-auto');
            if (chkAuto && !chkAuto.checked) return;
            if (!clipboardAutoCaptureReady) return;
            captureFromSystemClipboard(false);
        }, 2000);
    }

    function stopClipboardPoll() {
        if (clipboardPollTimer) {
            clearInterval(clipboardPollTimer);
            clipboardPollTimer = null;
        }
    }

    function openClipboardPanel(captureNow = false) {
        clipboardPanelOpen = true;
        clipboardAutoCaptureReady = true;
        renderClipboardPanel(true);
        startClipboardPoll();
        if (captureNow) {
            captureFromSystemClipboard(true);
        }
    }

    async function captureFromSystemClipboard(showMessages = true) {
        if (!navigator.clipboard || !navigator.clipboard.readText) {
            if (showMessages) {
                showToast('Trình duyệt không hỗ trợ đọc Clipboard. Dùng ô dán bên dưới.', 'warning');
            }
            renderClipboardPanel(true);
            return 0;
        }

        try {
            const text = await navigator.clipboard.readText();
            const clean = String(text || '').replace(/\r\n/g, '\n').trim();
            if (!clean) {
                if (showMessages) showToast('Clipboard trống.', 'warning');
                renderClipboardPanel(true);
                return 0;
            }

            if (clean === lastSeenClipboardText) {
                if (showMessages) {
                    showToast(`Danh sách giữ ${clipboardPreviewBlocks.length} mục. Copy mới rồi quay lại tab hoặc dán vào ô bên dưới.`, 'info');
                }
                renderClipboardPanel(true);
                return 0;
            }

            const added = appendClipboardFromText(clean);
            lastSeenClipboardText = clean;
            renderClipboardPanel(true);
            if (added > 0 && showMessages) {
                showToast(`Đã lưu copy mới (#${clipboardPreviewBlocks.length} mục trong danh sách).`, 'success');
            }
            return added;
        } catch (error) {
            renderClipboardPanel(true);
            if (showMessages) {
                showToast('Không đọc được Clipboard. Dán trực tiếp vào ô bên dưới.', 'warning');
            }
            return 0;
        }
    }

    async function loadClipboardBlocks() {
        openClipboardPanel(true);
    }

    function setupTextDropZone() {
        const zone = document.getElementById('workspace-drop-zone');
        if (!zone) return;

        const isInternalBlockDrag = (dataTransfer) => {
            const value = dataTransfer.getData('text/plain');
            return /^block-/.test(value || '');
        };

        zone.addEventListener('dragover', (e) => {
            if (e.target.closest('#block-list') || e.target.closest('#block-file-zone')) return;
            const hasText = Array.from(e.dataTransfer.types || []).includes('text/plain');
            const hasFiles = Array.from(e.dataTransfer.types || []).includes('Files');
            if (hasText || hasFiles) {
                e.preventDefault();
                zone.classList.add('text-dragover');
            }
        });

        zone.addEventListener('dragleave', (e) => {
            if (!zone.contains(e.relatedTarget)) {
                zone.classList.remove('text-dragover');
            }
        });

        zone.addEventListener('drop', async (e) => {
            if (e.target.closest('#block-list') || e.target.closest('#block-file-zone')) return;
            e.preventDefault();
            zone.classList.remove('text-dragover');

            const files = Array.from(e.dataTransfer.files || []).filter(file =>
                file.name.toLowerCase().endsWith('.txt') || file.type === 'text/plain'
            );

            if (files.length) {
                pushHistory('kéo thả file');
                const blocks = await readFilesAsBlocks(files);
                window.BlockSystem.blocks.push(...blocks);
                window.BlockSystem.selectedId = blocks[blocks.length - 1].id;
                persist();
                render();
                showToast(`Đã tạo ${blocks.length} block từ file kéo thả.`, 'success');
                return;
            }

            const text = e.dataTransfer.getData('text/plain');
            if (!text || isInternalBlockDrag(e.dataTransfer)) return;

            const parsed = parseClipboardToBlocks(text);
            if (!parsed.length) {
                showToast('Không có nội dung văn bản để tạo block.', 'warning');
                return;
            }

            pushHistory('kéo thả văn bản');
            const startIndex = window.BlockSystem.blocks.length;
            const blocks = parsed.map((entry, offset) =>
                createBlockFromClipboardEntry(entry, startIndex + offset)
            );
            window.BlockSystem.blocks.push(...blocks);
            window.BlockSystem.selectedId = blocks[blocks.length - 1].id;
            persist();
            render();
            showToast(`Đã tạo ${blocks.length} block từ văn bản kéo thả.`, 'success');
        });
    }

    function parseClipboardToBlocks(text) {
        const clean = String(text || '').replace(/\r\n/g, '\n').trim();
        if (!clean) return [];

        const regexEl = document.getElementById('unified-chapter-regex');
        let regex;
        try {
            regex = new RegExp((regexEl && regexEl.value.trim()) || '^(Chương|Chapter|Hồi|Quyển)\\s+\\d+', 'i');
        } catch (error) {
            regex = /^(Chương|Chapter|Hồi|Quyển)\s+\d+/i;
        }

        const chapterBlocks = splitTextToBlocks(clean, regex);
        if (chapterBlocks.length > 1) {
            return chapterBlocks.map(block => ({ title: block.title, content: block.content }));
        }

        const parts = clean.split(/\n{2,}/).map(part => part.trim()).filter(Boolean);
        if (parts.length > 1) {
            return parts.map((content, index) => ({
                title: inferBlockTitle(content, getDefaultBlockTitle(index)),
                content
            }));
        }

        return [{ title: inferBlockTitle(clean, 'Block mới'), content: clean }];
    }

    function loadClipboardHistory() {
        try {
            const saved = localStorage.getItem(CLIPBOARD_HISTORY_KEY);
            const parsed = saved ? JSON.parse(saved) : [];
            clipboardPreviewBlocks = Array.isArray(parsed)
                ? parsed.map(item => normalizeClipboardEntry(item)).filter(item => item.content)
                : [];
            if (clipboardPreviewBlocks.length) {
                lastSeenClipboardText = clipboardPreviewBlocks[0].content;
            }
        } catch (error) {
            clipboardPreviewBlocks = [];
        }
    }

    function saveClipboardHistory() {
        localStorage.setItem(
            CLIPBOARD_HISTORY_KEY,
            JSON.stringify(clipboardPreviewBlocks.slice(0, MAX_CLIPBOARD_HISTORY))
        );
    }

    function normalizeClipboardEntry(item) {
        const content = String(item.content || '').replace(/\r\n/g, '\n');
        return {
            id: item.id || ('clip-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7)),
            title: item.title || inferBlockTitle(content, 'Block mới'),
            content,
            createdAt: Number(item.createdAt || Date.now())
        };
    }

    function createClipboardEntry(content, title) {
        const clean = String(content || '').replace(/\r\n/g, '\n').trim();
        return {
            id: 'clip-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
            title: title || inferBlockTitle(clean, 'Block mới'),
            content: clean,
            createdAt: Date.now()
        };
    }

    function getClipboardPreviewText(content, maxLen = 220) {
        const lines = String(content || '')
            .replace(/\r\n/g, '\n')
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean);

        if (!lines.length) return '(trống)';

        const joined = lines.slice(0, 5).join('\n');
        return joined.length > maxLen ? `${joined.slice(0, maxLen)}…` : joined;
    }

    function formatClipboardTime(timestamp) {
        const date = new Date(Number(timestamp) || Date.now());
        return date.toLocaleString('vi-VN', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function appendClipboardFromText(text) {
        const clean = String(text || '').replace(/\r\n/g, '\n').trim();
        if (!clean) return 0;

        const now = Date.now();
        if (clean === lastAppendText && now - lastAppendTime < 700) return 0;
        lastAppendText = clean;
        lastAppendTime = now;

        const entryNum = clipboardPreviewBlocks.length + 1;
        const title = inferBlockTitle(clean, `Copy ${entryNum}`);
        clipboardPreviewBlocks.unshift(createClipboardEntry(clean, title));

        if (clipboardPreviewBlocks.length > MAX_CLIPBOARD_HISTORY) {
            clipboardPreviewBlocks = clipboardPreviewBlocks.slice(0, MAX_CLIPBOARD_HISTORY);
        }

        saveClipboardHistory();
        lastSeenClipboardText = clean;
        return 1;
    }

    function clearClipboardHistory() {
        if (!clipboardPreviewBlocks.length) {
            showToast('Danh sách Clipboard đã trống.', 'info');
            return;
        }
        if (!window.confirm('Xóa toàn bộ danh sách Clipboard đã lưu?')) return;
        clipboardPreviewBlocks = [];
        lastSeenClipboardText = '';
        saveClipboardHistory();
        renderClipboardPanel(true);
        showToast('Đã xóa danh sách Clipboard.', 'success');
    }

    function createBlockFromClipboardEntry(entry, titleIndex) {
        const content = String(entry.content || '').replace(/\r\n/g, '\n');
        const title = getDefaultBlockTitle(titleIndex);
        return {
            id: 'block-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
            title,
            content,
            characterCount: content.length
        };
    }

    function renderClipboardPanel(forceShow = false) {
        const panel = document.getElementById('clipboard-blocks-panel');
        const listEl = document.getElementById('clipboard-blocks-list');
        const countEl = document.getElementById('clipboard-history-count');
        const chkSelectAll = document.getElementById('chk-select-all-clipboard');
        if (!panel || !listEl) return;

        if (forceShow || clipboardPanelOpen) {
            panel.classList.remove('hidden');
        } else if (!clipboardPreviewBlocks.length) {
            panel.classList.add('hidden');
        }

        if (countEl) countEl.textContent = String(clipboardPreviewBlocks.length);

        if (!clipboardPreviewBlocks.length) {
            listEl.innerHTML = '<p class="muted clipboard-empty-note">Chưa có mục. Copy ở app khác → quay lại tab, hoặc dán vào ô phía trên.</p>';
            return;
        }

        listEl.innerHTML = clipboardPreviewBlocks.map((block, index) => {
            const preview = getClipboardPreviewText(block.content);
            const order = clipboardPreviewBlocks.length - index;
            return `
                <div class="clipboard-block-row" data-clipboard-row="${index}">
                    <label class="checkbox-row">
                        <input type="checkbox" data-clipboard-index="${index}" checked>
                    </label>
                    <div class="clipboard-block-main">
                        <div class="clipboard-block-head">
                            <strong>#${order} · ${escapeHtml(block.title)}</strong>
                            <small>${formatBytes(block.content.length)} · ${formatClipboardTime(block.createdAt)}</small>
                        </div>
                        <pre class="clipboard-block-preview">${escapeHtml(preview)}</pre>
                    </div>
                    <button type="button" class="btn btn-small" data-add-clipboard="${index}">Thêm</button>
                </div>
            `;
        }).join('');

        listEl.querySelectorAll('[data-add-clipboard]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                addClipboardBlock(Number(btn.dataset.addClipboard));
            });
        });

        if (chkSelectAll) chkSelectAll.checked = true;
    }

    function addClipboardBlock(index) {
        const preview = clipboardPreviewBlocks[index];
        if (!preview) return;

        pushHistory('thêm từ clipboard');
        const block = createBlockFromClipboardEntry(preview, window.BlockSystem.blocks.length);
        window.BlockSystem.blocks.push(block);
        window.BlockSystem.selectedId = block.id;
        persist();
        render();
        showToast(`Đã thêm ${block.title}`, 'success');
    }

    function addSelectedClipboardBlocks() {
        const listEl = document.getElementById('clipboard-blocks-list');
        if (!listEl || !clipboardPreviewBlocks.length) {
            showToast('Chưa có danh sách Clipboard.', 'warning');
            return;
        }

        const selectedIndexes = Array.from(listEl.querySelectorAll('[data-clipboard-index]:checked'))
            .map(input => Number(input.dataset.clipboardIndex))
            .filter(index => !Number.isNaN(index));

        if (!selectedIndexes.length) {
            showToast('Hãy chọn ít nhất 1 block trong danh sách Clipboard.', 'warning');
            return;
        }

        pushHistory('thêm nhiều block từ clipboard');
        const added = [];
        const startIndex = window.BlockSystem.blocks.length;
        selectedIndexes.sort((a, b) => a - b).forEach((index, offset) => {
            const preview = clipboardPreviewBlocks[index];
            if (!preview) return;
            const block = createBlockFromClipboardEntry(preview, startIndex + offset);
            window.BlockSystem.blocks.push(block);
            added.push(block);
        });

        if (!added.length) return;
        window.BlockSystem.selectedId = added[added.length - 1].id;
        persist();
        render();
        showToast(`Đã thêm ${added.length} block (${getDefaultBlockTitle(startIndex)} → ${getDefaultBlockTitle(startIndex + added.length - 1)}).`, 'success');
    }

    async function readFilesAsBlocks(files) {
        const sortedFiles = Array.from(files).sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
        );

        const blocks = [];
        for (const file of sortedFiles) {
            const text = await file.text();
            blocks.push(createBlock(stripTxtBasename(file.name), text));
        }
        return blocks;
    }

    function stripTxtBasename(name) {
        return String(name || '').replace(/\.txt$/i, '');
    }

    function splitTextToBlocks(text, regex) {
        const lines = String(text || '').split(/\r?\n/);
        const blocks = [];
        let currentTitle = 'Chương 0000';
        let currentLines = [];

        const flush = () => {
            const content = currentLines.join('\n').trim();
            if (!content && blocks.length === 0) return;
            blocks.push(createBlock(currentTitle || `Block ${blocks.length + 1}`, content));
        };

        for (const line of lines) {
            const trimmed = line.trim();
            regex.lastIndex = 0;
            if (regex.test(trimmed)) {
                if (currentLines.length > 0 || blocks.length > 0) flush();
                currentTitle = trimmed || `Block ${blocks.length + 1}`;
                currentLines = [];
            } else {
                currentLines.push(line);
            }
        }

        if (currentLines.length > 0 || blocks.length === 0) flush();
        return blocks.length ? blocks : [createBlock('Block mới', text)];
    }

    function getDefaultBlockTitle(index) {
        return `Block ${index + 1}`;
    }

    function createBlock(title = 'Block mới', content = '') {
        const derivedTitle = inferBlockTitle(content, title || 'Block mới');
        return {
            id: 'block-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
            title: derivedTitle,
            content,
            characterCount: content.length
        };
    }

    function inferBlockTitle(content, fallback = 'Block mới') {
        const lines = String(content || '').split(/\r?\n/);
        const first = lines.find(line => line.trim());
        if (first && /\b(Chương|Chapter|Hồi|Quyển)\b/i.test(first)) {
            return first.trim();
        }
        return fallback || 'Block mới';
    }

    function normalizeBlock(block) {
        return {
            id: block.id || ('block-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7)),
            title: block.title || 'Block mới',
            content: block.content || '',
            characterCount: Number(block.characterCount || (block.content || '').length)
        };
    }

    function getSelectedBlock() {
        return window.BlockSystem.blocks.find(item => item.id === window.BlockSystem.selectedId) || window.BlockSystem.blocks[0] || null;
    }

    function persist() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ blocks: window.BlockSystem.blocks }));
    }

    function saveEditorToSelectedBlock() {
        const block = getSelectedBlock();
        const editorEl = document.getElementById('block-editor');
        const titleEl = document.getElementById('block-editor-title');
        if (!block || !editorEl || !titleEl) return null;
        block.title = titleEl.value.trim() || getDefaultBlockTitle(window.BlockSystem.blocks.findIndex(item => item.id === block.id));
        block.content = editorEl.value;
        block.characterCount = block.content.length;
        persist();
        updateSelectedBlockListItem(block);
        updateWorkspaceStats();
        return block;
    }

    function scheduleAutosave() {
        pushHistoryForEditor();
        const statusEl = document.getElementById('autosave-status');
        if (statusEl) statusEl.textContent = 'Đang lưu...';
        clearTimeout(autosaveTimer);
        autosaveTimer = setTimeout(() => {
            saveEditorToSelectedBlock();
            showStatus('Đã tự lưu');
        }, AUTOSAVE_DELAY);
    }

    function showStatus(message) {
        const statusEl = document.getElementById('autosave-status');
        if (statusEl) {
            statusEl.textContent = message;
        }
    }

    function updateSelectedBlockListItem(block) {
        const item = document.querySelector(`.block-item[data-id="${CSS.escape(block.id)}"]`);
        if (!item) return;
        const titleNode = item.querySelector('[data-block-title]');
        const metaNode = item.querySelector('[data-block-meta]');
        if (titleNode) titleNode.textContent = block.title;
        if (metaNode) {
            const index = window.BlockSystem.blocks.findIndex(entry => entry.id === block.id);
            metaNode.textContent = `${formatBytes(block.content.length)} · ${index + 1}`;
        }
    }

    function createSnapshot(label) {
        saveEditorToSelectedBlock();
        return {
            label,
            blocks: window.BlockSystem.blocks.map(block => ({ ...block })),
            selectedId: window.BlockSystem.selectedId,
            selectedDownloadIds: Array.from(window.BlockSystem.selectedDownloadIds || [])
        };
    }

    function snapshotsEqual(a, b) {
        if (!a || !b) return false;
        return JSON.stringify(a.blocks) === JSON.stringify(b.blocks) &&
            a.selectedId === b.selectedId &&
            JSON.stringify(a.selectedDownloadIds) === JSON.stringify(b.selectedDownloadIds);
    }

    function pushHistory(label, force = false) {
        const snapshot = createSnapshot(label);
        const last = undoStack[undoStack.length - 1];
        if (!force && last && snapshotsEqual(last, snapshot)) return;

        undoStack.push(snapshot);
        if (undoStack.length > MAX_HISTORY) undoStack.shift();
        redoStack = [];
        updateUndoRedoButtons();
    }

    function pushHistoryForEditor() {
        if (historySessionActive) return;
        pushHistory('sửa nội dung');
        historySessionActive = true;
        clearTimeout(historySessionTimer);
        historySessionTimer = setTimeout(() => {
            historySessionActive = false;
        }, 1200);
    }

    function restoreSnapshot(snapshot) {
        window.BlockSystem.blocks = snapshot.blocks.map(normalizeBlock);
        window.BlockSystem.selectedId = snapshot.selectedId;
        window.BlockSystem.selectedDownloadIds = new Set(snapshot.selectedDownloadIds || []);
        if (!window.BlockSystem.blocks.length) {
            window.BlockSystem.blocks = [createBlock(getDefaultBlockTitle(0), '')];
        }
        if (!window.BlockSystem.blocks.find(b => b.id === window.BlockSystem.selectedId)) {
            window.BlockSystem.selectedId = window.BlockSystem.blocks[0].id;
        }
        persist();
        render();
    }

    function updateUndoRedoButtons() {
        const btnUndo = document.getElementById('btn-undo-block');
        const btnRedo = document.getElementById('btn-redo-block');
        if (btnUndo) {
            btnUndo.disabled = undoStack.length === 0;
            const last = undoStack[undoStack.length - 1];
            btnUndo.textContent = last ? `Hoàn tác (${last.label})` : 'Hoàn tác';
        }
        if (btnRedo) {
            btnRedo.disabled = redoStack.length === 0;
            const next = redoStack[redoStack.length - 1];
            btnRedo.textContent = next ? `Làm lại (${next.label})` : 'Làm lại';
        }
    }

    function undoLastAction() {
        if (!undoStack.length) return;
        const current = createSnapshot('hiện tại');
        const prev = undoStack.pop();
        redoStack.push(current);
        if (redoStack.length > MAX_HISTORY) redoStack.shift();
        restoreSnapshot(prev);
        updateUndoRedoButtons();
        showToast(`Đã hoàn tác: ${prev.label}`, 'success');
    }

    function redoLastAction() {
        if (!redoStack.length) return;
        const current = createSnapshot('hiện tại');
        const next = redoStack.pop();
        undoStack.push(current);
        if (undoStack.length > MAX_HISTORY) undoStack.shift();
        restoreSnapshot(next);
        updateUndoRedoButtons();
        showToast(`Đã làm lại: ${next.label}`, 'success');
    }

    async function openProjectFile(file, inputEl) {
        if (!file) return;
        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            if (!parsed || !Array.isArray(parsed.blocks)) {
                showToast('File project không hợp lệ.', 'error');
                return;
            }
            pushHistory('mở project');
            window.BlockSystem.blocks = parsed.blocks.map(normalizeBlock);
            if (!window.BlockSystem.blocks.length) {
                window.BlockSystem.blocks = [createBlock(getDefaultBlockTitle(0), '')];
            }
            window.BlockSystem.selectedId = window.BlockSystem.blocks[0].id;
            window.BlockSystem.selectedDownloadIds = new Set();
            persist();
            render();
            showToast(`Đã mở ${window.BlockSystem.blocks.length} block`, 'success');
        } catch (error) {
            showToast('Không thể mở project JSON.', 'error');
        } finally {
            if (inputEl) inputEl.value = '';
        }
    }

    function isAutoBlockTitle(title) {
        return /^Block\s+\d+$/i.test(String(title || '').trim());
    }

    function renumberAutoBlockTitles() {
        window.BlockSystem.blocks.forEach((block, index) => {
            if (isAutoBlockTitle(block.title)) {
                block.title = getDefaultBlockTitle(index);
            }
        });
    }

    function estimateOutputFileCount(blocks, useCharLimit, charLimit) {
        if (!blocks.length) return 0;
        if (!useCharLimit) return blocks.length;
        const safeLimit = Math.max(Number(charLimit) || 1, 1);
        let total = 0;
        let currentLength = 0;
        for (const block of blocks) {
            const length = (block.content || '').length;
            if (length > safeLimit) {
                if (currentLength > 0) {
                    total++;
                    currentLength = 0;
                }
                total += Math.ceil(length / safeLimit);
            } else if (currentLength && currentLength + length + 2 > safeLimit) {
                total++;
                currentLength = length;
            } else {
                currentLength += (currentLength ? 2 : 0) + length;
            }
        }
        if (currentLength > 0) total++;
        return total;
    }

    function updateWorkspaceStats() {
        const selectedBlocks = window.BlockSystem.blocks.filter(b => window.BlockSystem.selectedDownloadIds?.has(b.id));
        const totalSelectedChars = selectedBlocks.reduce((sum, b) => sum + (b.content ? b.content.length : 0), 0);
        const maxBlockChars = selectedBlocks.length > 0 ? Math.max(...selectedBlocks.map(b => b.content ? b.content.length : 0)) : 0;
        const chkLimit = document.getElementById('chk-limit-chars');
        const charLimit = parseInt(document.getElementById('export-char-limit')?.value, 10) || 50000;
        const estimateBlocks = selectedBlocks.length ? selectedBlocks : window.BlockSystem.blocks;
        const estimatedFiles = estimateOutputFileCount(estimateBlocks, chkLimit ? chkLimit.checked : false, charLimit);

        const elSelectedCount = document.getElementById('selected-blocks-count');
        const elSelectedChars = document.getElementById('selected-blocks-chars');
        const elMaxChars = document.getElementById('max-block-chars');
        const elEstimatedFiles = document.getElementById('estimated-output-files');
        if (elSelectedCount) elSelectedCount.textContent = selectedBlocks.length;
        if (elSelectedChars) elSelectedChars.textContent = totalSelectedChars.toLocaleString('vi-VN');
        if (elMaxChars) elMaxChars.textContent = maxBlockChars.toLocaleString('vi-VN');
        if (elEstimatedFiles) elEstimatedFiles.textContent = estimatedFiles.toLocaleString('vi-VN');
    }

    function render() {
        const countEl = document.getElementById('block-count');
        const chkSelectAllBlocks = document.getElementById('chk-select-all-blocks');

        if (countEl) countEl.textContent = window.BlockSystem.blocks.length;
        renderBlockList();
        syncEditorPanel();

        if (chkSelectAllBlocks) {
            chkSelectAllBlocks.checked = window.BlockSystem.blocks.length > 0 &&
                window.BlockSystem.blocks.every(block => window.BlockSystem.selectedDownloadIds?.has(block.id));
        }

        updateWorkspaceStats();
        updateUndoRedoButtons();
        updateDuplicateSummary();
    }

    function updateBlockEditorLimitHint() {
        const metaEl = document.getElementById('block-editor-meta');
        const selected = getSelectedBlock();
        if (!metaEl || !selected) return;

        const chars = selected.content.length;
        const capacity = cachedLocalStorageLimitBytes || (5 * 1024 * 1024);
        const lsFree = Math.max(capacity - getLocalStorageUsedBytes(), 0);
        const estimatedMax = Math.floor(lsFree / 2.3);
        const hint = cachedLocalStorageLimitBytes
            ? formatLimitNumber(Math.max(estimatedMax, 0))
            : 'mở Cài đặt để đo';
        metaEl.textContent = `Ký tự: ${chars.toLocaleString('vi-VN')} · tối đa ước tính/block: ${hint}`;
    }

    function selectBlock(id) {
        const prevId = window.BlockSystem.selectedId;
        const index = window.BlockSystem.blocks.findIndex(block => block.id === id);
        window.BlockSystem.selectedId = id;

        const listEl = document.getElementById('block-list');
        if (listEl && index >= 0 && window.BlockSystem.blocks.length >= VIRTUAL_SCROLL_THRESHOLD) {
            listEl.scrollTop = Math.max(0, index * BLOCK_ITEM_HEIGHT - BLOCK_ITEM_HEIGHT);
            renderBlockList();
            syncEditorPanel();
            updateWorkspaceStats();
            return;
        }

        const inDom = listEl?.querySelector(`[data-id="${CSS.escape(id)}"]`);
        if (inDom) {
            syncBlockListSelection(prevId, id);
            syncEditorPanel();
            updateWorkspaceStats();
            return;
        }
        render();
    }

    function numberToVietnameseWords(num) {
        if (num === 0) return 'không';
        
        const units = ['', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
        const tens = ['', 'mười', 'hai mươi', 'ba mươi', 'bốn mươi', 'năm mươi', 'sáu mươi', 'bảy mươi', 'tám mươi', 'chín mươi'];
        
        function convertGroup(n) {
            let res = '';
            const h = Math.floor(n / 100);
            const remainder = n % 100;
            const t = Math.floor(remainder / 10);
            const u = remainder % 10;
            
            if (h > 0) {
                res += units[h] + ' trăm';
                if (t === 0 && u > 0) {
                    res += ' lẻ ' + units[u];
                    return res;
                }
            }
            
            if (t > 0) {
                if (h > 0) res += ' ';
                res += tens[t];
                if (u > 0) {
                    if (u === 1 && t > 1) {
                        res += ' mốt';
                    } else if (u === 5) {
                        res += ' lăm';
                    } else {
                        res += ' ' + units[u];
                    }
                }
            } else if (u > 0) {
                if (h > 0) res += ' ';
                res += units[u];
            }
            return res;
        }

        let result = '';
        if (num >= 1000000) {
            const mil = Math.floor(num / 1000000);
            result += numberToVietnameseWords(mil) + ' triệu';
            num %= 1000000;
            if (num > 0) result += ' ';
        }
        
        if (num >= 1000) {
            const th = Math.floor(num / 1000);
            result += convertGroup(th) + ' nghìn';
            num %= 1000;
            if (num > 0) result += ' ';
        }
        
        if (num > 0) {
            result += convertGroup(num);
        }
        
        return result.trim();
    }

    function formatExportFilename(index, prefix, style, startNum) {
        const currentNum = startNum + index;
        let suffix = '';
        
        switch (style) {
            case 'num':
                suffix = `${currentNum}`;
                break;
            case 'paren':
                suffix = `(${currentNum})`;
                break;
            case 'padded':
                suffix = `_${currentNum.toString().padStart(4, '0')}`;
                break;
            case 'vi':
                suffix = `_${numberToVietnameseWords(currentNum).replaceAll(' ', '_')}`;
                break;
            default:
                suffix = `${currentNum}`;
        }
        
        if (!prefix) {
            return suffix;
        }
        
        if (style === 'paren') {
            return `${prefix}${suffix}`;
        } else if (style === 'num') {
            return `${prefix}_${suffix}`;
        } else {
            return `${prefix}${suffix}`;
        }
    }

    function downloadBlockFile(id) {
        const block = window.BlockSystem.blocks.find(item => item.id === id) || getSelectedBlock();
        if (!block) return;
        const blob = new Blob([block.content || ''], { type: 'text/plain;charset=utf-8' });
        const cleanTitle = (block.title || 'block').replace(/[\\/:*?"<>|\s]+/g, '_');
        downloadBlob(blob, `${cleanTitle}.txt`);
        showToast(`Đã tải ${cleanTitle}.txt`, 'success', 2200);
    }

    function toggleSelectedBlock(id) {
        if (!window.BlockSystem.selectedDownloadIds) {
            window.BlockSystem.selectedDownloadIds = new Set();
        }
        const wasSelected = window.BlockSystem.selectedDownloadIds.has(id);
        if (wasSelected) {
            window.BlockSystem.selectedDownloadIds.delete(id);
        } else {
            window.BlockSystem.selectedDownloadIds.add(id);
        }
        renderBlockList();
        updateWorkspaceStats();
        const count = window.BlockSystem.selectedDownloadIds.size;
        showToast(wasSelected ? `Bỏ chọn (còn ${count} block).` : `Đã chọn (tổng ${count} block).`, 'info', 1600);
    }

    async function downloadSelectedBlocks() {
        const ids = Array.from(window.BlockSystem.selectedDownloadIds || []);
        const blocks = window.BlockSystem.blocks.filter(item => ids.includes(item.id));
        if (!blocks.length) {
            showToast('Hãy chọn ít nhất 1 Block để tải.', 'warning');
            return;
        }

        if (!window.JSZip) {
            showToast('JSZip chưa sẵn sàng. Hãy tải lại trang.', 'error');
            return;
        }

        const chkRename = document.getElementById('chk-rename-on-export');
        const shouldRename = chkRename ? chkRename.checked : false;
        const prefix = document.getElementById('export-prefix')?.value.trim() || '';
        const style = document.getElementById('export-number-style')?.value || 'num';
        const startNum = parseInt(document.getElementById('export-start-num')?.value, 10) || 1;

        const chkLimit = document.getElementById('chk-limit-chars');
        const useCharLimit = chkLimit ? chkLimit.checked : false;
        const charLimit = parseInt(document.getElementById('export-char-limit')?.value, 10) || 50000;

        // --- Nếu bật giới hạn ký tự: gộp nhiều block nhỏ vào 1 file, tách block lớn thành nhiều file ---
        let outputFiles = []; // [{name, content}]

        if (useCharLimit) {
            let fileIndex = 0;
            let currentContent = '';
            let currentParts = [];

            const flushFile = () => {
                if (currentParts.length === 0) return;
                const content = currentParts.join('\n\n').trim();
                const base = shouldRename
                    ? formatExportFilename(fileIndex, prefix, style, startNum)
                    : `${prefix || 'file'}_${fileIndex + 1}`;
                outputFiles.push({ name: `${base}.txt`, content });
                fileIndex++;
                currentParts = [];
                currentContent = '';
            };

            for (const block of blocks) {
                const text = block.content || '';

                // Nếu block đơn lẻ vượt giới hạn → tách thành nhiều đoạn
                if (text.length > charLimit) {
                    flushFile(); // Đẩy file đang xây dựng trước
                    let remaining = text;
                    while (remaining.length > 0) {
                        // Cắt tại charLimit, ưu tiên cắt tại dòng mới
                        let cutAt = charLimit;
                        if (remaining.length > charLimit) {
                            const nlIdx = remaining.lastIndexOf('\n', charLimit);
                            if (nlIdx > charLimit * 0.5) cutAt = nlIdx + 1;
                        }
                        const part = remaining.slice(0, cutAt).trim();
                        remaining = remaining.slice(cutAt);
                        const base = shouldRename
                            ? formatExportFilename(fileIndex, prefix, style, startNum)
                            : `${prefix || 'file'}_${fileIndex + 1}`;
                        outputFiles.push({ name: `${base}.txt`, content: part });
                        fileIndex++;
                    }
                } else if (currentContent.length + text.length + 2 > charLimit) {
                    // Thêm block này sẽ vượt giới hạn → đẩy file hiện tại trước
                    flushFile();
                    currentParts.push(text);
                    currentContent = text;
                } else {
                    currentParts.push(text);
                    currentContent += (currentContent ? '\n\n' : '') + text;
                }
            }
            flushFile(); // Đẩy phần còn lại

        } else {
            // Không giới hạn ký tự: mỗi block = 1 file
            blocks.forEach((block, index) => {
                let fileName = '';
                if (shouldRename) {
                    const base = formatExportFilename(index, prefix, style, startNum);
                    fileName = `${base}.txt`;
                } else {
                    const base = (block.title || 'block').replace(/[\\/:*?"<>|\s]+/g, '_').trim();
                    fileName = `${base || 'block'}.txt`;
                }
                outputFiles.push({ name: fileName, content: block.content || '' });
            });
        }

        // Loại bỏ tên trùng
        const usedNames = new Set();
        const zip = new JSZip();
        for (const file of outputFiles) {
            let finalName = file.name;
            let dupCounter = 1;
            while (usedNames.has(finalName)) {
                const baseWithoutExt = file.name.replace(/\.txt$/i, '');
                finalName = `${baseWithoutExt}_${dupCounter}.txt`;
                dupCounter++;
            }
            usedNames.add(finalName);
            zip.file(finalName, file.content);
        }

        const blob = await zip.generateAsync({ type: 'blob' });
        const totalFiles = outputFiles.length;
        downloadBlob(blob, 'blocks-selected.zip');
        if (useCharLimit) {
            const maxChar = charLimit.toLocaleString('vi-VN');
            showToast(`Đã xuất ZIP gồm ${totalFiles} file, mỗi file tối đa ${maxChar} ký tự.`, 'success');
        } else {
            showToast(`Đã xuất ZIP gồm ${totalFiles} file.`, 'success');
        }
    }



    function setBlocks(blocks, options = {}) {
        if (!options.skipHistory) pushHistory('cập nhật blocks');
        window.BlockSystem.blocks = Array.isArray(blocks) ? blocks.map(normalizeBlock) : [];
        if (!window.BlockSystem.blocks.length) {
            window.BlockSystem.blocks = [createBlock(getDefaultBlockTitle(0), '')];
        }
        window.BlockSystem.selectedId = window.BlockSystem.blocks[0].id;
        persist();
        render();
    }

    function addBlock(title, content = '', options = {}) {
        if (!options.skipHistory) pushHistory('thêm block');
        const blockTitle = title || getDefaultBlockTitle(window.BlockSystem.blocks.length);
        const block = createBlock(blockTitle, content);
        window.BlockSystem.blocks.push(block);
        window.BlockSystem.selectedId = block.id;
        persist();
        render();
        if (!options.silent) {
            showToast(`Đã tạo ${block.title}`, 'success', 2000);
        }
        scheduleDuplicateScan(false);
        return block;
    }

    function pasteQuick() {
        if (!navigator.clipboard || !navigator.clipboard.readText) {
            showToast('Trình duyệt không hỗ trợ đọc Clipboard.', 'error');
            return;
        }

        navigator.clipboard.readText().then(text => {
            const clean = text.replace(/\r\n/g, '\n');
            const title = inferBlockTitle(clean, 'Block mới');
            pushHistory('paste nhanh');
            const block = createBlock(title, clean);
            window.BlockSystem.blocks.push(block);
            window.BlockSystem.selectedId = block.id;
            persist();
            render();
            showToast('Đã tạo Block mới từ nội dung Clipboard.', 'success');
        }).catch(() => showToast('Không thể đọc Clipboard.', 'error'));
    }

    function splitAtCursor() {
        const block = getSelectedBlock();
        const editor = document.getElementById('block-editor');
        if (!block || !editor) return;
        const cursor = editor.selectionStart;
        if (cursor <= 0 || cursor >= block.content.length) {
            showToast('Hãy đặt con trỏ ở giữa nội dung để tách.', 'warning');
            return;
        }

        pushHistory('tách block');
        const first = block.content.slice(0, cursor);
        const second = block.content.slice(cursor);
        block.content = first.trimEnd();
        block.characterCount = block.content.length;
        block.title = inferBlockTitle(block.content, block.title || 'Block mới');
        const newBlock = createBlock(inferBlockTitle(second, `${block.title || 'Block mới'} (phần 2)`), second.trimStart());
        const index = window.BlockSystem.blocks.findIndex(item => item.id === block.id);
        window.BlockSystem.blocks.splice(index + 1, 0, newBlock);
        window.BlockSystem.selectedId = newBlock.id;
        persist();
        render();
        showToast('Đã tách Block hiện tại thành 2 Block.', 'success');
    }

    function mergeWithPrevious(id) {
        const index = window.BlockSystem.blocks.findIndex(item => item.id === id);
        if (index <= 0) {
            showToast('Không có Block trước để gộp.', 'warning');
            return;
        }
        pushHistory('gộp block');
        const current = window.BlockSystem.blocks[index];
        const previous = window.BlockSystem.blocks[index - 1];
        previous.content = `${previous.content}\n\n${current.content}`.trim();
        previous.characterCount = previous.content.length;
        previous.title = previous.title || 'Block mới';
        window.BlockSystem.blocks.splice(index, 1);
        window.BlockSystem.selectedId = previous.id;
        persist();
        render();
        showToast('Đã gộp với Block trước.', 'success');
    }

    function mergeWithNext(id) {
        const index = window.BlockSystem.blocks.findIndex(item => item.id === id);
        if (index === -1 || index >= window.BlockSystem.blocks.length - 1) {
            showToast('Không có Block sau để gộp.', 'warning');
            return;
        }
        pushHistory('gộp block');
        const current = window.BlockSystem.blocks[index];
        const next = window.BlockSystem.blocks[index + 1];
        current.content = `${current.content}\n\n${next.content}`.trim();
        current.characterCount = current.content.length;
        window.BlockSystem.blocks.splice(index + 1, 1);
        window.BlockSystem.selectedId = current.id;
        persist();
        render();
        showToast('Đã gộp với Block sau.', 'success');
    }

    function duplicateBlock(id) {
        const block = window.BlockSystem.blocks.find(item => item.id === id);
        if (!block) return;
        pushHistory('nhân đôi block');
        const copy = createBlock(`${block.title} (copy)`, block.content);
        const index = window.BlockSystem.blocks.findIndex(item => item.id === id);
        window.BlockSystem.blocks.splice(index + 1, 0, copy);
        window.BlockSystem.selectedId = copy.id;
        persist();
        render();
        showToast('Đã nhân bản block.', 'success', 2000);
        scheduleDuplicateScan(false);
    }

    function renameBlock(id) {
        const block = window.BlockSystem.blocks.find(item => item.id === id);
        if (!block) return;
        const value = window.prompt('Đổi tên Block:', block.title);
        if (value !== null) {
            pushHistory('đổi tên block');
            block.title = value.trim() || 'Block mới';
            persist();
            render();
            showToast(`Đã đổi tên thành "${block.title}"`, 'success', 2200);
        }
    }

    function removeBlock(id) {
        const index = window.BlockSystem.blocks.findIndex(item => item.id === id);
        if (index === -1) return;
        if (!window.confirm('Bạn có chắc muốn xóa Block này?')) return;
        pushHistory('xóa block');
        window.BlockSystem.blocks.splice(index, 1);
        if (!window.BlockSystem.blocks.length) {
            window.BlockSystem.blocks = [createBlock(getDefaultBlockTitle(0), '')];
        }
        window.BlockSystem.selectedId = window.BlockSystem.blocks[Math.max(0, index - 1)].id;
        persist();
        render();
        showToast('Đã xóa block.', 'success');
        scheduleDuplicateScan(false);
    }

    function reorderBlocks(fromId, toId) {
        const fromIndex = window.BlockSystem.blocks.findIndex(item => item.id === fromId);
        const toIndex = window.BlockSystem.blocks.findIndex(item => item.id === toId);
        if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
        pushHistory('sắp xếp block');
        const [moved] = window.BlockSystem.blocks.splice(fromIndex, 1);
        window.BlockSystem.blocks.splice(toIndex, 0, moved);
        persist();
    }

    function saveProject() {
        const blob = new Blob([JSON.stringify({ blocks: window.BlockSystem.blocks }, null, 2)], { type: 'application/json' });
        downloadBlob(blob, 'project.json');
        showToast('Đã tải project.json', 'success');
    }

    function exportTxt() {
        const text = window.BlockSystem.blocks.map(block => block.content || '').filter(Boolean).join('\n\n');
        downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), 'export.txt');
        showToast('Đã xuất export.txt', 'success');
    }

    async function exportDocx() {
        if (!window.JSZip) {
            showToast('JSZip chưa sẵn sàng. Hãy tải lại trang.', 'error');
            return;
        }
        const zip = new JSZip();
        const text = window.BlockSystem.blocks.map(block => block.content || '').filter(Boolean).join('\n\n');
        const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>
  </w:body>
</w:document>`;
        zip.file('word/document.xml', xml);
        zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
        zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
        zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
        const blob = await zip.generateAsync({ type: 'blob' });
        downloadBlob(blob, 'export.docx');
        showToast('Đã xuất export.docx', 'success');
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

    function formatBytes(bytes) {
        if (!bytes) return '0 ký tự';
        return `${bytes} ký tự`;
    }

    function escapeHtml(str) {
        return String(str)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;');
    }

    function escapeXml(str) {
        return String(str)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;');
    }
})();

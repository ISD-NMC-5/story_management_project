"use strict";

const CONFIG = {
  dbName: "OfflineChineseVietnameseTranslatorV2",
  dbVersion: 3,
  previewLimit: 80000,
  analysisLimit: 0,
  previewRefreshEvery: 5,
  stores: {
    metadata: "metadata",
    stories: "stories",
    source: "sourceChunks",
    translated: "translatedChunks",
    dictionaries: "dictionaryFiles",
  },
};

const DEFAULT_PRIORITY = {
  luatnhan: 1,
  pronouns: 2,
  chinesephienamwords: 3,
  vietphrase: 4,
  names: 5,
};

const state = {
  db: null,
  worker: null,
  workerReady: false,
  translating: false,
  paused: false,
  importing: false,
  currentWorkerResolve: null,
  currentWorkerReject: null,
  previewChunk: 0,
  activeStoryId: "",
  translatingStoryId: "",
  dictionaries: [],
  metadata: createEmptyMetadata(),
};

const ui = {
  storyDrop: document.getElementById("storyDrop"),
  storyInput: document.getElementById("storyInput"),
  storyInfo: document.getElementById("storyInfo"),
  storyName: document.getElementById("storyName"),
  storySize: document.getElementById("storySize"),
  storyLines: document.getElementById("storyLines"),
  storyChunks: document.getElementById("storyChunks"),
  storyList: document.getElementById("storyList"),
  selectAllStoriesButton: document.getElementById("selectAllStoriesButton"),
  clearStorySelectionButton: document.getElementById("clearStorySelectionButton"),
  dictInput: document.getElementById("dictInput"),
  chooseDictButton: document.getElementById("chooseDictButton"),
  clearDictButton: document.getElementById("clearDictButton"),
  dictSummary: document.getElementById("dictSummary"),
  dictList: document.getElementById("dictList"),
  chunkSize: document.getElementById("chunkSize"),
  applyRules: document.getElementById("applyRules"),
  chapterRegex: document.getElementById("chapterRegex"),
  normalizePunctuation: document.getElementById("normalizePunctuation"),
  keepUnknown: document.getElementById("keepUnknown"),
  capitalizeSentences: document.getElementById("capitalizeSentences"),
  exportName: document.getElementById("exportName"),
  exportButton: document.getElementById("exportButton"),
  exportClearButton: document.getElementById("exportClearButton"),
  deleteAllButton: document.getElementById("deleteAllButton"),
  storageText: document.getElementById("storageText"),
  storageBar: document.getElementById("storageBar"),
  startButton: document.getElementById("startButton"),
  pauseButton: document.getElementById("pauseButton"),
  progressValue: document.getElementById("progressValue"),
  translatedBytes: document.getElementById("translatedBytes"),
  translatedLines: document.getElementById("translatedLines"),
  dictionaryEntries: document.getElementById("dictionaryEntries"),
  progressStatus: document.getElementById("progressStatus"),
  chunkStatus: document.getElementById("chunkStatus"),
  progressBar: document.getElementById("progressBar"),
  statusBox: document.getElementById("statusBox"),
  jumpChunk: document.getElementById("jumpChunk"),
  jumpButton: document.getElementById("jumpButton"),
  prevButton: document.getElementById("prevButton"),
  nextButton: document.getElementById("nextButton"),
  previewPosition: document.getElementById("previewPosition"),
  sourcePreview: document.getElementById("sourcePreview"),
  translatedPreview: document.getElementById("translatedPreview"),
  sourceCount: document.getElementById("sourceCount"),
  translatedCount: document.getElementById("translatedCount"),
  analysisList: document.getElementById("analysisList"),
  analysisCount: document.getElementById("analysisCount"),
  logBox: document.getElementById("logBox"),
  clearLogButton: document.getElementById("clearLogButton"),
};

function createEmptyMetadata() {
  return {
    stories: [],
    activeStoryId: "",
    dictionaryEntries: 0,
    status: "idle",
  };
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CONFIG.dbName, CONFIG.dbVersion);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(CONFIG.stores.metadata)) {
        db.createObjectStore(CONFIG.stores.metadata, { keyPath: "key" });
      }
      if (event.oldVersion < 3) {
        if (db.objectStoreNames.contains(CONFIG.stores.source)) {
          db.deleteObjectStore(CONFIG.stores.source);
        }
        if (db.objectStoreNames.contains(CONFIG.stores.translated)) {
          db.deleteObjectStore(CONFIG.stores.translated);
        }
      }
      if (!db.objectStoreNames.contains(CONFIG.stores.stories)) {
        db.createObjectStore(CONFIG.stores.stories, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(CONFIG.stores.source)) {
        db.createObjectStore(CONFIG.stores.source, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(CONFIG.stores.translated)) {
        db.createObjectStore(CONFIG.stores.translated, {
          keyPath: "id",
        });
      }
      if (!db.objectStoreNames.contains(CONFIG.stores.dictionaries)) {
        db.createObjectStore(CONFIG.stores.dictionaries, {
          keyPath: "id",
        });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("Không thể mở IndexedDB."));
  });
}

function store(name, mode = "readonly") {
  return state.db.transaction(name, mode).objectStore(name);
}

function idbPut(name, value) {
  return new Promise((resolve, reject) => {
    const request = store(name, "readwrite").put(value);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbGet(name, key) {
  return new Promise((resolve, reject) => {
    const request = store(name).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbGetAll(name) {
  return new Promise((resolve, reject) => {
    const request = store(name).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function idbClear(name) {
  return new Promise((resolve, reject) => {
    const request = store(name, "readwrite").clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function idbDelete(name, key) {
  return new Promise((resolve, reject) => {
    const request = store(name, "readwrite").delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function compactStoredAnalysis() {
  if (CONFIG.analysisLimit) return Promise.resolve(0);
  return new Promise((resolve, reject) => {
    let cleaned = 0;
    const transaction = state.db.transaction(CONFIG.stores.translated, "readwrite");
    const objectStore = transaction.objectStore(CONFIG.stores.translated);
    const request = objectStore.openCursor();

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (!cursor) return;
      const value = cursor.value;
      if (
        value &&
        (Object.prototype.hasOwnProperty.call(value, "trace") ||
          Object.prototype.hasOwnProperty.call(value, "traceTruncated"))
      ) {
        delete value.trace;
        delete value.traceTruncated;
        const updateRequest = cursor.update(value);
        updateRequest.onsuccess = () => cursor.continue();
        updateRequest.onerror = () => reject(updateRequest.error);
        cleaned++;
        return;
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => resolve(cleaned);
    transaction.onerror = () => reject(transaction.error);
  });
}

function storyChunkKey(storyId, index) {
  return `${storyId}:${index}`;
}

function makeId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function activeStory() {
  return (
    state.metadata.stories.find(
      (story) => story.id === state.metadata.activeStoryId,
    ) ||
    state.metadata.stories[0] ||
    null
  );
}

function selectedStories({ includeCompleted = true } = {}) {
  return state.metadata.stories.filter(
    (story) =>
      story.selected &&
      story.totalChunks > 0 &&
      (includeCompleted || story.currentChunk < story.totalChunks),
  );
}

function storyExportName(story) {
  return safeFileName(`${story.fileName.replace(/\.txt$/i, "")}-viet.txt`);
}

async function persistStories() {
  await idbClear(CONFIG.stores.stories);
  for (const story of state.metadata.stories) {
    await idbPut(CONFIG.stores.stories, story);
  }
  if (
    !state.metadata.stories.some(
      (story) => story.id === state.metadata.activeStoryId,
    )
  ) {
    state.metadata.activeStoryId = state.metadata.stories[0]?.id || "";
  }
  await saveMetadata();
}

async function deleteStoryChunks(storyId) {
  const [sources, translated] = await Promise.all([
    idbGetAll(CONFIG.stores.source),
    idbGetAll(CONFIG.stores.translated),
  ]);
  await Promise.all([
    ...sources
      .filter((chunk) => chunk.storyId === storyId)
      .map((chunk) => idbDelete(CONFIG.stores.source, chunk.id)),
    ...translated
      .filter((chunk) => chunk.storyId === storyId)
      .map((chunk) => idbDelete(CONFIG.stores.translated, chunk.id)),
  ]);
}

async function saveMetadata() {
  await idbPut(CONFIG.stores.metadata, {
    key: "project",
    value: { ...state.metadata },
  });
}

async function restoreMetadata() {
  const record = await idbGet(CONFIG.stores.metadata, "project");
  const stories = await idbGetAll(CONFIG.stores.stories);
  const saved = record?.value || {};
  state.metadata = { ...createEmptyMetadata(), ...saved };
  state.metadata.stories = stories.length
    ? stories
    : Array.isArray(saved.stories)
      ? saved.stories
      : [];
  state.metadata.stories.forEach((story) => {
    if (story.status === "translating" || story.status === "initializing") {
      story.status = "paused";
    }
    story.selected = story.selected !== false;
  });
  state.metadata.activeStoryId =
    saved.activeStoryId || state.metadata.stories[0]?.id || "";
  state.previewChunk = activeStory()?.currentChunk
    ? Math.max(0, activeStory().currentChunk - 1)
    : 0;
  await persistStories();
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function formatTime(date = new Date()) {
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function log(message, level = "INFO") {
  const line = `[${formatTime()}] [${level}] ${message}`;
  ui.logBox.textContent += `${ui.logBox.textContent ? "\n" : ""}${line}`;
  ui.logBox.scrollTop = ui.logBox.scrollHeight;
}

function setStatus(message, type = "info") {
  const icon =
    { info: "ℹ️", success: "✅", warning: "⚠️", error: "❌" }[type] || "ℹ️";
  ui.statusBox.className = "status";
  if (type !== "info") ui.statusBox.classList.add(`${type}-status`);
  ui.statusBox.innerHTML = "";
  const iconNode = document.createElement("span");
  const textNode = document.createElement("div");
  iconNode.textContent = icon;
  textNode.textContent = message;
  ui.statusBox.append(iconNode, textNode);
}

function safeFileName(value) {
  let name = String(value || "truyen-viet.txt")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_");
  if (!name.toLowerCase().endsWith(".txt")) name += ".txt";
  return name || "truyen-viet.txt";
}

function dictionaryKind(name) {
  const normalized = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  for (const key of Object.keys(DEFAULT_PRIORITY)) {
    if (normalized.includes(key)) return key;
  }
  return "custom";
}

function defaultPriorityFor(name, fallback) {
  return DEFAULT_PRIORITY[dictionaryKind(name)] || fallback;
}

function sortDictionaries() {
  state.dictionaries.sort((a, b) => (a.priority || 0) - (b.priority || 0));
  state.dictionaries.forEach((item, index) => {
    item.priority = index + 1;
  });
}

async function persistDictionaries() {
  await idbClear(CONFIG.stores.dictionaries);
  sortDictionaries();
  for (const dictionary of state.dictionaries) {
    await idbPut(CONFIG.stores.dictionaries, dictionary);
  }
}

async function restoreDictionaries() {
  state.dictionaries = await idbGetAll(CONFIG.stores.dictionaries);
  sortDictionaries();
}

function updateDictionaryUi() {
  sortDictionaries();
  const totalBytes = state.dictionaries.reduce(
    (sum, item) => sum + (item.size || 0),
    0,
  );
  ui.dictSummary.textContent = state.dictionaries.length
    ? `${state.dictionaries.length} tệp · ${formatBytes(totalBytes)} · ưu tiên thấp ở trên, cao ở dưới`
    : "Chưa có từ điển.";
  ui.dictList.innerHTML = "";

  if (!state.dictionaries.length) {
    const empty = document.createElement("div");
    empty.className = "dict-empty";
    empty.textContent =
      "Tệp ở dưới có ưu tiên cao hơn. Mỗi mục từ chỉ giữ nghĩa đầu tiên trước dấu “/”.";
    ui.dictList.appendChild(empty);
    return;
  }

  state.dictionaries.forEach((item, index) => {
    const card = document.createElement("div");
    card.className = "dict-card";
    const top = document.createElement("div");
    top.className = "dict-top";
    const info = document.createElement("div");
    const name = document.createElement("div");
    name.className = "dict-name";
    name.textContent = item.name;
    const meta = document.createElement("div");
    meta.className = "dict-meta";
    meta.textContent = `${formatBytes(item.size)} · ${dictionaryKind(item.name)}`;
    info.append(name, meta);
    const priority = document.createElement("span");
    priority.className = "priority";
    priority.textContent = `${index + 1}/${state.dictionaries.length}${index === state.dictionaries.length - 1 ? " · cao nhất" : ""}`;
    top.append(info, priority);

    const actions = document.createElement("div");
    actions.className = "dict-actions";
    const up = document.createElement("button");
    up.className = "btn light";
    up.type = "button";
    up.textContent = "↑ Giảm";
    up.disabled = index === 0 || state.translating;
    up.addEventListener("click", () => moveDictionary(item.id, -1));
    const down = document.createElement("button");
    down.className = "btn light";
    down.type = "button";
    down.textContent = "↓ Tăng";
    down.disabled =
      index === state.dictionaries.length - 1 || state.translating;
    down.addEventListener("click", () => moveDictionary(item.id, 1));
    const remove = document.createElement("button");
    remove.className = "btn danger";
    remove.type = "button";
    remove.textContent = "Xóa";
    remove.disabled = state.translating;
    remove.addEventListener("click", () => removeDictionary(item.id));
    actions.append(up, down, remove);
    card.append(top, actions);
    ui.dictList.appendChild(card);
  });
}

async function moveDictionary(id, direction) {
  sortDictionaries();
  const index = state.dictionaries.findIndex((item) => item.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= state.dictionaries.length) return;
  [state.dictionaries[index], state.dictionaries[target]] = [
    state.dictionaries[target],
    state.dictionaries[index],
  ];
  await persistDictionaries();
  updateDictionaryUi();
  log("Đã thay đổi thứ tự ưu tiên từ điển.");
}

async function removeDictionary(id) {
  const item = state.dictionaries.find((dictionary) => dictionary.id === id);
  if (!item) return;
  state.dictionaries = state.dictionaries.filter(
    (dictionary) => dictionary.id !== id,
  );
  await idbDelete(CONFIG.stores.dictionaries, id);
  await persistDictionaries();
  updateDictionaryUi();
  updateButtons();
  log(`Đã xóa từ điển ${item.name}.`);
}

function updateStoryUi() {
  const data = activeStory();
  ui.storyList.innerHTML = "";
  if (!state.metadata.stories.length) {
    ui.storyInfo.classList.remove("show");
    const empty = document.createElement("div");
    empty.className = "story-empty";
    empty.textContent = "Chưa có truyện nào. Hãy chọn một hoặc nhiều tệp TXT.";
    ui.storyList.appendChild(empty);
    return;
  }

  state.metadata.stories.forEach((story) => {
    const item = document.createElement("div");
    item.className = "story-card";
    if (story.id === data?.id) item.classList.add("active");

    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = story.selected !== false;
    check.disabled = state.translating || state.importing;
    check.addEventListener("change", async (event) => {
      story.selected = event.target.checked;
      await persistStories();
      refreshUi();
    });

    const main = document.createElement("button");
    main.type = "button";
    main.className = "story-main";
    main.disabled = state.importing;
    main.addEventListener("click", async () => {
      state.metadata.activeStoryId = story.id;
      state.previewChunk = story.currentChunk
        ? Math.min(story.currentChunk - 1, story.totalChunks - 1)
        : 0;
      await persistStories();
      refreshUi();
      await showPreview(state.previewChunk, story.id);
    });

    const name = document.createElement("span");
    name.className = "story-title";
    name.textContent = story.fileName;
    const meta = document.createElement("span");
    meta.className = "story-meta";
    const percent = story.totalChunks
      ? Math.min(100, (story.currentChunk / story.totalChunks) * 100)
      : 0;
    meta.textContent = `${percent.toFixed(1)}% · ${story.currentChunk}/${story.totalChunks} khối · ${formatBytes(story.fileSize)}`;
    main.append(name, meta);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn danger story-delete";
    remove.textContent = "Xóa";
    remove.disabled = state.translating || state.importing;
    remove.addEventListener("click", () => deleteStory(story.id));

    item.append(check, main, remove);
    ui.storyList.appendChild(item);
  });

  if (!data) {
    ui.storyInfo.classList.remove("show");
    return;
  }
  ui.storyInfo.classList.add("show");
  ui.storyName.textContent = data.fileName;
  ui.storySize.textContent = formatBytes(data.fileSize);
  ui.storyLines.textContent = Number(data.totalLines || 0).toLocaleString(
    "vi-VN",
  );
  ui.storyChunks.textContent = Number(data.totalChunks || 0).toLocaleString(
    "vi-VN",
  );
  ui.jumpChunk.max = Math.max(1, data.totalChunks || 1);
  if (!ui.exportName.dataset.edited) {
    ui.exportName.value = state.metadata.stories.length > 1
      ? "xuat-cac-truyen-da-chon"
      : storyExportName(data);
  }
}

function updateProgressUi() {
  const selected = selectedStories();
  const progressStories = selected.length ? selected : state.metadata.stories;
  const total = progressStories.reduce(
    (sum, story) => sum + (story.totalChunks || 0),
    0,
  );
  const current = progressStories.reduce(
    (sum, story) => sum + (story.currentChunk || 0),
    0,
  );
  const percent = total ? Math.min(100, (current / total) * 100) : 0;
  ui.progressValue.textContent = `${percent.toFixed(1)}%`;
  ui.progressBar.style.width = `${percent.toFixed(2)}%`;
  ui.translatedBytes.textContent = formatBytes(
    progressStories.reduce((sum, story) => sum + (story.translatedBytes || 0), 0),
  );
  ui.translatedLines.textContent = Number(
    progressStories.reduce((sum, story) => sum + (story.translatedLines || 0), 0),
  ).toLocaleString("vi-VN");
  ui.dictionaryEntries.textContent = Number(
    state.metadata.dictionaryEntries || 0,
  ).toLocaleString("vi-VN");
  ui.chunkStatus.textContent = `${current.toLocaleString("vi-VN")} / ${total.toLocaleString("vi-VN")} khối`;
  const active = activeStory();
  const status = state.translating
    ? "translating"
    : state.importing
      ? "importing"
      : active?.status || state.metadata.status;
  const labels = {
    idle: "Chưa có tác vụ",
    importing: "Đang nhập truyện",
    ready: "Sẵn sàng",
    initializing: "Đang nạp từ điển",
    translating: "Đang dịch",
    paused: "Đã tạm dừng",
    completed: "Đã hoàn thành",
    error: "Có lỗi",
  };
  ui.progressStatus.textContent =
    labels[status] || status;
}

function updateButtons() {
  const selected = selectedStories({ includeCompleted: false });
  const hasStory = selected.length > 0;
  const hasDicts = state.dictionaries.length > 0;
  ui.startButton.disabled =
    state.importing ||
    state.translating ||
    !hasStory ||
    !hasDicts;
  ui.pauseButton.disabled = !state.translating || state.paused;
  ui.storyInput.disabled = state.importing || state.translating;
  ui.selectAllStoriesButton.disabled =
    state.importing || state.translating || !state.metadata.stories.length;
  ui.clearStorySelectionButton.disabled =
    state.importing || state.translating || !state.metadata.stories.length;
  ui.chooseDictButton.disabled = state.translating;
  ui.clearDictButton.disabled = state.translating || !hasDicts;
  const hasResult = selectedStories().some((story) => story.currentChunk > 0);
  ui.exportButton.disabled = !hasResult;
  ui.exportClearButton.disabled = !hasResult;
}

function refreshUi() {
  updateStoryUi();
  updateDictionaryUi();
  updateProgressUi();
  updateButtons();
}

async function loadDictionaryFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length || state.translating) return;
  let fallback = 100;
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith(".txt")) continue;
    const buffer = await file.arrayBuffer();
    const existing = state.dictionaries.find(
      (item) => item.name.toLowerCase() === file.name.toLowerCase(),
    );
    const record = {
      id:
        existing?.id ||
        (crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`),
      name: file.name,
      size: file.size,
      priority: existing?.priority || defaultPriorityFor(file.name, fallback++),
      buffer,
      addedAt: Date.now(),
    };
    state.dictionaries = state.dictionaries.filter(
      (item) =>
        item.id !== record.id &&
        item.name.toLowerCase() !== record.name.toLowerCase(),
    );
    state.dictionaries.push(record);
    log(`Đã lưu từ điển ${file.name} (${formatBytes(file.size)}).`);
  }
  state.dictionaries.sort((a, b) => {
    const pa = DEFAULT_PRIORITY[dictionaryKind(a.name)] || a.priority || 100;
    const pb = DEFAULT_PRIORITY[dictionaryKind(b.name)] || b.priority || 100;
    return pa - pb;
  });
  await persistDictionaries();
  refreshUi();
  setStatus(`Đã nạp ${files.length} tệp từ điển.`, "success");
  await updateStorage();
}

async function clearDictionaries() {
  if (!state.dictionaries.length || state.translating) return;
  if (!confirm("Xóa toàn bộ từ điển đã lưu?")) return;
  state.dictionaries = [];
  state.metadata.dictionaryEntries = 0;
  await idbClear(CONFIG.stores.dictionaries);
  await saveMetadata();
  refreshUi();
  setStatus("Đã xóa toàn bộ từ điển.", "success");
}

async function importStories(fileList) {
  const files = Array.from(fileList || []).filter((file) =>
    file.name.toLowerCase().endsWith(".txt"),
  );
  if (!files.length || state.importing || state.translating) {
    if (fileList?.length) setStatus("Vui lòng chọn tệp TXT.", "warning");
    return;
  }

  state.importing = true;
  for (const file of files) {
    await importSingleStory(file);
  }
  state.importing = false;
  refreshUi();
  await updateStorage();
  setStatus(`Đã tải lên ${files.length} truyện TXT.`, "success");
}

async function importSingleStory(file) {
  if (!file.name.toLowerCase().endsWith(".txt")) {
    setStatus("Vui lòng chọn tệp TXT.", "warning");
    return;
  }
  const existing = state.metadata.stories.find(
    (story) => story.fileName.toLowerCase() === file.name.toLowerCase(),
  );
  if (existing) {
    await deleteStoryChunks(existing.id);
    state.metadata.stories = state.metadata.stories.filter(
      (story) => story.id !== existing.id,
    );
  }

  const story = {
    id: makeId(),
    fileName: file.name,
    fileSize: file.size,
    totalLines: 0,
    totalChunks: 0,
    currentChunk: 0,
    translatedBytes: 0,
    translatedLines: 0,
    selected: true,
    status: "importing",
    startedAt: null,
    completedAt: null,
    addedAt: Date.now(),
  };
  state.metadata.stories.push(story);
  state.metadata.activeStoryId = story.id;
  refreshUi();
  setStatus(`Đang đọc và chia ${file.name} thành các khối...`, "info");
  log(`Bắt đầu nhập ${file.name}.`);

  const readSize = Number(ui.chunkSize.value) || 524288;
  const decoder = new TextDecoder("utf-8");
  let offset = 0;
  let pending = "";
  let chunkIndex = 0;
  let newlineCount = 0;

  try {
    while (offset < file.size) {
      const end = Math.min(offset + readSize, file.size);
      const buffer = await file.slice(offset, end).arrayBuffer();
      let text = pending + decoder.decode(buffer, { stream: end < file.size });
      let toStore = text;
      if (end < file.size) {
        const lastNewline = text.lastIndexOf("\n");
        if (lastNewline >= 0) {
          toStore = text.slice(0, lastNewline + 1);
          pending = text.slice(lastNewline + 1);
        } else {
          pending = text;
          toStore = "";
        }
      } else {
        pending = "";
      }

      if (toStore) {
        newlineCount += (toStore.match(/\n/g) || []).length;
        await idbPut(CONFIG.stores.source, {
          id: storyChunkKey(story.id, chunkIndex),
          storyId: story.id,
          index: chunkIndex,
          text: toStore,
        });
        chunkIndex++;
      }
      offset = end;
      const percent = file.size ? (offset / file.size) * 100 : 100;
      ui.progressValue.textContent = `${percent.toFixed(1)}%`;
      ui.progressBar.style.width = `${percent.toFixed(2)}%`;
      ui.chunkStatus.textContent = `${formatBytes(offset)} / ${formatBytes(file.size)}`;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const tail = pending + decoder.decode();
    if (tail) {
      newlineCount += (tail.match(/\n/g) || []).length;
      await idbPut(CONFIG.stores.source, {
        id: storyChunkKey(story.id, chunkIndex),
        storyId: story.id,
        index: chunkIndex,
        text: tail,
      });
      chunkIndex++;
    }

    story.totalChunks = chunkIndex;
    story.totalLines = file.size ? newlineCount + 1 : 0;
    story.status = "ready";
    state.metadata.status = "ready";
    await persistStories();
    refreshUi();
    await showPreview(0, story.id);
    setStatus(`Đã nhập ${file.name} thành ${chunkIndex} khối.`, "success");
    log(
      `Hoàn tất nhập ${file.name}: ${chunkIndex} khối, ${story.totalLines.toLocaleString("vi-VN")} dòng.`,
    );
  } catch (error) {
    story.status = "error";
    await persistStories();
    setStatus(`Lỗi nhập ${file.name}: ${error.message}`, "error");
    log(`Lỗi nhập ${file.name}: ${error.message}`, "ERROR");
  }
}

async function deleteStory(storyId) {
  const story = state.metadata.stories.find((item) => item.id === storyId);
  if (!story || state.translating || state.importing) return;
  if (!confirm(`Xóa truyện "${story.fileName}" và bản dịch đã lưu?`)) return;
  await deleteStoryChunks(story.id);
  state.metadata.stories = state.metadata.stories.filter(
    (item) => item.id !== story.id,
  );
  if (state.metadata.activeStoryId === story.id) {
    state.metadata.activeStoryId = state.metadata.stories[0]?.id || "";
    state.previewChunk = 0;
  }
  await persistStories();
  refreshUi();
  await showPreview(0);
  await updateStorage();
  setStatus(`Đã xóa truyện ${story.fileName}.`, "success");
  log(`Đã xóa truyện ${story.fileName}.`);
}

/*
 * Worker được tạo từ chính thân hàm JavaScript. Cách này tránh việc phải
 * nhúng regex vào template literal, nên không phát sinh lỗi
 * "Invalid regular expression: missing /" do sai cấp escape.
 */
function translationWorkerMain() {
  "use strict";

  let settings = {};
  let singleMap = new Map();
  let phraseGroups = new Map();
  let prefixRules = new Map();
  let suffixRules = new Map();
  let totalEntries = 0;

  function post(type, payload = {}) {
    self.postMessage({ type, ...payload });
  }

  function firstMeaning(value) {
    const normalized = String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .trim();
    if (!normalized) return "";
    const selected =
      normalized
        .split(/[\/／]/u)
        .map((item) => item.trim())
        .find(Boolean) || "";
    return selected.replace(/^[,;:|]+|[,;:|]+$/g, "").trim();
  }

  function parseLine(rawLine) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) return null;
    let separatorIndex = -1;
    let separatorLength = 1;
    const arrow = line.indexOf("=>");
    const tab = line.indexOf("\t");
    const equal = line.indexOf("=");
    const pipe = line.indexOf("|");
    if (arrow > 0) {
      separatorIndex = arrow;
      separatorLength = 2;
    } else if (tab > 0) separatorIndex = tab;
    else if (equal > 0) separatorIndex = equal;
    else if (pipe > 0) separatorIndex = pipe;
    if (separatorIndex <= 0) return null;
    const source = line.slice(0, separatorIndex).trim();
    const target = firstMeaning(line.slice(separatorIndex + separatorLength));
    return source && target ? { source, target } : null;
  }

  function firstCodePoint(text, index = 0) {
    const cp = text.codePointAt(index);
    if (cp === undefined) return { char: "", length: 0 };
    const char = String.fromCodePoint(cp);
    return { char, length: char.length };
  }

  function firstTwoKey(text, index = 0) {
    const first = firstCodePoint(text, index);
    if (!first.length) return "";
    const second = firstCodePoint(text, index + first.length);
    return first.char + second.char;
  }

  function isOneCodePoint(text) {
    const first = firstCodePoint(text, 0);
    return first.length === text.length;
  }

  function addGroupedEntry(source, target) {
    if (isOneCodePoint(source)) {
      singleMap.set(source, target);
      return;
    }
    const key = firstTwoKey(source, 0);
    if (!phraseGroups.has(key)) phraseGroups.set(key, []);
    phraseGroups.get(key).push([source, target]);
  }

  function addRule(source, target) {
    const marker = source.indexOf("{0}");
    if (marker < 0) return;
    const prefix = source.slice(0, marker);
    const suffix = source.slice(marker + 3);
    const rule = {
      source,
      target,
      prefix,
      suffix,
      staticLength: prefix.length + suffix.length,
    };
    if (prefix) {
      const key = firstCodePoint(prefix).char;
      if (!prefixRules.has(key)) prefixRules.set(key, []);
      prefixRules.get(key).push(rule);
    } else if (suffix) {
      const key = firstCodePoint(suffix).char;
      if (!suffixRules.has(key)) suffixRules.set(key, []);
      suffixRules.get(key).push(rule);
    }
  }

  function isWordCharacter(char) {
    return !!char && /[\p{L}\p{N}]/u.test(char);
  }

  function isChinese(char) {
    return !!char && /[\p{Script=Han}]/u.test(char);
  }

  function isCaptureCharacter(char) {
    return !!char && /[\p{L}\p{N}·・．.\-_]/u.test(char);
  }

  function appendPiece(output, piece) {
    const value = String(piece ?? "");
    if (!value) return output;
    if (!output) return value;
    const last = Array.from(output.slice(-2)).pop() || output.slice(-1);
    const first = firstCodePoint(value).char;
    if (isWordCharacter(last) && isWordCharacter(first))
      return `${output} ${value}`;
    return output + value;
  }

  function findExact(text, index) {
    const key = firstTwoKey(text, index);
    const group = phraseGroups.get(key);
    if (group) {
      for (const [source, target] of group) {
        if (text.startsWith(source, index))
          return { consumed: source.length, source, target, kind: "Cụm từ" };
      }
    }
    const first = firstCodePoint(text, index);
    if (singleMap.has(first.char))
      return {
        consumed: first.length,
        source: first.char,
        target: singleMap.get(first.char),
        kind: "Từ đơn",
      };
    return null;
  }

  function readLatinRun(text, start) {
    let index = start;
    while (index < text.length) {
      const current = firstCodePoint(text, index);
      if (!isWordCharacter(current.char) || isChinese(current.char)) break;
      index += current.length;
    }
    return index;
  }

  function translateExactOnly(text) {
    let output = "";
    let index = 0;
    while (index < text.length) {
      const exact = findExact(text, index);
      if (exact) {
        output = appendPiece(output, exact.target);
        index += exact.consumed;
        continue;
      }
      const current = firstCodePoint(text, index);
      if (isWordCharacter(current.char) && !isChinese(current.char)) {
        const end = readLatinRun(text, index);
        output = appendPiece(output, text.slice(index, end));
        index = end;
      } else {
        output += current.char;
        index += current.length || 1;
      }
    }
    return cleanupSpacing(output, false);
  }

  function captureUntil(text, start, maximumCodePoints = 24) {
    let index = start;
    let count = 0;
    while (index < text.length && count < maximumCodePoints) {
      const current = firstCodePoint(text, index);
      if (!isCaptureCharacter(current.char)) break;
      index += current.length;
      count++;
    }
    return index;
  }

  function findRule(text, index) {
    if (!settings.applyRules) return null;
    const current = firstCodePoint(text, index);
    let best = null;

    const prefixed = prefixRules.get(current.char) || [];
    for (const rule of prefixed) {
      if (!text.startsWith(rule.prefix, index)) continue;
      const captureStart = index + rule.prefix.length;
      let captureEnd = -1;
      let consumed = 0;
      if (rule.suffix) {
        const hardEnd = captureUntil(text, captureStart, 28);
        const found = text.indexOf(rule.suffix, captureStart);
        if (found < captureStart || found > hardEnd) continue;
        captureEnd = found;
        consumed = found + rule.suffix.length - index;
      } else {
        captureEnd = captureUntil(text, captureStart, 16);
        if (captureEnd <= captureStart) continue;
        consumed = captureEnd - index;
      }
      const capture = text.slice(captureStart, captureEnd);
      if (!capture) continue;
      const translatedCapture = translateExactOnly(capture);
      const target = rule.target.split("{0}").join(translatedCapture);
      if (!best || consumed > best.consumed)
        best = { consumed, source: text.slice(index, index + consumed), target, kind: "Luật" };
    }

    if (isCaptureCharacter(current.char)) {
      let scan = index;
      let points = 0;
      while (scan < text.length && points < 20) {
        const item = firstCodePoint(text, scan);
        if (scan > index) {
          const candidates = suffixRules.get(item.char) || [];
          for (const rule of candidates) {
            if (!text.startsWith(rule.suffix, scan)) continue;
            const capture = text.slice(index, scan);
            if (!capture) continue;
            const consumed = scan + rule.suffix.length - index;
            const translatedCapture = translateExactOnly(capture);
            const target = rule.target.split("{0}").join(translatedCapture);
            if (!best || consumed > best.consumed)
              best = { consumed, source: text.slice(index, index + consumed), target, kind: "Luật" };
          }
        }
        if (!isCaptureCharacter(item.char)) break;
        scan += item.length;
        points++;
      }
    }
    return best;
  }

  function normalizeChinesePunctuation(text) {
    return text
      .replace(/，/g, ",")
      .replace(/。/g, ".")
      .replace(/；/g, ";")
      .replace(/：/g, ":")
      .replace(/？/g, "?")
      .replace(/！/g, "!")
      .replace(/（/g, "(")
      .replace(/）/g, ")")
      .replace(/【/g, "[")
      .replace(/】/g, "]")
      .replace(/《/g, "“")
      .replace(/》/g, "”")
      .replace(/、/g, ",");
  }

  function applyChapterRules(text) {
    return text
      .replace(
        /第\s*([0-9０-９一二三四五六七八九十百千万零〇两]+)\s*章/g,
        "Chương $1",
      )
      .replace(
        /第\s*([0-9０-９一二三四五六七八九十百千万零〇两]+)\s*卷/g,
        "Quyển $1",
      )
      .replace(
        /第\s*([0-9０-９一二三四五六七八九十百千万零〇两]+)\s*节/g,
        "Tiết $1",
      )
      .replace(
        /第\s*([0-9０-９一二三四五六七八九十百千万零〇两]+)\s*部/g,
        "Phần $1",
      );
  }

  function cleanupSpacing(text, capitalize = true) {
    let result = String(text || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\s+([,.;:!?%)\]])/g, "$1")
      .replace(/([(\[])\s+/g, "$1")
      .replace(/([,;:!?])(?=[^\s)\]])/g, "$1 ")
      .replace(/\.(?=[\p{L}\p{Script=Han}])/gu, ". ")
      .replace(/[ \t]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n");

    if (capitalize && settings.capitalizeSentences) {
      result = result.replace(
        /(^|[.!?]\s+|\n+)(\p{Ll})/gu,
        (match, prefix, letter) => prefix + letter.toLocaleUpperCase("vi-VN"),
      );
    }
    return result.trim();
  }

  function translateText(input, options = {}) {
    let text = String(input || "");
    if (settings.chapterRegex) text = applyChapterRules(text);
    let output = "";
    let index = 0;
    const trace = [];
    const traceLimit = Number(options.traceLimit) || 0;

    while (index < text.length) {
      const exact = findExact(text, index);
      const rule = findRule(text, index);
      let selected = exact;
      if (rule && (!selected || rule.consumed > selected.consumed))
        selected = rule;

      if (selected) {
        output = appendPiece(output, selected.target);
        if (traceLimit && trace.length < traceLimit) {
          trace.push({
            source: selected.source || text.slice(index, index + selected.consumed),
            target: selected.target,
            kind: selected.kind || "Từ điển",
          });
        }
        index += selected.consumed;
        continue;
      }

      const current = firstCodePoint(text, index);
      if (isWordCharacter(current.char) && !isChinese(current.char)) {
        const end = readLatinRun(text, index);
        output = appendPiece(output, text.slice(index, end));
        index = end;
        continue;
      }
      if (!(isChinese(current.char) && !settings.keepUnknown)) {
        output += current.char;
      }
      index += current.length || 1;
    }

    if (settings.normalizePunctuation)
      output = normalizeChinesePunctuation(output);
    return {
      text: cleanupSpacing(output, true),
      trace,
      traceTruncated: !!traceLimit && trace.length >= traceLimit,
    };
  }

  async function initialize(data) {
    settings = data.settings || {};
    const exactMap = new Map();
    const ruleMap = new Map();
    const dictionaries = [...(data.dictionaries || [])].sort(
      (a, b) => a.priority - b.priority,
    );
    let processedLines = 0;

    for (let fileIndex = 0; fileIndex < dictionaries.length; fileIndex++) {
      const dictionary = dictionaries[fileIndex];
      const text = new TextDecoder("utf-8").decode(dictionary.buffer);
      const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
      let valid = 0;
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const entry = parseLine(lines[lineIndex]);
        if (!entry) continue;
        if (entry.source.includes("{0}"))
          ruleMap.set(entry.source, entry.target);
        else exactMap.set(entry.source, entry.target);
        valid++;
        processedLines++;
        if (processedLines % 50000 === 0) {
          post("dictionary-progress", {
            fileName: dictionary.name,
            processedLines,
            exactEntries: exactMap.size,
            ruleEntries: ruleMap.size,
          });
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
      post("dictionary-file", {
        fileName: dictionary.name,
        validEntries: valid,
        fileIndex: fileIndex + 1,
        fileCount: dictionaries.length,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    singleMap = new Map();
    phraseGroups = new Map();
    prefixRules = new Map();
    suffixRules = new Map();

    let grouped = 0;
    for (const [source, target] of exactMap) {
      addGroupedEntry(source, target);
      grouped++;
      if (grouped % 50000 === 0) {
        post("dictionary-index", { grouped, total: exactMap.size });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    for (const group of phraseGroups.values()) {
      group.sort((a, b) => b[0].length - a[0].length);
    }
    for (const [source, target] of ruleMap) addRule(source, target);
    for (const rules of prefixRules.values())
      rules.sort((a, b) => b.staticLength - a.staticLength);
    for (const rules of suffixRules.values())
      rules.sort((a, b) => b.staticLength - a.staticLength);

    totalEntries = exactMap.size + ruleMap.size;
    post("initialized", {
      totalEntries,
      exactEntries: exactMap.size,
      ruleEntries: ruleMap.size,
      singleEntries: singleMap.size,
      phraseGroups: phraseGroups.size,
    });
  }

  self.onmessage = async (event) => {
    const data = event.data || {};
    try {
      if (data.type === "initialize") {
        await initialize(data);
        return;
      }
      if (data.type === "translate") {
        const started = performance.now();
        const translated = translateText(data.text, {
          traceLimit: data.traceLimit || 0,
        });
        const translatedText = translated.text;
        post("translated", {
          requestId: data.requestId,
          chunkIndex: data.chunkIndex,
          translatedText,
          trace: translated.trace,
          traceTruncated: translated.traceTruncated,
          translatedBytes: new Blob([translatedText]).size,
          sourceLines: (String(data.text || "").match(/\n/g) || []).length + 1,
          duration: performance.now() - started,
        });
      }
    } catch (error) {
      post("worker-error", {
        requestId: data.requestId,
        message: error?.message || String(error),
        stack: error?.stack || "",
      });
    }
  };
}

function createWorker() {
  destroyWorker();
  const source = `(${translationWorkerMain.toString()})();`;
  const blob = new Blob([source], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);
  worker._url = url;
  state.worker = worker;
  state.workerReady = false;
  return worker;
}

function destroyWorker() {
  if (!state.worker) return;
  state.worker.terminate();
  if (state.worker._url) URL.revokeObjectURL(state.worker._url);
  state.worker = null;
  state.workerReady = false;
  state.currentWorkerResolve = null;
  state.currentWorkerReject = null;
}

function translationSettings() {
  return {
    applyRules: ui.applyRules.checked,
    chapterRegex: ui.chapterRegex.checked,
    normalizePunctuation: ui.normalizePunctuation.checked,
    keepUnknown: ui.keepUnknown.checked,
    capitalizeSentences: ui.capitalizeSentences.checked,
  };
}

function initializeTranslationWorker() {
  return new Promise((resolve, reject) => {
    const worker = createWorker();
    const timeout = setTimeout(
      () => reject(new Error("Nạp từ điển quá thời gian cho phép.")),
      300000,
    );

    worker.onmessage = (event) => {
      const data = event.data || {};
      if (data.type === "dictionary-progress") {
        setStatus(
          `Đang đọc ${data.fileName}: ${Number(data.processedLines).toLocaleString("vi-VN")} dòng hợp lệ...`,
          "info",
        );
        return;
      }
      if (data.type === "dictionary-file") {
        log(
          `Đã phân tích ${data.fileName}: ${Number(data.validEntries).toLocaleString("vi-VN")} mục.`,
        );
        return;
      }
      if (data.type === "dictionary-index") {
        setStatus(
          `Đang tạo chỉ mục Longest Match: ${Number(data.grouped).toLocaleString("vi-VN")} / ${Number(data.total).toLocaleString("vi-VN")} mục...`,
          "info",
        );
        return;
      }
      if (data.type === "initialized") {
        clearTimeout(timeout);
        state.workerReady = true;
        state.metadata.dictionaryEntries = data.totalEntries || 0;
        saveMetadata().catch(console.error);
        updateProgressUi();
        log(
          `Từ điển sẵn sàng: ${Number(data.exactEntries).toLocaleString("vi-VN")} mục chính xác, ${Number(data.ruleEntries).toLocaleString("vi-VN")} luật.`,
        );
        resolve(data);
        return;
      }
      if (data.type === "translated" && state.currentWorkerResolve) {
        const resolver = state.currentWorkerResolve;
        state.currentWorkerResolve = null;
        state.currentWorkerReject = null;
        resolver(data);
        return;
      }
      if (data.type === "worker-error") {
        const error = new Error(data.message || "Lỗi Web Worker.");
        if (state.currentWorkerReject) {
          const rejecter = state.currentWorkerReject;
          state.currentWorkerResolve = null;
          state.currentWorkerReject = null;
          rejecter(error);
        } else {
          clearTimeout(timeout);
          reject(error);
        }
      }
    };

    worker.onerror = (event) => {
      clearTimeout(timeout);
      reject(new Error(event.message || "Web Worker không khởi tạo được."));
    };

    const dictionaries = state.dictionaries.map((item) => ({
      name: item.name,
      priority: item.priority,
      buffer: item.buffer,
    }));
    worker.postMessage({
      type: "initialize",
      settings: translationSettings(),
      dictionaries,
    });
  });
}

function translateChunk(index, text) {
  return new Promise((resolve, reject) => {
    if (!state.worker || !state.workerReady) {
      reject(new Error("Web Worker chưa sẵn sàng."));
      return;
    }
    const requestId = `${Date.now()}-${index}-${Math.random()}`;
    state.currentWorkerResolve = resolve;
    state.currentWorkerReject = reject;
    state.worker.postMessage({
      type: "translate",
      requestId,
      chunkIndex: index,
      text,
      traceLimit: CONFIG.analysisLimit,
    });
  });
}

async function startTranslation() {
  if (state.translating || state.importing) return;
  const queue = selectedStories({ includeCompleted: false });
  if (!queue.length || !state.dictionaries.length) return;

  state.translating = true;
  state.paused = false;
  state.metadata.status = "initializing";
  for (const story of queue) {
    story.status = "initializing";
    if (!story.startedAt) story.startedAt = new Date().toISOString();
  }
  await persistStories();
  refreshUi();
  setStatus(
    "Đang nạp và lập chỉ mục từ điển. Tệp VietPhrase lớn có thể cần một lúc.",
    "info",
  );
  log(`Bắt đầu dịch ${queue.length} truyện đã chọn.`);

  try {
    await initializeTranslationWorker();
    state.metadata.status = "translating";
    for (const story of queue) story.status = "translating";
    await persistStories();
    refreshUi();
    setStatus("Đang dịch và tự động lưu sau từng khối.", "info");

    for (const story of queue) {
      state.translatingStoryId = story.id;
      state.metadata.activeStoryId = story.id;
      await persistStories();
      refreshUi();
      log(`Dịch ${story.fileName} từ khối ${story.currentChunk + 1}.`);

      while (story.currentChunk < story.totalChunks && state.translating) {
        const index = story.currentChunk;
        const source = await idbGet(
          CONFIG.stores.source,
          storyChunkKey(story.id, index),
        );
        if (!source)
          throw new Error(
            `Không tìm thấy khối nguồn ${index + 1} của ${story.fileName}.`,
          );
        const result = await translateChunk(index, source.text);
        await idbPut(CONFIG.stores.translated, {
          id: storyChunkKey(story.id, index),
          storyId: story.id,
          index,
          text: result.translatedText,
          trace: result.trace || [],
          traceTruncated: !!result.traceTruncated,
          bytes: result.translatedBytes,
          sourceLines: result.sourceLines,
          duration: result.duration,
          savedAt: Date.now(),
        });

        story.currentChunk++;
        story.translatedBytes +=
          result.translatedBytes || new Blob([result.translatedText]).size;
        story.translatedLines += result.sourceLines || 0;
        await persistStories();
        updateProgressUi();
        updateButtons();
        if (
          index === 0 ||
          index % CONFIG.previewRefreshEvery === 0 ||
          story.currentChunk >= story.totalChunks
        ) {
          await showPreview(index, story.id);
        }
        if (index % 10 === 0) await updateStorage();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      if (story.currentChunk >= story.totalChunks) {
        story.status = "completed";
        story.completedAt = new Date().toISOString();
        await persistStories();
        log(`Hoàn thành bản dịch ${story.fileName}.`);
      } else if (!state.translating) {
        story.status = "paused";
        await persistStories();
        break;
      }
    }

    if (queue.every((story) => story.currentChunk >= story.totalChunks)) {
      state.metadata.status = "completed";
      await saveMetadata();
      setStatus("Đã dịch hoàn thành tất cả truyện đã chọn.", "success");
      log("Hoàn thành các bản dịch đã chọn.");
    } else if (state.paused) {
      state.metadata.status = "paused";
      setStatus("Đã dừng. Bấm Bắt đầu / Tiếp tục để dịch tiếp từ khối đang dừng.", "warning");
    }
  } catch (error) {
    const story = state.metadata.stories.find(
      (item) => item.id === state.translatingStoryId,
    );
    if (story) story.status = state.paused ? "paused" : "error";
    state.metadata.status = state.paused ? "paused" : "error";
    await persistStories().catch(console.error);
    setStatus(`Lỗi dịch: ${error.message}`, "error");
    log(`Lỗi dịch: ${error.message}`, "ERROR");
  } finally {
    state.translating = false;
    state.paused = false;
    state.translatingStoryId = "";
    destroyWorker();
    refreshUi();
    await updateStorage();
  }
}

async function pauseTranslation() {
  if (!state.translating || state.paused) return;
  state.paused = true;
  state.translating = false;
  const story = state.metadata.stories.find(
    (item) => item.id === state.translatingStoryId,
  );
  if (story) story.status = "paused";
  state.metadata.status = "paused";
  await persistStories();
  refreshUi();
  setStatus("Đang dừng sau khối hiện tại. Kết quả đã dịch sẽ được giữ lại.", "warning");
  log(
    story
      ? `Dừng tại ${story.fileName}, khối ${story.currentChunk}.`
      : "Đã yêu cầu dừng dịch.",
  );
}

function renderAnalysis(trace = [], truncated = false) {
  ui.analysisList.innerHTML = "";
  if (!CONFIG.analysisLimit) {
    ui.analysisCount.textContent = "Tắt";
    ui.analysisList.textContent =
      "Đã tắt phân tích từng từ/cụm để giảm dung lượng lưu và tránh lag khi xem bản dịch.";
    return;
  }
  ui.analysisCount.textContent = `${trace.length.toLocaleString("vi-VN")} mục${truncated ? "+" : ""}`;
  if (!trace.length) {
    ui.analysisList.textContent = "Chưa có dữ liệu phân tích cho khối này.";
    return;
  }
  const table = document.createElement("div");
  table.className = "analysis-table";
  for (const item of trace) {
    const row = document.createElement("div");
    row.className = "analysis-row";

    const kind = document.createElement("span");
    kind.className = "analysis-kind";
    kind.textContent = item.kind || "Từ điển";

    const source = document.createElement("span");
    source.className = "analysis-source";
    source.textContent = item.source || "";

    const arrow = document.createElement("span");
    arrow.className = "analysis-arrow";
    arrow.textContent = "→";

    const target = document.createElement("span");
    target.className = "analysis-target";
    target.textContent = item.target || "";

    row.append(kind, source, arrow, target);
    table.appendChild(row);
  }
  ui.analysisList.appendChild(table);
  if (truncated) {
    const note = document.createElement("div");
    note.className = "analysis-note";
    note.textContent = `Chỉ hiển thị ${CONFIG.analysisLimit} mục đầu để trang không bị chậm.`;
    ui.analysisList.appendChild(note);
  }
}

async function showPreview(chunkIndex, storyId = state.metadata.activeStoryId) {
  const story =
    state.metadata.stories.find((item) => item.id === storyId) || activeStory();
  const total = story?.totalChunks || 0;
  if (!total) {
    ui.sourcePreview.value = "";
    ui.translatedPreview.value = "";
    ui.previewPosition.textContent = "Chưa có dữ liệu";
    ui.sourceCount.textContent = "0 ký tự";
    ui.translatedCount.textContent = "0 ký tự";
    renderAnalysis([]);
    return;
  }
  const safe = Math.max(0, Math.min(Number(chunkIndex) || 0, total - 1));
  state.previewChunk = safe;
  if (story) state.metadata.activeStoryId = story.id;
  const source = await idbGet(CONFIG.stores.source, storyChunkKey(story.id, safe));
  const translated = await idbGet(
    CONFIG.stores.translated,
    storyChunkKey(story.id, safe),
  );
  let sourceText = source?.text || "";
  let translatedText = translated?.text || `[Khối ${safe + 1} chưa được dịch]`;
  if (sourceText.length > CONFIG.previewLimit)
    sourceText =
      sourceText.slice(0, CONFIG.previewLimit) + "\n[Đã giới hạn xem trước]";
  if (translatedText.length > CONFIG.previewLimit)
    translatedText =
      translatedText.slice(0, CONFIG.previewLimit) +
      "\n[Đã giới hạn xem trước]";
  ui.sourcePreview.value = sourceText;
  ui.translatedPreview.value = translatedText;
  ui.sourceCount.textContent = `${sourceText.length.toLocaleString("vi-VN")} ký tự`;
  ui.translatedCount.textContent = `${translatedText.length.toLocaleString("vi-VN")} ký tự`;
  ui.previewPosition.textContent = `${story.fileName} · Khối ${safe + 1} / ${total}`;
  ui.jumpChunk.value = safe + 1;
  renderAnalysis(translated?.trace || [], !!translated?.traceTruncated);
}

async function buildStoryBlob(story) {
  const parts = [new Uint8Array([0xef, 0xbb, 0xbf])];
  for (let index = 0; index < story.currentChunk; index++) {
    const chunk = await idbGet(
      CONFIG.stores.translated,
      storyChunkKey(story.id, index),
    );
    if (!chunk) continue;
    parts.push(chunk.text);
    if (chunk.text && !chunk.text.endsWith("\n")) parts.push("\n");
  }
  return new Blob(parts, { type: "text/plain;charset=utf-8" });
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function exportTranslated({ clearAfter = false } = {}) {
  const stories = selectedStories().filter((story) => story.currentChunk > 0);
  if (!stories.length) return;
  setStatus("Đang chuẩn bị các tệp xuất...", "info");
  log(`Bắt đầu xuất ${stories.length} truyện đã chọn.`);
  try {
    if ("showDirectoryPicker" in window) {
      const directory = await window.showDirectoryPicker({
        mode: "readwrite",
      });
      for (const story of stories) {
        const handle = await directory.getFileHandle(storyExportName(story), {
          create: true,
        });
        const writable = await handle.createWritable();
        await writable.write(await buildStoryBlob(story));
        await writable.close();
      }
    } else {
      for (const story of stories) {
        downloadBlob(await buildStoryBlob(story), storyExportName(story));
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    setStatus("Đã xuất các tệp TXT riêng thành công.", "success");
    log(`Đã xuất ${stories.length} tệp TXT riêng.`);
    if (clearAfter) {
      for (const story of stories) {
        await deleteStoryChunks(story.id);
      }
      state.metadata.stories = state.metadata.stories.filter(
        (story) => !stories.some((item) => item.id === story.id),
      );
      state.metadata.activeStoryId = state.metadata.stories[0]?.id || "";
      await persistStories();
      refreshUi();
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      setStatus("Đã hủy xuất tệp.", "warning");
      return;
    }
    setStatus(`Lỗi xuất tệp: ${error.message}`, "error");
    log(`Lỗi xuất: ${error.message}`, "ERROR");
  }
}

async function updateStorage() {
  if (!navigator.storage?.estimate) {
    ui.storageText.textContent = formatBytes(
      state.metadata.stories.reduce(
        (sum, story) => sum + (story.translatedBytes || 0),
        0,
      ),
    );
    return;
  }
  try {
    const estimate = await navigator.storage.estimate();
    const usage = estimate.usage || 0;
    const quota = estimate.quota || 0;
    const percent = quota ? Math.min(100, (usage / quota) * 100) : 0;
    ui.storageText.textContent = `${formatBytes(usage)} / ${formatBytes(quota)}`;
    ui.storageBar.style.width = `${percent.toFixed(2)}%`;
    ui.storageBar.style.background =
      percent >= 90
        ? "var(--danger)"
        : percent >= 70
          ? "var(--warning)"
          : "var(--success)";
  } catch {
    ui.storageText.textContent = formatBytes(
      state.metadata.stories.reduce(
        (sum, story) => sum + (story.translatedBytes || 0),
        0,
      ),
    );
  }
}

async function deleteAllData(ask = true) {
  if (ask && !confirm("Xóa truyện, bản dịch, từ điển và tiến trình đã lưu?"))
    return;
  state.translating = false;
  state.paused = false;
  destroyWorker();
  await Promise.all([
    idbClear(CONFIG.stores.metadata),
    idbClear(CONFIG.stores.stories),
    idbClear(CONFIG.stores.source),
    idbClear(CONFIG.stores.translated),
    idbClear(CONFIG.stores.dictionaries),
  ]);
  state.metadata = createEmptyMetadata();
  state.dictionaries = [];
  state.previewChunk = 0;
  ui.sourcePreview.value = "";
  ui.translatedPreview.value = "";
  ui.sourceCount.textContent = "0 ký tự";
  ui.translatedCount.textContent = "0 ký tự";
  ui.previewPosition.textContent = "Chưa có dữ liệu";
  renderAnalysis([]);
  refreshUi();
  setStatus("Đã xóa toàn bộ dữ liệu lưu trong trình duyệt.", "success");
  log("Đã xóa toàn bộ dữ liệu.");
  await updateStorage();
}

function bindEvents() {
  ui.storyInput.addEventListener("change", (event) => {
    importStories(event.target.files);
    event.target.value = "";
  });

  for (const eventName of ["dragenter", "dragover"]) {
    ui.storyDrop.addEventListener(eventName, (event) => {
      event.preventDefault();
      ui.storyDrop.classList.add("drag");
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    ui.storyDrop.addEventListener(eventName, (event) => {
      event.preventDefault();
      ui.storyDrop.classList.remove("drag");
    });
  }
  ui.storyDrop.addEventListener("drop", (event) => {
    importStories(event.dataTransfer?.files);
  });

  ui.selectAllStoriesButton.addEventListener("click", async () => {
    state.metadata.stories.forEach((story) => {
      story.selected = true;
    });
    await persistStories();
    refreshUi();
  });
  ui.clearStorySelectionButton.addEventListener("click", async () => {
    state.metadata.stories.forEach((story) => {
      story.selected = false;
    });
    await persistStories();
    refreshUi();
  });

  ui.chooseDictButton.addEventListener("click", () => ui.dictInput.click());
  ui.dictInput.addEventListener("change", async (event) => {
    await loadDictionaryFiles(event.target.files);
    event.target.value = "";
  });
  ui.clearDictButton.addEventListener("click", clearDictionaries);
  ui.startButton.addEventListener("click", startTranslation);
  ui.pauseButton.addEventListener("click", pauseTranslation);
  ui.exportButton.addEventListener("click", () =>
    exportTranslated({ clearAfter: false }),
  );
  ui.exportClearButton.addEventListener("click", async () => {
    if (confirm("Sau khi xuất thành công, dữ liệu tạm sẽ bị xóa. Tiếp tục?")) {
      await exportTranslated({ clearAfter: true });
    }
  });
  ui.deleteAllButton.addEventListener("click", () => deleteAllData(true));
  ui.exportName.addEventListener("input", () => {
    ui.exportName.dataset.edited = "1";
  });
  ui.jumpButton.addEventListener("click", () =>
    showPreview(Number(ui.jumpChunk.value) - 1),
  );
  ui.jumpChunk.addEventListener("keydown", (event) => {
    if (event.key === "Enter") showPreview(Number(ui.jumpChunk.value) - 1);
  });
  ui.prevButton.addEventListener("click", () =>
    showPreview(state.previewChunk - 1),
  );
  ui.nextButton.addEventListener("click", () =>
    showPreview(state.previewChunk + 1),
  );
  ui.clearLogButton.addEventListener("click", () => {
    ui.logBox.textContent = "";
  });
  window.addEventListener("beforeunload", destroyWorker);
}

async function initialize() {
  try {
    state.db = await openDatabase();
    bindEvents();
    await restoreMetadata();
    await restoreDictionaries();
    const compacted = await compactStoredAnalysis();
    if (compacted) log(`Đã dọn dữ liệu phân tích cũ khỏi ${compacted} khối dịch.`);
    refreshUi();
    await updateStorage();
    if (state.metadata.stories.length) {
      const story = activeStory();
      const preview = story?.currentChunk
        ? Math.min(story.currentChunk - 1, story.totalChunks - 1)
        : 0;
      await showPreview(preview, story?.id);
      setStatus(
        selectedStories({ includeCompleted: false }).length
          ? "Đã khôi phục dự án. Bấm Bắt đầu / Tiếp tục để dịch tiếp các truyện đã chọn."
          : "Đã khôi phục các truyện đã tải lên.",
        "success",
      );
    } else {
      setStatus("Chọn truyện và các từ điển để bắt đầu.", "info");
    }
    log("Ứng dụng đã khởi động.");
  } catch (error) {
    setStatus(`Không thể khởi động ứng dụng: ${error.message}`, "error");
    console.error(error);
  }
}

initialize();

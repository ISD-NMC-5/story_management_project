"use strict";

const CONFIG_STORAGE_KEY = "txt_splitter_configuration_v1";

const state = {
  sourceFile: null,
  sourceText: "",
  outputFiles: [],
  directoryHandle: null,
};

const elements = {
  txtFileInput: document.getElementById("txtFileInput"),
  fileDropZone: document.getElementById("fileDropZone"),
  fileNameText: document.getElementById("fileNameText"),
  fileInfoText: document.getElementById("fileInfoText"),

  wordSettings: document.getElementById("wordSettings"),
  keywordSettings: document.getElementById("keywordSettings"),
  wordsPerFile: document.getElementById("wordsPerFile"),
  keywordsInput: document.getElementById("keywordsInput"),
  caseSensitive: document.getElementById("caseSensitive"),
  removeEmptyParts: document.getElementById("removeEmptyParts"),

  outputPrefix: document.getElementById("outputPrefix"),
  startNumber: document.getElementById("startNumber"),
  numberPadding: document.getElementById("numberPadding"),
  fileSeparator: document.getElementById("fileSeparator"),
  fileNameExample: document.getElementById("fileNameExample"),

  chooseFolderBtn: document.getElementById("chooseFolderBtn"),
  folderNameText: document.getElementById("folderNameText"),

  processBtn: document.getElementById("processBtn"),
  saveFilesBtn: document.getElementById("saveFilesBtn"),
  saveConfigBtn: document.getElementById("saveConfigBtn"),
  resetConfigBtn: document.getElementById("resetConfigBtn"),

  totalCharactersStat: document.getElementById("totalCharactersStat"),
  totalWordsStat: document.getElementById("totalWordsStat"),
  totalFilesStat: document.getElementById("totalFilesStat"),
  averageWordsStat: document.getElementById("averageWordsStat"),

  progressBar: document.getElementById("progressBar"),
  progressPercent: document.getElementById("progressPercent"),
  progressStatus: document.getElementById("progressStatus"),

  previewContainer: document.getElementById("previewContainer"),
  previewSearch: document.getElementById("previewSearch"),
  previewLimit: document.getElementById("previewLimit"),

  logContainer: document.getElementById("logContainer"),
  clearLogBtn: document.getElementById("clearLogBtn"),

  toastContainer: document.getElementById("toastContainer"),
};

document.addEventListener("DOMContentLoaded", initializeApp);

function initializeApp() {
  bindEvents();
  loadConfiguration();
  updateModeDisplay();
  updateFileNameExample();
  updateStatistics();
  updateProgress(0, "Chưa có tác vụ");

  addLog("info", "Ứng dụng đã sẵn sàng.");
}

function bindEvents() {
  elements.txtFileInput.addEventListener("change", (event) => {
    const [file] = event.target.files;

    if (file) {
      loadSourceFile(file);
    }
  });

  document.querySelectorAll('input[name="splitMode"]').forEach((input) => {
    input.addEventListener("change", () => {
      updateModeDisplay();
      clearProcessedResults();
    });
  });

  document.querySelectorAll("[data-mode-card]").forEach((card) => {
    card.addEventListener("click", () => {
      const radio = card.querySelector('input[type="radio"]');

      if (radio && !radio.checked) {
        radio.checked = true;
        radio.dispatchEvent(new Event("change"));
      }
    });
  });

  [
    elements.outputPrefix,
    elements.startNumber,
    elements.numberPadding,
    elements.fileSeparator,
  ].forEach((input) => {
    input.addEventListener("input", updateFileNameExample);
    input.addEventListener("change", updateFileNameExample);
  });

  [
    elements.wordsPerFile,
    elements.keywordsInput,
    elements.caseSensitive,
    elements.removeEmptyParts,
  ].forEach((input) => {
    input.addEventListener("input", clearProcessedResults);
    input.addEventListener("change", clearProcessedResults);
  });

  elements.chooseFolderBtn.addEventListener("click", chooseOutputFolder);
  elements.processBtn.addEventListener("click", processText);
  elements.saveFilesBtn.addEventListener("click", saveOutputFiles);
  elements.saveConfigBtn.addEventListener("click", saveConfiguration);
  elements.resetConfigBtn.addEventListener("click", resetConfiguration);
  elements.clearLogBtn.addEventListener("click", clearLog);

  elements.previewSearch.addEventListener("input", renderPreview);
  elements.previewLimit.addEventListener("change", renderPreview);

  elements.fileDropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    elements.fileDropZone.classList.add("dragging");
  });

  elements.fileDropZone.addEventListener("dragleave", () => {
    elements.fileDropZone.classList.remove("dragging");
  });

  elements.fileDropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    elements.fileDropZone.classList.remove("dragging");

    const [file] = event.dataTransfer.files;

    if (!file) {
      return;
    }

    if (!isTxtFile(file)) {
      showToast("Vui lòng chọn đúng file TXT.", "error");
      addLog("error", `File không hợp lệ: ${file.name}`);
      return;
    }

    loadSourceFile(file);
  });
}

async function loadSourceFile(file) {
  try {
    if (!isTxtFile(file)) {
      throw new Error("File được chọn không phải định dạng TXT.");
    }

    updateProgress(10, "Đang đọc file TXT...");

    const text = await file.text();

    state.sourceFile = file;
    state.sourceText = normalizeText(text);
    state.outputFiles = [];

    elements.fileNameText.textContent = file.name;
    elements.fileInfoText.textContent = `${formatFileSize(file.size)} · ${formatNumber(countWords(text))} từ`;

    elements.saveFilesBtn.disabled = true;

    updateStatistics();
    renderPreview();
    updateProgress(100, "Đã đọc file thành công");

    addLog(
      "success",
      `Đã đọc file "${file.name}", dung lượng ${formatFileSize(file.size)}.`,
    );

    showToast("Đã tải file TXT thành công.", "success");

    setTimeout(() => {
      updateProgress(0, "Sẵn sàng xử lý");
    }, 600);
  } catch (error) {
    updateProgress(0, "Đọc file thất bại");
    addLog("error", error.message);
    showToast(error.message, "error");
  }
}

function isTxtFile(file) {
  if (!file) {
    return false;
  }

  const fileName = file.name.toLowerCase();

  return (
    fileName.endsWith(".txt") || file.type === "text/plain" || file.type === ""
  );
}

function normalizeText(text) {
  return String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/^\uFEFF/, "");
}

function getSelectedMode() {
  return (
    document.querySelector('input[name="splitMode"]:checked')?.value || "words"
  );
}

function updateModeDisplay() {
  const selectedMode = getSelectedMode();

  elements.wordSettings.classList.toggle("hidden", selectedMode !== "words");

  elements.keywordSettings.classList.toggle(
    "hidden",
    selectedMode !== "keywords",
  );

  document.querySelectorAll("[data-mode-card]").forEach((card) => {
    card.classList.toggle("active", card.dataset.modeCard === selectedMode);
  });
}

async function chooseOutputFolder() {
  if (!("showDirectoryPicker" in window)) {
    addLog(
      "warning",
      "Trình duyệt không hỗ trợ chọn thư mục. Khi lưu, các file sẽ được tải xuống riêng lẻ.",
    );

    showToast(
      "Trình duyệt không hỗ trợ chọn thư mục. Hãy dùng Chrome hoặc Edge.",
      "warning",
    );

    return;
  }

  try {
    const directoryHandle = await window.showDirectoryPicker({
      mode: "readwrite",
    });

    state.directoryHandle = directoryHandle;
    elements.folderNameText.textContent = directoryHandle.name;

    addLog("success", `Đã chọn thư mục lưu "${directoryHandle.name}".`);

    showToast("Đã chọn thư mục lưu.", "success");
  } catch (error) {
    if (error.name === "AbortError") {
      addLog("info", "Đã hủy chọn thư mục.");
      return;
    }

    addLog("error", `Không thể chọn thư mục: ${error.message}`);
    showToast("Không thể chọn thư mục lưu.", "error");
  }
}

async function processText() {
  try {
    validateProcessingInput();

    elements.processBtn.disabled = true;
    elements.saveFilesBtn.disabled = true;

    updateProgress(5, "Đang chuẩn bị dữ liệu...");
    await nextFrame();

    const mode = getSelectedMode();
    let parts = [];

    if (mode === "words") {
      const wordsPerFile = Number.parseInt(elements.wordsPerFile.value, 10);

      updateProgress(25, "Đang tách nội dung theo số từ...");
      await nextFrame();

      parts = splitByWordCount(state.sourceText, wordsPerFile);

      addLog(
        "info",
        `Đã tách theo mức tối đa ${formatNumber(wordsPerFile)} từ/file.`,
      );
    } else {
      const keywords = parseKeywords(elements.keywordsInput.value);

      updateProgress(25, "Đang tìm kiếm các từ khóa...");
      await nextFrame();

      parts = splitByKeywords(
        state.sourceText,
        keywords,
        elements.caseSensitive.checked,
      );

      addLog("info", `Đã tách theo ${formatNumber(keywords.length)} từ khóa.`);
    }

    updateProgress(60, "Đang tạo danh sách file...");
    await nextFrame();

    if (elements.removeEmptyParts.checked) {
      parts = parts.filter((part) => part.trim().length > 0);
    }

    if (parts.length === 0) {
      throw new Error("Không tạo được phần nội dung nào.");
    }

    state.outputFiles = createOutputFiles(parts);

    updateProgress(85, "Đang tạo bản xem trước...");
    await nextFrame();

    updateStatistics();
    renderPreview();

    elements.saveFilesBtn.disabled = false;

    updateProgress(
      100,
      `Hoàn tất: ${formatNumber(state.outputFiles.length)} file`,
    );

    addLog(
      "success",
      `Xử lý hoàn tất. Đã tạo ${formatNumber(state.outputFiles.length)} file.`,
    );

    showToast(
      `Đã tạo ${formatNumber(state.outputFiles.length)} file.`,
      "success",
    );
  } catch (error) {
    state.outputFiles = [];
    elements.saveFilesBtn.disabled = true;

    updateStatistics();
    renderPreview();
    updateProgress(0, "Xử lý thất bại");

    addLog("error", error.message);
    showToast(error.message, "error");
  } finally {
    elements.processBtn.disabled = false;
  }
}

function validateProcessingInput() {
  if (!state.sourceFile || !state.sourceText.trim()) {
    throw new Error("Vui lòng chọn file TXT có nội dung.");
  }

  const mode = getSelectedMode();

  if (mode === "words") {
    const wordsPerFile = Number.parseInt(elements.wordsPerFile.value, 10);

    if (!Number.isInteger(wordsPerFile) || wordsPerFile < 1) {
      throw new Error("Số từ trong mỗi file phải lớn hơn 0.");
    }
  }

  if (mode === "keywords") {
    const keywords = parseKeywords(elements.keywordsInput.value);

    if (keywords.length === 0) {
      throw new Error("Vui lòng nhập ít nhất một từ khóa.");
    }
  }

  if (!sanitizeFileName(elements.outputPrefix.value)) {
    throw new Error("Vui lòng nhập tiền tố tên file.");
  }
}

function splitByWordCount(text, maximumWords) {
  const wordMatches = getCountableWordMatches(text);

  if (wordMatches.length === 0) {
    return [];
  }

  const parts = [];

  for (
    let startWordIndex = 0;
    startWordIndex < wordMatches.length;
    startWordIndex += maximumWords
  ) {
    const endWordIndex = Math.min(
      startWordIndex + maximumWords - 1,
      wordMatches.length - 1,
    );

    const startCharacter =
      startWordIndex === 0 ? 0 : wordMatches[startWordIndex].index;

    const endMatch = wordMatches[endWordIndex];

    const endCharacter =
      endWordIndex === wordMatches.length - 1
        ? text.length
        : endMatch.index + endMatch[0].length;

    const part = text.slice(startCharacter, endCharacter).trim();

    if (part) {
      parts.push(part);
    }
  }

  return parts;
}

function getCountableWordMatches(text) {
  return [...String(text ?? "").matchAll(/\S+/gu)].filter((match) =>
    isCountableWord(match[0]),
  );
}

function isCountableWord(value) {
  return /[\p{L}\p{N}]/u.test(String(value ?? ""));
}

function splitByKeywords(text, keywords, caseSensitive) {
  const uniqueKeywords = [
    ...new Set(keywords.map((keyword) => keyword.trim()).filter(Boolean)),
  ].sort((a, b) => b.length - a.length);

  if (uniqueKeywords.length === 0) {
    return [text.trim()];
  }

  const escapedKeywords = uniqueKeywords.map(escapeRegularExpression);
  const flags = caseSensitive ? "gu" : "giu";
  const keywordPattern = new RegExp(escapedKeywords.join("|"), flags);

  const matches = [...text.matchAll(keywordPattern)];

  if (matches.length === 0) {
    addLog(
      "warning",
      "Không tìm thấy từ khóa nào. Toàn bộ nội dung được giữ trong một file.",
    );

    return [text.trim()];
  }

  const parts = [];

  const contentBeforeFirstKeyword = text.slice(0, matches[0].index).trim();

  if (contentBeforeFirstKeyword) {
    parts.push(contentBeforeFirstKeyword);
  }

  matches.forEach((match, index) => {
    const startCharacter = match.index;

    const endCharacter =
      index < matches.length - 1 ? matches[index + 1].index : text.length;

    const part = text.slice(startCharacter, endCharacter).trim();

    if (part) {
      parts.push(part);
    }
  });

  return parts;
}

function parseKeywords(rawValue) {
  return rawValue
    .split(/[\n,;]+/u)
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createOutputFiles(parts) {
  const prefix = sanitizeFileName(elements.outputPrefix.value) || "phan";

  const startNumber = Math.max(
    0,
    Number.parseInt(elements.startNumber.value, 10) || 0,
  );

  const padding = Math.max(
    1,
    Number.parseInt(elements.numberPadding.value, 10) || 1,
  );

  const separator = elements.fileSeparator.value;

  return parts.map((content, index) => {
    const fileNumber = String(startNumber + index).padStart(padding, "0");

    const fileName = `${prefix}${separator}${fileNumber}.txt`;

    return {
      fileName,
      content: content.trim(),
      characters: content.length,
      words: countWords(content),
    };
  });
}

function sanitizeFileName(value) {
  return String(value ?? "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\.+$/g, "")
    .replace(/\s+/g, " ");
}

function updateFileNameExample() {
  const prefix = sanitizeFileName(elements.outputPrefix.value) || "phan";

  const startNumber = Math.max(
    0,
    Number.parseInt(elements.startNumber.value, 10) || 0,
  );

  const padding = Math.max(
    1,
    Number.parseInt(elements.numberPadding.value, 10) || 1,
  );

  const separator = elements.fileSeparator.value;
  const number = String(startNumber).padStart(padding, "0");

  elements.fileNameExample.textContent = `${prefix}${separator}${number}.txt`;
}

function updateStatistics() {
  const sourceText = state.sourceText || "";
  const totalCharacters = sourceText.length;
  const totalWords = countWords(sourceText);
  const totalFiles = state.outputFiles.length;

  const outputWordTotal = state.outputFiles.reduce(
    (sum, file) => sum + file.words,
    0,
  );

  const averageWords =
    totalFiles > 0 ? Math.round(outputWordTotal / totalFiles) : 0;

  elements.totalCharactersStat.textContent = formatNumber(totalCharacters);

  elements.totalWordsStat.textContent = formatNumber(totalWords);

  elements.totalFilesStat.textContent = formatNumber(totalFiles);

  elements.averageWordsStat.textContent = formatNumber(averageWords);
}

function countWords(text) {
  return getCountableWordMatches(text).length;
}

function renderPreview() {
  const searchText = elements.previewSearch.value
    .trim()
    .toLocaleLowerCase("vi");

  const limitValue = elements.previewLimit.value;

  let files = state.outputFiles.filter((file) => {
    if (!searchText) {
      return true;
    }

    return (
      file.fileName.toLocaleLowerCase("vi").includes(searchText) ||
      file.content.toLocaleLowerCase("vi").includes(searchText)
    );
  });

  if (limitValue !== "all") {
    files = files.slice(0, Number.parseInt(limitValue, 10));
  }

  if (files.length === 0) {
    elements.previewContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">👁</div>
                <strong>
                    ${
                      state.outputFiles.length > 0
                        ? "Không tìm thấy kết quả phù hợp"
                        : "Chưa có dữ liệu xem trước"
                    }
                </strong>
                <p>
                    ${
                      state.outputFiles.length > 0
                        ? "Hãy thử thay đổi nội dung tìm kiếm."
                        : "Chọn file TXT và nhấn “Xử lý và xem trước”."
                    }
                </p>
            </div>
        `;

    return;
  }

  const maximumPreviewCharacters = 2500;

  elements.previewContainer.innerHTML = files
    .map((file) => {
      const isTruncated = file.content.length > maximumPreviewCharacters;

      const previewContent = isTruncated
        ? file.content.slice(0, maximumPreviewCharacters)
        : file.content;

      return `
                <article class="preview-card">
                    <header class="preview-card-header">
                        <strong>${escapeHtml(file.fileName)}</strong>

                        <span class="preview-meta">
                            ${formatNumber(file.words)} từ ·
                            ${formatNumber(file.characters)} ký tự
                        </span>
                    </header>

                    <pre class="preview-content">${escapeHtml(previewContent)}${
                      isTruncated
                        ? '<span class="preview-truncated">… Nội dung xem trước đã được rút gọn.</span>'
                        : ""
                    }</pre>
                </article>
            `;
    })
    .join("");
}

async function saveOutputFiles() {
  if (state.outputFiles.length === 0) {
    showToast("Chưa có file kết quả để lưu.", "warning");
    return;
  }

  elements.saveFilesBtn.disabled = true;
  elements.processBtn.disabled = true;

  try {
    if (state.directoryHandle) {
      await saveFilesToDirectory();
    } else {
      await downloadFilesIndividually();
    }
  } catch (error) {
    updateProgress(0, "Lưu file thất bại");
    addLog("error", `Lưu file thất bại: ${error.message}`);
    showToast("Không thể lưu đầy đủ các file.", "error");
  } finally {
    elements.saveFilesBtn.disabled = false;
    elements.processBtn.disabled = false;
  }
}

async function saveFilesToDirectory() {
  const permissionGranted = await verifyDirectoryPermission(
    state.directoryHandle,
  );

  if (!permissionGranted) {
    throw new Error("Không có quyền ghi vào thư mục đã chọn.");
  }

  const totalFiles = state.outputFiles.length;

  addLog(
    "info",
    `Bắt đầu lưu ${formatNumber(totalFiles)} file vào thư mục "${state.directoryHandle.name}".`,
  );

  for (let index = 0; index < totalFiles; index += 1) {
    const outputFile = state.outputFiles[index];

    const fileHandle = await state.directoryHandle.getFileHandle(
      outputFile.fileName,
      { create: true },
    );

    const writable = await fileHandle.createWritable();

    await writable.write(
      new Blob(["\uFEFF", outputFile.content], {
        type: "text/plain;charset=utf-8",
      }),
    );

    await writable.close();

    const percentage = Math.round(((index + 1) / totalFiles) * 100);

    updateProgress(
      percentage,
      `Đang lưu ${index + 1}/${totalFiles}: ${outputFile.fileName}`,
    );

    addLog("success", `Đã lưu "${outputFile.fileName}".`);

    await nextFrame();
  }

  updateProgress(100, `Đã lưu ${formatNumber(totalFiles)} file`);

  showToast(
    `Đã lưu ${formatNumber(totalFiles)} file vào thư mục đã chọn.`,
    "success",
  );
}

async function verifyDirectoryPermission(directoryHandle) {
  const options = { mode: "readwrite" };

  if ((await directoryHandle.queryPermission(options)) === "granted") {
    return true;
  }

  return (await directoryHandle.requestPermission(options)) === "granted";
}

async function downloadFilesIndividually() {
  const totalFiles = state.outputFiles.length;

  addLog(
    "warning",
    "Chưa chọn thư mục. Trình duyệt sẽ tải từng file xuống thư mục tải xuống mặc định.",
  );

  for (let index = 0; index < totalFiles; index += 1) {
    const outputFile = state.outputFiles[index];

    downloadTextFile(outputFile.fileName, outputFile.content);

    const percentage = Math.round(((index + 1) / totalFiles) * 100);

    updateProgress(
      percentage,
      `Đang tải ${index + 1}/${totalFiles}: ${outputFile.fileName}`,
    );

    addLog("success", `Đã gửi yêu cầu tải "${outputFile.fileName}".`);

    await delay(120);
  }

  updateProgress(100, `Đã tạo ${formatNumber(totalFiles)} lượt tải`);

  showToast(`Đã tải ${formatNumber(totalFiles)} file.`, "success");
}

function downloadTextFile(fileName, content) {
  const blob = new Blob(["\uFEFF", content], {
    type: "text/plain;charset=utf-8",
  });

  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.style.display = "none";

  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 1000);
}

function saveConfiguration() {
  const configuration = {
    splitMode: getSelectedMode(),
    wordsPerFile: elements.wordsPerFile.value,
    keywords: elements.keywordsInput.value,
    caseSensitive: elements.caseSensitive.checked,
    removeEmptyParts: elements.removeEmptyParts.checked,
    outputPrefix: elements.outputPrefix.value,
    startNumber: elements.startNumber.value,
    numberPadding: elements.numberPadding.value,
    fileSeparator: elements.fileSeparator.value,
    previewLimit: elements.previewLimit.value,
  };

  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(configuration));

  addLog("success", "Đã lưu cấu hình vào trình duyệt.");
  showToast("Đã lưu cấu hình.", "success");
}

function loadConfiguration() {
  try {
    const rawConfiguration = localStorage.getItem(CONFIG_STORAGE_KEY);

    if (!rawConfiguration) {
      return;
    }

    const configuration = JSON.parse(rawConfiguration);

    if (configuration.splitMode) {
      const modeInput = document.querySelector(
        `input[name="splitMode"][value="${configuration.splitMode}"]`,
      );

      if (modeInput) {
        modeInput.checked = true;
      }
    }

    elements.wordsPerFile.value = configuration.wordsPerFile ?? "1000";

    elements.keywordsInput.value = configuration.keywords ?? "";

    elements.caseSensitive.checked = Boolean(configuration.caseSensitive);

    elements.removeEmptyParts.checked =
      configuration.removeEmptyParts !== false;

    elements.outputPrefix.value = configuration.outputPrefix ?? "phan";

    elements.startNumber.value = configuration.startNumber ?? "1";

    elements.numberPadding.value = configuration.numberPadding ?? "3";

    elements.fileSeparator.value = configuration.fileSeparator ?? "_";

    elements.previewLimit.value = configuration.previewLimit ?? "10";

    addLog("info", "Đã khôi phục cấu hình đã lưu.");
  } catch (error) {
    console.error(error);
    addLog("warning", "Không thể đọc cấu hình đã lưu.");
  }
}

function resetConfiguration() {
  const confirmed = window.confirm(
    "Bạn có chắc muốn đặt lại toàn bộ thiết lập và kết quả?",
  );

  if (!confirmed) {
    return;
  }

  localStorage.removeItem(CONFIG_STORAGE_KEY);

  const defaultMode = document.querySelector(
    'input[name="splitMode"][value="words"]',
  );

  defaultMode.checked = true;

  elements.wordsPerFile.value = "1000";
  elements.keywordsInput.value = "";
  elements.caseSensitive.checked = false;
  elements.removeEmptyParts.checked = true;

  elements.outputPrefix.value = "phan";
  elements.startNumber.value = "1";
  elements.numberPadding.value = "3";
  elements.fileSeparator.value = "_";
  elements.previewLimit.value = "10";
  elements.previewSearch.value = "";

  elements.txtFileInput.value = "";
  elements.fileNameText.textContent = "Nhấn để chọn file TXT";
  elements.fileInfoText.textContent = "Hoặc kéo và thả file vào khu vực này";

  elements.folderNameText.textContent = "Chưa chọn thư mục";

  state.sourceFile = null;
  state.sourceText = "";
  state.outputFiles = [];
  state.directoryHandle = null;

  updateModeDisplay();
  updateFileNameExample();
  updateStatistics();
  renderPreview();
  clearLog();

  elements.saveFilesBtn.disabled = true;

  updateProgress(0, "Chưa có tác vụ");
  addLog("info", "Đã đặt lại toàn bộ ứng dụng.");

  showToast("Đã đặt lại ứng dụng.", "success");
}

function clearProcessedResults() {
  if (state.outputFiles.length === 0) {
    return;
  }

  state.outputFiles = [];
  elements.saveFilesBtn.disabled = true;

  updateStatistics();
  renderPreview();
  updateProgress(0, "Thiết lập đã thay đổi, cần xử lý lại");

  addLog("warning", "Thiết lập đã thay đổi. Hãy xử lý lại nội dung.");
}

function updateProgress(percentage, statusText) {
  const safePercentage = Math.min(100, Math.max(0, Number(percentage) || 0));

  elements.progressBar.style.width = `${safePercentage}%`;
  elements.progressPercent.textContent = `${Math.round(safePercentage)}%`;

  elements.progressStatus.textContent = statusText || "Đang xử lý...";
}

function addLog(type, message) {
  const time = new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());

  const entry = document.createElement("div");
  entry.className = `log-entry ${type}`;

  entry.innerHTML = `
        <span class="log-time">${escapeHtml(time)}</span>
        <span class="log-type">${escapeHtml(getLogLabel(type))}</span>
        <span>${escapeHtml(message)}</span>
    `;

  elements.logContainer.appendChild(entry);
  elements.logContainer.scrollTop = elements.logContainer.scrollHeight;
}

function getLogLabel(type) {
  const labels = {
    info: "THÔNG TIN",
    success: "THÀNH CÔNG",
    warning: "CẢNH BÁO",
    error: "LỖI",
  };

  return labels[type] || "THÔNG TIN";
}

function clearLog() {
  elements.logContainer.innerHTML = "";
}

function showToast(message, type = "info") {
  const toast = document.createElement("div");

  toast.className = `toast ${type}`;
  toast.textContent = message;

  elements.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3500);
}

function formatNumber(value) {
  return new Intl.NumberFormat("vi-VN").format(Number(value) || 0);
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );

  const size = bytes / Math.pow(1024, unitIndex);

  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function nextFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

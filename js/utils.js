/**
 * Hiển thị thông báo toast (không chặn UI như alert)
 * @param {string} message Nội dung thông báo
 * @param {'info'|'success'|'warning'|'error'} type Loại thông báo
 * @param {number} duration Thời gian hiển thị (ms)
 */
function showToast(message, type = 'info', duration = 3200) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));

    const remove = () => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 200);
    };

    toast.addEventListener('click', remove);
    setTimeout(remove, duration);
}

/**
 * Chuyển đổi số byte thành định dạng dễ đọc (KB, MB, GB,...)
 * @param {number} bytes Số byte
 * @param {number} decimals Số chữ số thập phân
 * @returns {string} Chuỗi định dạng dễ đọc
 */
function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/**
 * Định dạng thời gian tính bằng giây thành mm:ss hoặc hh:mm:ss
 * @param {number} seconds Tổng số giây
 * @returns {string} Chuỗi thời gian định dạng
 */
function formatTime(seconds) {
    seconds = Math.floor(seconds);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;

    const parts = [];
    if (h > 0) parts.push(h.toString().padStart(2, '0'));
    parts.push(m.toString().padStart(2, '0'));
    parts.push(s.toString().padStart(2, '0'));

    return parts.join(':');
}

/**
 * Cho phép kéo thả các dòng trong một bảng (table tbody)
 * @param {HTMLElement} table Thẻ table cần áp dụng kéo thả
 */
function enableDragSort(tableId) {
    const table = document.getElementById(tableId);
    if (!table) return;
    
    const tbody = table.querySelector('tbody');
    let draggedRow = null;

    tbody.addEventListener('dragstart', function(e) {
        draggedRow = e.target.closest('tr');
        if(draggedRow) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/html', draggedRow.innerHTML);
            setTimeout(() => {
                draggedRow.classList.add('drag-sort-active');
            }, 0);
        }
    });

    tbody.addEventListener('dragover', function(e) {
        e.preventDefault();
        const targetRow = e.target.closest('tr');
        if(targetRow && targetRow !== draggedRow && targetRow.nodeName === 'TR') {
            const rect = targetRow.getBoundingClientRect();
            const next = (e.clientY - rect.top) / (rect.bottom - rect.top) > .5;
            tbody.insertBefore(draggedRow, next && targetRow.nextSibling || targetRow);
            
            // Cập nhật lại số thứ tự
            updateRowNumbers(tbody);
        }
    });

    tbody.addEventListener('dragend', function(e) {
        if(draggedRow) {
            draggedRow.classList.remove('drag-sort-active');
            draggedRow = null;
        }
    });
}

/**
 * Cập nhật số thứ tự cho cột STT trong bảng
 * @param {HTMLElement} tbody Element tbody của bảng
 */
function updateRowNumbers(tbody) {
    const rows = tbody.querySelectorAll('tr');
    rows.forEach((row, index) => {
        const cell = row.querySelector('td:first-child');
        if (cell) {
            cell.textContent = index + 1;
        }
    });
}

/**
 * Lấy đối tượng định dạng chương dựa vào regex hoặc loại định sẵn
 * @returns {RegExp} Biểu thức chính quy để nhận diện chương
 */
function getChapterRegex() {
    const type = document.querySelector('input[name="chapter-type"]:checked').value;
    let regexStr = "";
    
    switch(type) {
        case 'chuong': regexStr = "^Chương\\s+\\d+"; break;
        case 'chapter': regexStr = "^Chapter\\s+\\d+"; break;
        case 'hoi': regexStr = "^Hồi\\s+\\d+"; break;
        case 'quyen': regexStr = "^Quyển\\s+\\d+"; break;
        case 'custom': 
            regexStr = document.getElementById('custom-regex').value; 
            break;
    }
    
    if(!regexStr) {
        return null;
    }
    
    try {
        // Cờ 'i' cho phép không phân biệt hoa thường
        return new RegExp(regexStr, "i");
    } catch(e) {
        showToast("Regex không hợp lệ!", 'error');
        return null;
    }
}

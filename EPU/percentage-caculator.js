// ==UserScript==
// @name         EPU Attendance Percentage Calculator
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  Tính % nghỉ học dựa trên thông tin điểm danh và chương trình khung EPU (Fix Mã HP 10 ký tự)
// @match        https://sv.epu.edu.vn/dashboard.html
// @grant        none
// ==/UserScript==

(async function() {
    'use strict';

    // 1. Tạo Giao diện UI (Dashboard)
    const uiHTML = `
        <div id="epu-absent-dashboard" style="position: fixed; bottom: 20px; right: 20px; width: 550px; background: white; border: 1px solid #ccc; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.2); z-index: 9999; font-family: Arial, sans-serif; overflow: hidden;">
            <div style="background: #0056b3; color: white; padding: 10px 15px; font-weight: bold; display: flex; justify-content: space-between; align-items: center; cursor: pointer;" id="epu-dashboard-header">
                <span>📊 Thống kê phần trăm nghỉ học</span>
                <span id="epu-toggle-btn">▼</span>
            </div>
            <div id="epu-dashboard-content" style="padding: 15px; max-height: 400px; overflow-y: auto;">
                <div style="margin-bottom: 10px; display: flex; align-items: center; gap: 10px;">
                    <label style="font-weight: bold;">Chọn kỳ học:</label>
                    <select id="epu-semester-select" style="padding: 5px; border-radius: 4px; border: 1px solid #ccc; flex-grow: 1;">
                        <option>Đang tải dữ liệu...</option>
                    </select>
                </div>
                <table style="width: 100%; border-collapse: collapse; text-align: center; font-size: 13px;">
                    <thead>
                        <tr style="background: #f1f1f1;">
                            <th style="border: 1px solid #ddd; padding: 8px;">Mã HP</th>
                            <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Tên môn học</th>
                            <th style="border: 1px solid #ddd; padding: 8px;" title="Lý thuyết + Thực hành">Tổng tiết</th>
                            <th style="border: 1px solid #ddd; padding: 8px;" title="Có phép + Không phép">Đã nghỉ</th>
                            <th style="border: 1px solid #ddd; padding: 8px;">Tỷ lệ %</th>
                        </tr>
                    </thead>
                    <tbody id="epu-table-body">
                        <tr><td colspan="5">Đang xử lý dữ liệu...</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', uiHTML);

    const contentDiv = document.getElementById('epu-dashboard-content');
    const toggleBtn = document.getElementById('epu-toggle-btn');
    const semesterSelect = document.getElementById('epu-semester-select');
    const tableBody = document.getElementById('epu-table-body');

    // Mở / Đóng bảng
    document.getElementById('epu-dashboard-header').addEventListener('click', () => {
        if (contentDiv.style.display === 'none') {
            contentDiv.style.display = 'block';
            toggleBtn.textContent = '▼';
        } else {
            contentDiv.style.display = 'none';
            toggleBtn.textContent = '▲';
        }
    });

    try {
        const parser = new DOMParser();

        // 2. Fetch song song trang điểm danh và trang khung kiến thức
        const [diemdanhRes, ctkPageRes] = await Promise.all([
            fetch('/thong-tin-diem-danh.html'),
            fetch('/chuong-trinh-khung-theo-khoi-kien-thuc.html')
        ]);

        const diemdanhHtml = await diemdanhRes.text();
        const ctkPageHtml = await ctkPageRes.text();

        // 3. Lấy token IDCTKStr
        const docCTKPage = parser.parseFromString(ctkPageHtml, 'text/html');
        const idCtkInput = docCTKPage.querySelector('input#IDCTKStr');
        const pIDStr = idCtkInput ? idCtkInput.value : '';

        if (!pIDStr) {
            throw new Error('Không tìm thấy token IDCTKStr của tài khoản.');
        }

        // 4. Lấy chi tiết CTK theo khối kiến thức
        const ctkDetailRes = await fetch('/SinhVien/CTK_ChuongTrinhKhungTheoKhoiKienThucDetail', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: `pIDStr=${encodeURIComponent(pIDStr)}&pIsHocKy=true&pIsPrint=false`
        });

        const ctkDetailHtml = await ctkDetailRes.text();
        const docCTKDetail = parser.parseFromString(ctkDetailHtml, 'text/html');

        // 5. Map Mã Học Phần -> Tổng số tiết (LT + TH)
        const syllabusMap = {};
        const ctkRows = docCTKDetail.querySelectorAll('#accordion table tbody tr');

        ctkRows.forEach(tr => {
            const tds = tr.querySelectorAll('td');
            if (tds.length >= 10) {
                const courseCodeText = tds[3]?.innerText.trim();
                const theoryHoursText = tds[8]?.innerText.trim() || '0';
                const practiceHoursText = tds[9]?.innerText.trim() || '0';

                if (courseCodeText) {
                    const theoryHours = parseInt(theoryHoursText, 10) || 0;
                    const practiceHours = parseInt(practiceHoursText, 10) || 0;
                    syllabusMap[courseCodeText] = theoryHours + practiceHours;
                }
            }
        });

        // 6. Phân tích bảng Điểm danh
        const docDiemDanh = parser.parseFromString(diemdanhHtml, 'text/html');
        const attendanceData = {};
        let currentSemester = "";

        const diemdanhRows = docDiemDanh.querySelectorAll('.table-responsive table tbody tr');
        diemdanhRows.forEach(tr => {
            const tds = tr.querySelectorAll('td');

            // Dòng tiêu đề kỳ học
            if (tr.classList.contains('row-head') && tds.length === 1 && tds[0].colSpan > 4) {
                currentSemester = tds[0].innerText.trim();
                if (!attendanceData[currentSemester]) {
                    attendanceData[currentSemester] = [];
                }
            }
            // Dòng môn học
            else if (tds.length >= 6 && !tr.classList.contains('row-head')) {
                const classCodeFull = tds[1]?.innerText.trim();
                const courseName = tds[2]?.innerText.trim();
                const excusedText = tds[4]?.innerText.trim() || '0';
                const unexcusedText = tds[5]?.innerText.trim() || '0';

                if (classCodeFull) {
                    // Mã học phần chuẩn luôn lấy đúng 10 ký tự đầu tiên
                    const baseCode = classCodeFull.length >= 10 ? classCodeFull.substring(0, 10) : classCodeFull;
                    const excused = parseInt(excusedText, 10) || 0;
                    const unexcused = parseInt(unexcusedText, 10) || 0;
                    const totalAbsent = excused + unexcused;

                    // Khớp với tổng tiết trong syllabusMap
                    const totalHours = syllabusMap[baseCode] || 0;

                    let percentStr = "N/A";
                    let percentValue = 0;
                    if (totalHours > 0) {
                        percentValue = (totalAbsent / totalHours) * 100;
                        percentStr = percentValue.toFixed(1) + "%";
                    }

                    attendanceData[currentSemester].push({
                        code: baseCode,
                        name: courseName,
                        absent: totalAbsent,
                        totalHours: totalHours,
                        percentValue: percentValue,
                        percentStr: percentStr
                    });
                }
            }
        });

        // 7. Hiển thị UI
        const semesters = Object.keys(attendanceData);
        if (semesters.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="5">Không tìm thấy dữ liệu.</td></tr>';
            return;
        }

        semesterSelect.innerHTML = '';
        semesters.forEach(sem => {
            const option = document.createElement('option');
            option.value = sem;
            option.textContent = sem;
            semesterSelect.appendChild(option);
        });

        const defaultSemester = semesters[semesters.length - 1];
        semesterSelect.value = defaultSemester;

        const renderTable = (semesterName) => {
            const courses = attendanceData[semesterName];
            tableBody.innerHTML = '';

            if (!courses || courses.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="5">Kỳ này không có dữ liệu.</td></tr>';
                return;
            }

            courses.forEach(c => {
                const tr = document.createElement('tr');
                const color = c.percentValue >= 20 ? 'color: red; font-weight: bold;' : '';

                tr.innerHTML = `
                    <td style="border: 1px solid #ddd; padding: 6px;">${c.code}</td>
                    <td style="border: 1px solid #ddd; padding: 6px; text-align: left;">${c.name}</td>
                    <td style="border: 1px solid #ddd; padding: 6px;">${c.totalHours || 'Chưa rõ'}</td>
                    <td style="border: 1px solid #ddd; padding: 6px; font-weight: bold;">${c.absent}</td>
                    <td style="border: 1px solid #ddd; padding: 6px; ${color}">${c.percentStr}</td>
                `;
                tableBody.appendChild(tr);
            });
        };

        renderTable(defaultSemester);

        semesterSelect.addEventListener('change', (e) => {
            renderTable(e.target.value);
        });

    } catch (error) {
        console.error("Lỗi khi lấy dữ liệu:", error);
        tableBody.innerHTML = '<tr><td colspan="5" style="color:red;">Có lỗi xảy ra khi lấy dữ liệu. Vui lòng tải lại trang.</td></tr>';
    }
})();
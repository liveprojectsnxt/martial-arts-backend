document.addEventListener('DOMContentLoaded', () => {
    // 1. Session Guard (Check Admin role)
    const loggedUser = JSON.parse(sessionStorage.getItem('loggedUser') || '{}');
    const userRole = sessionStorage.getItem('userRole');

    if (userRole !== 'ADMIN') {
        alert('Access Denied. Only Admin can access this panel.');
        window.location.href = '/login';
        return;
    }

    if (loggedUser.name) {
        document.getElementById('adminNameDisplay').textContent = `Admin: ${loggedUser.name}`;
    }

    // Modals Initialization (Single Declarations)
    const detailModal = new bootstrap.Modal(document.getElementById('studentDetailModal'));
    const approveModal = new bootstrap.Modal(document.getElementById('approveFeeModal'));
    const rejectModal = new bootstrap.Modal(document.getElementById('rejectReasonModal'));
    const discModal = new bootstrap.Modal(document.getElementById('discontinueModal'));
    const collectModalElement = document.getElementById('adminCollectFeeModal');
    const collectModal = collectModalElement ? new bootstrap.Modal(collectModalElement) : null;
    const rejPayModalElement = document.getElementById('rejectPaymentModal');
    const rejPayModal = rejPayModalElement ? new bootstrap.Modal(rejPayModalElement) : null;

    // Cache Data Structures
    let studentsCache = new Map();
    let approvedStudentsLedgerCache = [];
    let pendingPaymentsCache = [];
    let allPaymentsAuditCache = [];

    // Default effective date
    const effectiveDateEl = document.getElementById('effectiveFrom');
    if (effectiveDateEl) {
        effectiveDateEl.value = new Date().toISOString().split('T')[0];
    }

    function showAlert(msg, isSuccess = true) {
        const alertBox = document.getElementById('dashboardAlert');
        if (!alertBox) return;
        alertBox.className = `alert ${isSuccess ? 'alert-success' : 'alert-danger'} shadow-sm`;
        alertBox.textContent = msg;
        alertBox.classList.remove('d-none');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        setTimeout(() => alertBox.classList.add('d-none'), 5000);
    }

    function resolveFileUrl(fullPath) {
        if (!fullPath) return 'https://placehold.co/150x150?text=No+File';
        const normalized = fullPath.replace(/\\/g, '/');
        const fileName = normalized.substring(normalized.lastIndexOf('/') + 1);
        return `/files/${encodeURIComponent(fileName)}`;
    }

    // ========================================================
    // 1. FETCH & POPULATE TABLES
    // ========================================================
    async function loadDashboardData() {
        try {
            const [resPending, resApproved, resRejected, resDisc, resPayments, resAllPayments] = await Promise.all([
                fetch('/api/admin/students/pending'),
                fetch('/api/admin/students/approved'),
                fetch('/api/admin/students/rejected'),
                fetch('/api/admin/students/discontinued'),
                fetch('/api/fees/pending-payments'),
                fetch('/api/fees/all-payments-history')
            ]);

            const pending = await resPending.json();
            const approved = await resApproved.json();
            const rejected = await resRejected.json();
            const discontinued = await resDisc.json();
            pendingPaymentsCache = resPayments.ok ? await resPayments.json() : [];
            allPaymentsAuditCache = resAllPayments.ok ? await resAllPayments.json() : [];

            // Populate Student Dropdown in Collect Modal
            const collectSelect = document.getElementById('collectStudentSelect');
            if (collectSelect) {
                collectSelect.innerHTML = approved.map(s => `<option value="${s.id}">${s.name} (#${s.id} - ${s.mobile})</option>`).join('');
            }

            // Cache all students by ID
            studentsCache.clear();
            [...pending, ...approved, ...rejected, ...discontinued].forEach(s => studentsCache.set(s.id, s));

            // 🎯 डेटा लोड होते ही अटेंडेंस मोडल का ड्रॉपडाउन अपडेट करें (Approved Only)
            updateManualStudentDropdown();

            renderPaymentAuditTrail();

            // Counts
            document.getElementById('pendingCount').textContent = pending.length;
            document.getElementById('approvedCount').textContent = approved.length;
            document.getElementById('rejectedCount').textContent = rejected.length;
            document.getElementById('discontinuedCount').textContent = discontinued.length;
            
            const pCountEl = document.getElementById('pendingPaymentsCount');
            if (pCountEl) {
                pCountEl.textContent = pendingPaymentsCache.length;
            }

            renderPendingTable(pending);
            renderPendingPaymentsTable(pendingPaymentsCache);
            renderRejectedTable(rejected);
            renderDiscontinuedTable(discontinued);

            // Parallel ledger load for approved students
            await fetchApprovedLedgersAndRender(approved);

        } catch (err) {
            console.error(err);
            showAlert('Failed to fetch student lists. Check backend connection.', false);
        }
    }

    // ==========================================
    // 🎯 ATTENDANCE LOGIC FOR TEACHER / ADMIN
    // ==========================================
    const attBatchSelect = document.getElementById('attBatchSelect');
    const manBatchSelect = document.getElementById('manBatchSelect');
    const attDateSelect = document.getElementById('attDateSelect');
    const manStudentSelect = document.getElementById('manStudentSelect');
    const manStatusSelect = document.getElementById('manStatus');
    const lateWrapper = document.getElementById('lateDetailsWrapper');

    const todayStr = new Date().toISOString().split('T')[0];
    if (attDateSelect) attDateSelect.value = todayStr;
    const manTargetDate = document.getElementById('manTargetDate');
    if (manTargetDate) manTargetDate.value = todayStr;

    // LATE स्टेटस चुनने पर चेतावनी / विवरण दिखाना
    if (manStatusSelect) {
        manStatusSelect.addEventListener('change', (e) => {
            if (e.target.value === 'LATE') {
                if (lateWrapper) lateWrapper.classList.remove('d-none');
            } else {
                if (lateWrapper) lateWrapper.classList.add('d-none');
            }
        });
    }

    // 🎯 1. Load Batches into Dropdowns (Roster + Modal)
    async function loadBatches() {
        try {
            const res = await fetch('/api/attendance/batches');
            if (res.ok) {
                const batches = await res.json();
                if (batches.length === 0) {
                    const noBatch = '<option value="">No Active Batches Found</option>';
                    if (attBatchSelect) attBatchSelect.innerHTML = noBatch;
                    if (manBatchSelect) manBatchSelect.innerHTML = noBatch;
                    return;
                }

                const options = batches.map(b => 
                    `<option value="${b.id}">${b.name} (${b.startTime.substring(0,5)} - ${b.endTime.substring(0,5)})</option>`
                ).join('');

                if (attBatchSelect) attBatchSelect.innerHTML = options;
                if (manBatchSelect) manBatchSelect.innerHTML = options;
            }
        } catch (e) {
            console.error('Error loading batches:', e);
        }
    }
    loadBatches();

    // 🎯 2. Populate ONLY APPROVED Students into Manual Attendance Modal
    function updateManualStudentDropdown() {
        if (!manStudentSelect) return;
        
        // केवल APPROVED छात्रों को फ़िल्टर करें
        const approved = Array.from(studentsCache.values()).filter(s => s.status === 'APPROVED');
        
        if (approved.length === 0) {
            manStudentSelect.innerHTML = '<option value="">No Approved Students Available</option>';
            return;
        }

        approved.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        manStudentSelect.innerHTML = `
            <option value="">-- Choose Approved Student (${approved.length}) --</option>
            ${approved.map(s => `<option value="${s.id}">${s.name} (#${s.id} - ${s.mobile})</option>`).join('')}
        `;
    }

    // जब भी Manual Modal खुले, ड्रॉपडाउन सुनिश्चित करें
    const manModalEl = document.getElementById('teacherManualAttendanceModal');
    if (manModalEl) {
        manModalEl.addEventListener('show.bs.modal', () => {
            updateManualStudentDropdown();
            loadBatches();
        });
    }

    // 🎯 3. Load Daily Roster
    const btnLoadRoster = document.getElementById('btnLoadRoster');
    if (btnLoadRoster) {
        btnLoadRoster.addEventListener('click', loadDailyRoster);
    }

    async function loadDailyRoster() {
        const batchId = attBatchSelect ? attBatchSelect.value : '';
        const date = attDateSelect ? attDateSelect.value : '';
        const body = document.getElementById('attendanceRosterBody');
        if (!body) return;

        if (!batchId || !date) {
            alert('Please select both batch and date.');
            return;
        }

        body.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted">Loading attendance roster...</td></tr>';

        try {
            const res = await fetch(`/api/attendance/teacher/roster?batchId=${batchId}&date=${date}`);
            if (!res.ok) throw new Error('Could not fetch roster');
            const roster = await res.json();

            if (!roster.length) {
                body.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted">No attendance requests or records found for this date.</td></tr>';
                return;
            }

            body.innerHTML = roster.map(a => {
                const s = studentsCache.get(Number(a.studentId));
                const sName = s ? s.name : `Student #${a.studentId}`;
                const sMobile = s ? s.mobile : '--';
                const checkIn = a.checkInTime ? a.checkInTime.substring(11, 16) : '--:--';
                const checkOut = a.checkOutTime ? a.checkOutTime.substring(11, 16) : '--:--';

                let statusBadge = '<span class="badge bg-warning text-dark">PENDING</span>';
                if (a.status === 'PRESENT') statusBadge = '<span class="badge bg-success">PRESENT</span>';
                else if (a.status === 'LATE') statusBadge = '<span class="badge bg-warning text-dark border border-dark">LATE</span>';
                else if (a.status === 'REJECTED') statusBadge = '<span class="badge bg-danger">REJECTED</span>';
                else if (a.status === 'EXCUSED') statusBadge = '<span class="badge bg-secondary">EXCUSED</span>';
                else if (a.status === 'ABSENT') statusBadge = '<span class="badge bg-dark">ABSENT</span>';

                return `
                    <tr>
                        <td>
                            <strong class="text-dark">${sName}</strong><br>
                            <small class="text-muted">#${a.studentId} | ${sMobile}</small>
                        </td>
                        <td>${statusBadge}</td>
                        <td class="fw-bold text-success">${checkIn} <span class="text-muted small">to</span> ${checkOut}</td>
                        <td><span class="badge bg-light text-dark border">${a.entryMode}</span></td>
                        <td><small class="text-muted">${a.remarks || 'None'}</small></td>
                        <td><small>${a.reviewedBy || 'Pending'}</small></td>
                        <td class="text-center">
                            <button class="btn btn-sm btn-success fw-bold py-1 px-2 me-1" onclick="reviewAttendanceAction(${a.id}, 'PRESENT')" title="Approve Present">
                                <i class="bi bi-check-circle"></i> Present
                            </button>
                            <button class="btn btn-sm btn-warning text-dark fw-bold py-1 px-2 me-1" onclick="reviewAttendanceAction(${a.id}, 'LATE')" title="Mark Late">
                                <i class="bi bi-clock-history"></i> Late
                            </button>
                            <button class="btn btn-sm btn-outline-danger py-1 px-2" onclick="reviewAttendanceAction(${a.id}, 'REJECTED')" title="Reject Check-in">
                                <i class="bi bi-x-circle"></i>
                            </button>
                        </td>
                    </tr>
                `;
            }).join('');

        } catch (e) {
            body.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-danger">Error loading roster.</td></tr>';
        }
    }

    // 🎯 4. Teacher Review Action
    window.reviewAttendanceAction = async function(attId, status) {
        let remarks = prompt(`Enter remarks/reason for marking ${status}:`, status === 'PRESENT' ? 'Verified in class' : (status === 'LATE' ? 'Late arrival' : 'Mismatch'));
        if (remarks === null) return;

        const params = new URLSearchParams();
        params.append('status', status);
        params.append('remarks', remarks);

        try {
            const res = await fetch(`/api/attendance/teacher/review/${attId}`, {
                method: 'POST',
                body: params
            });
            const data = await res.json();
            if (data.success) {
                loadDailyRoster();
            } else {
                alert('Action failed: ' + data.message);
            }
        } catch (e) {
            alert('Server error.');
        }
    };

    // 🎯 5. Teacher Manual / Retro Attendance Submit (Check-In & Check-Out Supported)
    const manualAttForm = document.getElementById('manualAttendanceForm');
    if (manualAttForm) {
        manualAttForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const studentId = document.getElementById('manStudentSelect').value;
            if (!studentId) {
                alert('Please select an approved student.');
                return;
            }

            const btn = document.getElementById('btnSubmitManualAtt');
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Saving...';

            const checkInVal = document.getElementById('manCheckIn') ? document.getElementById('manCheckIn').value : '';
            const checkOutVal = document.getElementById('manCheckOut') ? document.getElementById('manCheckOut').value : '';

            const params = new URLSearchParams();
            params.append('studentId', studentId);
            params.append('batchId', document.getElementById('manBatchSelect').value);
            params.append('targetDate', document.getElementById('manTargetDate').value);
            params.append('status', document.getElementById('manStatus').value);
            params.append('checkIn', checkInVal ? checkInVal + ':00' : '');
            params.append('checkOut', checkOutVal ? checkOutVal + ':00' : '');
            params.append('reason', document.getElementById('manReason').value);

            try {
                const res = await fetch('/api/attendance/teacher/manual-mark', {
                    method: 'POST',
                    body: params
                });
                const data = await res.json();
                if (data.success) {
                    alert('Attendance recorded successfully!');
                    const modalInst = bootstrap.Modal.getInstance(document.getElementById('teacherManualAttendanceModal'));
                    if (modalInst) modalInst.hide();
                    manualAttForm.reset();
                    loadDailyRoster();
                } else {
                    alert('Failed: ' + data.message);
                }
            } catch (err) {
                alert('Server error saving attendance.');
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<i class="bi bi-check2-circle"></i> Save Attendance Record';
            }
        });
    }

    // ========================================================
    // 🎯 1.1 RENDER ONLINE PENDING PAYMENTS TABLE
    // ========================================================
    function renderPendingPaymentsTable(list) {
        const body = document.getElementById('pendingPaymentsTableBody');
        if (!body) return;

        if (!list || !list.length) {
            body.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">No pending online payment receipts.</td></tr>';
            return;
        }

        body.innerHTML = list.map(p => {
            const s = studentsCache.get(Number(p.studentId));
            const studentName = s ? s.name : `Student #${p.studentId}`;
            const studentMobile = s ? s.mobile : '--';
            const screenshotUrl = resolveFileUrl(p.screenshotPath);
            const dateStr = p.paymentDate ? p.paymentDate.substring(0, 10) : 'Today';

            return `
                <tr class="table-warning">
                    <td>
                        <span class="student-link fw-bold" onclick="viewStudentDetails(${p.studentId})">${studentName}</span><br>
                        <small class="text-muted">#${p.studentId} | Mob: ${studentMobile}</small>
                    </td>
                    <td class="small fw-semibold text-dark">${dateStr}</td>
                    <td class="fw-bold text-success fs-6">₹${p.amount}</td>
                    <td>
                        <span class="badge bg-light text-dark border">${p.paymentMode}</span><br>
                        <small class="text-muted fw-bold">Ref: ${p.transactionId || 'N/A'}</small>
                    </td>
                    <td>
                        <a href="${screenshotUrl}" target="_blank" class="btn btn-sm btn-outline-dark py-1">
                            <i class="bi bi-image"></i> View Screenshot
                        </a>
                    </td>
                    <td class="text-center">
                        <button class="btn btn-sm btn-success fw-bold py-1 px-3 me-1 shadow-sm" onclick="approveOnlinePayment(${p.id}, '${studentName}', ${p.amount})">
                            <i class="bi bi-check-circle-fill"></i> Approve
                        </button>
                        <button class="btn btn-sm btn-outline-danger fw-bold py-1 px-2 shadow-sm" onclick="openRejectPaymentModal(${p.id}, '${studentName}', ${p.amount})">
                            <i class="bi bi-x-circle"></i> Reject
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // ========================================================
    // 🎯 1.2 APPROVE ONLINE PAYMENT WITH CONFIRMATION
    // ========================================================
    window.approveOnlinePayment = async function(paymentId, studentName, amount) {
        if (!confirm(`Are you sure you want to verify and APPROVE payment of ₹${amount} for ${studentName}?`)) return;

        try {
            const res = await fetch(`/api/fees/approve-payment/${paymentId}`, { method: 'POST' });
            const msg = await res.text();
            if (res.ok) {
                showAlert(msg, true);
                loadDashboardData();
            } else {
                alert('Approval failed: ' + msg);
            }
        } catch (e) {
            alert('Server communication error.');
        }
    };

    // ========================================================
    // 🎯 1.3 REJECT ONLINE PAYMENT WITH REASON MODAL
    // ========================================================
    window.openRejectPaymentModal = function(paymentId, studentName, amount) {
        document.getElementById('rejPaymentId').value = paymentId;
        document.getElementById('rejPaymentStudentName').textContent = studentName;
        document.getElementById('rejPaymentAmount').textContent = `₹${amount}`;
        document.getElementById('rejPaymentReason').value = '';
        if (rejPayModal) rejPayModal.show();
    };

    const confirmPaymentRejBtn = document.getElementById('btnConfirmPaymentReject');
    if (confirmPaymentRejBtn) {
        confirmPaymentRejBtn.addEventListener('click', async () => {
            const paymentId = document.getElementById('rejPaymentId').value;
            const reason = document.getElementById('rejPaymentReason').value.trim();

            if (!reason) {
                alert('Please provide a clear rejection reason.');
                return;
            }

            confirmPaymentRejBtn.disabled = true;
            confirmPaymentRejBtn.textContent = 'Rejecting...';

            try {
                const res = await fetch(`/api/fees/reject-payment/${paymentId}?reason=${encodeURIComponent(reason)}`, {
                    method: 'POST'
                });

                const msg = await res.text();
                if (res.ok) {
                    showAlert(msg, true);
                    if (rejPayModal) rejPayModal.hide();
                    loadDashboardData();
                } else {
                    alert('Rejection failed: ' + msg);
                }
            } catch (e) {
                alert('Network error rejecting payment.');
            } finally {
                confirmPaymentRejBtn.disabled = false;
                confirmPaymentRejBtn.textContent = 'Confirm & Send Rejection to Student Portal';
            }
        });
    }

    function renderPendingTable(list) {
        const body = document.getElementById('pendingTableBody');
        if (!body) return;
        if (!list.length) {
            body.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">No pending admission requests.</td></tr>';
            return;
        }

        body.innerHTML = list.map(s => `
            <tr>
                <td>
                    <a href="${resolveFileUrl(s.photoPath)}" target="_blank" title="View Full Photo">
                        <img src="${resolveFileUrl(s.photoPath)}" class="student-thumb" alt="Photo" onerror="this.src='https://placehold.co/48x48?text=Pic'">
                    </a>
                </td>
                <td>
                    <span class="student-link fw-bold" onclick="viewStudentDetails(${s.id})">${s.name}</span><br>
                    <small class="text-muted">DOB: ${s.dob || 'N/A'} | Blood: ${s.bloodGroup || 'N/A'}</small>
                </td>
                <td>${s.fatherName || 'N/A'}</td>
                <td><i class="bi bi-telephone"></i> ${s.mobile}</td>
                <td>${s.createdAt ? s.createdAt.substring(0, 10) : 'N/A'}</td>
                <td class="text-center">
                    <button class="btn btn-sm btn-success fw-semibold me-1" onclick="openApproveModal(${s.id}, '${s.name}')">
                        <i class="bi bi-check-lg"></i> Approve
                    </button>
                    <button class="btn btn-sm btn-outline-danger fw-semibold" onclick="openRejectModal(${s.id}, '${s.name}')">
                        <i class="bi bi-x-lg"></i> Reject
                    </button>
                </td>
            </tr>
        `).join('');
    }

    function renderRejectedTable(list) {
        const body = document.getElementById('rejectedTableBody');
        if (!body) return;
        if (!list.length) {
            body.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">No rejected records.</td></tr>';
            return;
        }

        body.innerHTML = list.map(s => `
            <tr>
                <td>#${s.id}</td>
                <td>
                    <a href="${resolveFileUrl(s.photoPath)}" target="_blank" title="View Full Photo">
                        <img src="${resolveFileUrl(s.photoPath)}" class="student-thumb" alt="Photo">
                    </a>
                </td>
                <td><span class="student-link fw-bold" onclick="viewStudentDetails(${s.id})">${s.name}</span></td>
                <td>${s.mobile}</td>
                <td><span class="text-danger fw-semibold">${s.rejectionReason || 'No reason specified'}</span></td>
                <td class="text-center">
                    <button class="btn btn-sm btn-outline-success fw-bold" onclick="openApproveModal(${s.id}, '${s.name}')" title="Re-Approve this student">
                        <i class="bi bi-arrow-counterclockwise"></i> Re-Approve
                    </button>
                </td>
            </tr>
        `).join('');
    }

    function renderDiscontinuedTable(list) {
        const body = document.getElementById('discontinuedTableBody');
        if (!body) return;
        if (!list.length) {
            body.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted">No discontinued students.</td></tr>';
            return;
        }

        body.innerHTML = list.map(s => `
            <tr class="table-secondary">
                <td>#${s.id}</td>
                <td>
                    <a href="${resolveFileUrl(s.photoPath)}" target="_blank" title="View Full Photo">
                        <img src="${resolveFileUrl(s.photoPath)}" class="student-thumb" alt="Photo">
                    </a>
                </td>
                <td><span class="student-link fw-bold" onclick="viewStudentDetails(${s.id})">${s.name}</span></td>
                <td>${s.mobile}</td>
                <td>${s.discontinuedDate ? s.discontinuedDate.substring(0, 10) : '--'}</td>
                <td><span class="text-danger fw-semibold">${s.discontinuedReason || 'Left academy'}</span></td>
                <td class="text-center">
                    <button class="btn btn-sm btn-success fw-bold py-1" onclick="rejoinStudentAction(${s.id})">
                        <i class="bi bi-person-check"></i> Re-Join & Activate
                    </button>
                </td>
            </tr>
        `).join('');
    }

    // ========================================================
    // 2. PARALLEL LEDGER FETCH & SAFE FILTER
    // ========================================================
    async function fetchApprovedLedgersAndRender(approvedList) {
        approvedStudentsLedgerCache = [];
        const today = new Date();

        if (!approvedList || !approvedList.length) {
            applyFeeFilter();
            return;
        }

        const ledgerPromises = approvedList.map(async (s) => {
            let defaultLedger = { 
                admissionDate: s.createdAt ? s.createdAt.substring(0, 10) : 'N/A',
                currentMonthDueDate: '5th of Month',
                currentMonthPaidDate: 'Pending',
                currentMonthDueAmount: 0,
                currentMonthStatus: 'UNPAID',
                netOutstanding: 0, 
                advanceBalance: 0, 
                monthlyFeeRate: 0,
                daysLeft: null,
                advanceCoveredUpto: 'None',
                nextDueDate: null
            };

            try {
                const res = await fetch(`/api/fees/ledger/${s.id}`);
                if (res.ok) {
                    const l = await res.json();
                    
                    let dLeft = null;
                    if (l && l.nextDueDate) {
                        const dueDate = new Date(l.nextDueDate);
                        const diffTime = dueDate.setHours(0,0,0,0) - today.setHours(0,0,0,0);
                        dLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    }

                    return {
                        student: s,
                        ledger: {
                            admissionDate: l.admissionDate || (s.createdAt ? s.createdAt.substring(0, 10) : 'N/A'),
                            currentMonthDueDate: l.currentMonthDueDate || '5th of Month',
                            currentMonthPaidDate: l.currentMonthPaidDate || 'Pending',
                            currentMonthDueAmount: (l.currentMonthDueAmount !== undefined && l.currentMonthDueAmount !== null) 
                                ? Number(l.currentMonthDueAmount) 
                                : (Number(l.monthlyFeeRate) || 0),
                            currentMonthStatus: l.currentMonthStatus || 'UNPAID',
                            netOutstanding: Number(l.netOutstanding) || 0,
                            advanceBalance: Number(l.advanceBalance) || 0,
                            monthlyFeeRate: Number(l.monthlyFeeRate) || 0,
                            nextDueDate: l.nextDueDate || null,
                            daysLeft: dLeft,
                            advanceCoveredUpto: l.advanceCoveredUpto || 'None'
                        }
                    };
                }
            } catch (e) {
                console.warn(`Ledger error for student #${s.id}`, e);
            }

            return { student: s, ledger: defaultLedger };
        });

        approvedStudentsLedgerCache = await Promise.all(ledgerPromises);
        applyFeeFilter();
    }

    function applyFeeFilter() {
        const filterSelect = document.getElementById('feeFilterSelect');
        const filter = filterSelect ? filterSelect.value : 'ALL';
        const body = document.getElementById('approvedTableBody');

        if (!body) return;

        let filtered = approvedStudentsLedgerCache || [];

        if (filter === 'DUE_SOON') {
            filtered = filtered.filter(item =>
                item &&
                item.ledger &&
                item.ledger.daysLeft !== null &&
                item.ledger.daysLeft >= 0 &&
                item.ledger.daysLeft <= 10
            );
        } else if (filter === 'OVERDUE') {
            filtered = filtered.filter(item =>
                item &&
                item.ledger &&
                (
                    item.ledger.netOutstanding > 0 ||
                    (
                        item.ledger.daysLeft !== null &&
                        item.ledger.daysLeft < 0
                    )
                )
            );
        } else if (filter === 'ADVANCE') {
            filtered = filtered.filter(item =>
                item &&
                item.ledger &&
                item.ledger.advanceBalance > 0
            );
        }

        if (!filtered.length) {
            body.innerHTML =
                '<tr><td colspan="7" class="text-center py-4 text-muted">No students matching this filter.</td></tr>';
            return;
        }

        body.innerHTML = filtered.map(({ student: s, ledger: l }) => {
            const admissionDate =
                l.admissionDate ||
                (s.createdAt ? s.createdAt.substring(0, 10) : 'N/A');

            const dueDate =
                l.currentMonthDueDate || '5th of Month';

            const paidDate =
                l.currentMonthPaidDate || 'Pending';

            const dueAmount =
                l.currentMonthDueAmount !== undefined &&
                l.currentMonthDueAmount !== null
                    ? l.currentMonthDueAmount
                    : (l.monthlyFeeRate || 0);

            let statusBadge =
                '<span class="badge bg-danger">UNPAID</span>';

            if (l.currentMonthStatus === 'PAID') {
                statusBadge =
                    '<span class="badge bg-success">PAID</span>';
            } else if (l.currentMonthStatus === 'PARTIAL') {
                statusBadge =
                    '<span class="badge bg-warning text-dark">PARTIAL</span>';
            }

            let countdownBadge =
                '<span class="badge bg-secondary">No Plan</span>';

            if (l.advanceBalance > 0) {
                countdownBadge = `
                    <span class="badge bg-success">
                        <i class="bi bi-shield-check"></i>
                        Covered (${l.advanceCoveredUpto})
                    </span>
                `;
            } else if (l.daysLeft !== null) {
                if (l.daysLeft > 0 && l.daysLeft <= 10) {
                    countdownBadge = `
                        <span class="badge bg-warning text-dark">
                            <i class="bi bi-alarm"></i>
                            Due in ${l.daysLeft} days
                        </span>
                    `;
                } else if (l.daysLeft === 0) {
                    countdownBadge = `
                        <span class="badge bg-danger">
                            <i class="bi bi-exclamation-circle"></i>
                            Due Today!
                        </span>
                    `;
                } else if (l.daysLeft < 0) {
                    countdownBadge = `
                        <span class="badge bg-danger">
                            <i class="bi bi-exclamation-triangle"></i>
                            Overdue by ${Math.abs(l.daysLeft)} days
                        </span>
                    `;
                } else {
                    countdownBadge = `
                        <span class="badge bg-light text-dark border">
                            Due on ${l.nextDueDate}
                        </span>
                    `;
                }
            }

            let balanceText =
                l.advanceBalance > 0
                    ? `<strong class="text-success">+₹${l.advanceBalance} (Adv)</strong>`
                    : l.netOutstanding > 0
                        ? `<strong class="text-danger">-₹${l.netOutstanding} (Due)</strong>`
                        : `<span class="text-muted">₹0 (All Clear)</span>`;

            return `
                <tr>
                    <td>
                        <div class="d-flex align-items-center gap-2">
                            <a href="${resolveFileUrl(s.photoPath)}" target="_blank" title="View Full Photo">
                                <img src="${resolveFileUrl(s.photoPath)}" class="student-thumb" alt="Photo">
                            </a>
                            <div>
                                <span class="student-link fw-bold" onclick="viewStudentDetails(${s.id})">
                                    ${s.name}
                                </span><br>
                                <small class="text-muted">#${s.id} | ${s.mobile}</small><br>
                                <small class="text-muted">${s.fatherName || 'N/A'}</small>
                            </div>
                        </div>
                    </td>
                    <td class="small fw-semibold">${admissionDate}</td>
                    <td class="small text-danger fw-bold">${dueDate}</td>
                    <td class="small ${paidDate === 'Pending' ? 'text-muted' : 'text-success fw-bold'}">${paidDate}</td>
                    <td class="fw-bold ${dueAmount > 0 ? 'text-danger' : 'text-success'}">₹${dueAmount}</td>
                    <td>
                        ${countdownBadge}
                        <div class="mt-1">${balanceText}</div>
                    </td>
                    <td class="text-center">
                        <button class="btn btn-sm btn-success fw-bold py-1 px-2 me-1" onclick="openDirectCollectFeeModal(${s.id})" title="Collect Cash/UPI">
                            <i class="bi bi-cash"></i> Collect
                        </button>
                        <button class="btn btn-sm btn-outline-primary py-1 px-2 me-1" onclick="viewStudentDetails(${s.id})" title="View Full Ledger">
                            <i class="bi bi-wallet2"></i> Ledger
                        </button>
                        <button class="btn btn-sm btn-outline-warning text-dark py-1 px-2" onclick="openDiscontinueModal(${s.id}, '${s.name}')" title="Discontinue / Leave">
                            <i class="bi bi-person-x"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    const filterEl = document.getElementById('feeFilterSelect');
    if (filterEl) {
        filterEl.onchange = applyFeeFilter;
    }

    // ========================================================
    // 3. DIRECT COLLECT FEE MODAL LOGIC
    // ========================================================
    window.openDirectCollectFeeModal = async function(studentId) {
        const s = studentsCache.get(studentId);
        if (!s) return;

        document.getElementById('directCollectStudentId').value = s.id;

        const selectEl = document.getElementById('collectStudentSelect');
        if (selectEl) {
            selectEl.value = String(s.id);
        }

        const selectWrap = document.getElementById('studentSelectWrapper');
        const directWrap = document.getElementById('directStudentDisplayWrapper');
        const directInput = document.getElementById('directStudentNameInput');

        if (selectWrap) selectWrap.classList.add('d-none');
        if (directWrap) directWrap.classList.remove('d-none');
        if (directInput) directInput.value = `${s.name} (#${s.id} - ${s.mobile})`;

        const amountInput = document.getElementById('collectAmount');
        amountInput.value = '';

        try {
            const res = await fetch(`/api/fees/ledger/${s.id}`);
            if (res.ok) {
                const l = await res.json();
                const netDue = Number(l.netOutstanding) || 0;
                const monthly = Number(l.monthlyFeeRate) || 0;
                amountInput.value = netDue > 0 ? netDue : (monthly > 0 ? monthly : '');
            }
        } catch (e) {
            console.warn('Could not auto-fill due amount', e);
        }

        document.getElementById('collectUtr').value = '';
        document.getElementById('collectRemarks').value = '';

        if (collectModal) collectModal.show();
    };

    const topCollectBtn = document.querySelector('[data-bs-target="#adminCollectFeeModal"]');
    if (topCollectBtn) {
        topCollectBtn.onclick = () => {
            document.getElementById('directCollectStudentId').value = '';

            const selectWrap = document.getElementById('studentSelectWrapper');
            const directWrap = document.getElementById('directStudentDisplayWrapper');
            if (selectWrap) selectWrap.classList.remove('d-none');
            if (directWrap) directWrap.classList.add('d-none');

            const selectEl = document.getElementById('collectStudentSelect');
            if (selectEl) selectEl.value = '';

            document.getElementById('collectAmount').value = '';
            document.getElementById('collectUtr').value = '';
            document.getElementById('collectRemarks').value = '';
        };
    }

    const collectSelect = document.getElementById('collectStudentSelect');
    if (collectSelect) {
        collectSelect.onchange = async (e) => {
            const sId = e.target.value;
            if (!sId) return;

            try {
                const res = await fetch(`/api/fees/ledger/${sId}`);
                if (res.ok) {
                    const l = await res.json();
                    const netDue = Number(l.netOutstanding) || 0;
                    const monthly = Number(l.monthlyFeeRate) || 0;
                    document.getElementById('collectAmount').value = netDue > 0 ? netDue : monthly;
                }
            } catch (err) {}
        };
    }

    // Submit Collect Fee Form
    const collectForm = document.getElementById('adminCollectFeeForm');
    if (collectForm) {
        const receiptModalElement = document.getElementById('receiptModal');
        const receiptModal = receiptModalElement ? new bootstrap.Modal(receiptModalElement) : null;

        collectForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const directId = document.getElementById('directCollectStudentId').value;
            const selectedId = document.getElementById('collectStudentSelect').value;
            const finalStudentId = directId ? directId : selectedId;

            if (!finalStudentId) {
                alert('Please select a student.');
                return;
            }

            const amount = document.getElementById('collectAmount').value;
            const mode = document.getElementById('collectMode').value;
            const utr = document.getElementById('collectUtr').value;
            const remarks = document.getElementById('collectRemarks').value;

            const btn = document.getElementById('btnSubmitAdminCollect');
            btn.disabled = true;
            btn.textContent = 'Updating Ledger...';

            const params = new URLSearchParams();
            params.append('studentId', finalStudentId);
            params.append('amount', amount);
            params.append('mode', mode);
            params.append('transactionId', utr);
            params.append('remarks', remarks);

            try {
                const res = await fetch('/api/fees/admin-collect-fee', {
                    method: 'POST',
                    body: params
                });

                const msg = await res.text();

                if (res.ok) {
                    showAlert(msg, true);
                    if (collectModal) collectModal.hide();
                    collectForm.reset();
                    loadDashboardData();

                    let s = null;
                    const studentSelect = document.getElementById('collectStudentSelect');
                    if (studentSelect && studentSelect.selectedIndex >= 0) {
                        const selectedOption = studentSelect.options[studentSelect.selectedIndex];
                        if (selectedOption) {
                            s = {
                                name: selectedOption.dataset.name || selectedOption.textContent,
                                mobile: selectedOption.dataset.mobile || '--'
                            };
                        }
                    }

                    const recIdElement = document.getElementById('recId');
                    if (recIdElement) recIdElement.textContent = 'REC' + Date.now().toString().substring(6);

                    const recDateElement = document.getElementById('recDate');
                    if (recDateElement) recDateElement.textContent = new Date().toLocaleDateString('en-IN');

                    const recStudentNameElement = document.getElementById('recStudentName');
                    if (recStudentNameElement) recStudentNameElement.textContent = s && s.name ? s.name : 'Student';

                    const recStudentIdElement = document.getElementById('recStudentId');
                    if (recStudentIdElement) recStudentIdElement.textContent = '#' + finalStudentId;

                    const recMobileElement = document.getElementById('recMobile');
                    if (recMobileElement) recMobileElement.textContent = s && s.mobile ? s.mobile : '--';

                    const recModeElement = document.getElementById('recMode');
                    if (recModeElement) recModeElement.textContent = mode;

                    const recAmountElement = document.getElementById('recAmount');
                    if (recAmountElement) recAmountElement.textContent = '₹' + parseFloat(amount).toFixed(2);

                    const recUtrElement = document.getElementById('recUtr');
                    if (recUtrElement) recUtrElement.textContent = utr || 'OFFLINE_DESK';

                    const recRemarksElement = document.getElementById('recRemarks');
                    if (recRemarksElement) recRemarksElement.textContent = remarks || 'Monthly Fee Cleared';

                    if (receiptModal) receiptModal.show();
                } else {
                    alert('Collection failed: ' + msg);
                }
            } catch (err) {
                alert('Server communication error.');
            } finally {
                btn.disabled = false;
                btn.textContent = 'Accept Fee & Update Ledger Instantly';
            }
        });
    }

    // ========================================================
    // 4. STUDENT DOSSIER & FULL LEDGER VIEW
    // ========================================================
    window.viewStudentDetails = async function(id) {
        const s = studentsCache.get(id);
        if (!s) return;

        document.getElementById('mId').textContent = s.id;
        document.getElementById('mName').textContent = s.name;
        document.getElementById('mFather').textContent = s.fatherName || 'N/A';
        document.getElementById('mMobile').textContent = s.mobile;
        document.getElementById('mEmail').textContent = s.email || 'N/A';
        document.getElementById('mDob').textContent = s.dob || 'N/A';
        document.getElementById('mGender').textContent = s.gender || 'N/A';

        const badge = document.getElementById('mStatusBadge');
        badge.className = `badge ${s.status === 'APPROVED' ? 'bg-success' : s.status === 'REJECTED' ? 'bg-danger' : s.status === 'DISCONTINUED' ? 'bg-secondary' : 'bg-warning text-dark'}`;
        badge.textContent = s.status;

        const photoUrl = resolveFileUrl(s.photoPath);
        const signUrl = resolveFileUrl(s.signaturePath);
        document.getElementById('modalPhoto').src = photoUrl;
        document.getElementById('modalPhotoLink').href = photoUrl;
        document.getElementById('modalSign').src = signUrl;
        document.getElementById('modalSignLink').href = signUrl;

        document.getElementById('mCurrentAddress').textContent = s.currentAddress || 'N/A';
        document.getElementById('mPermanentAddress').textContent = s.permanentAddress || 'N/A';
        document.getElementById('mBloodGroup').textContent = s.bloodGroup || 'N/A';
        document.getElementById('mWeight').textContent = s.weight || 'N/A';
        document.getElementById('mAlignments').textContent = s.alignments || 'None';

        document.getElementById('mSchool').textContent = s.schoolName || 'N/A';
        document.getElementById('mQualification').textContent = s.qualification || 'N/A';
        document.getElementById('mOccupation').textContent = s.occupation || 'N/A';
        document.getElementById('mEmergencyName').textContent = s.emergencyContactName || 'N/A';
        document.getElementById('mEmergencyRelation').textContent = s.emergencyRelation || '';
        document.getElementById('mEmergencyPhone').textContent = s.emergencyContactPhone || 'N/A';

        const rejSection = document.getElementById('rejectionSection');
        if (s.status === 'REJECTED' && s.rejectionReason) {
            rejSection.classList.remove('d-none');
            document.getElementById('mRejectionReason').textContent = s.rejectionReason;
        } else {
            rejSection.classList.add('d-none');
        }

        document.getElementById('mActionHistory').textContent = s.actionHistory || 'No previous status changes logged.';

        const admMonthly = document.getElementById('admModalMonthlyBody');
        admMonthly.innerHTML = '<tr><td colspan="6" class="text-center py-2 text-muted small">Loading statement...</td></tr>';

        try {
            const ledgerRes = await fetch(`/api/fees/ledger/${id}`);
            if (ledgerRes.ok) {
                const ledger = await ledgerRes.json();
                
                document.getElementById('admModalDue').textContent = `₹${ledger.netOutstanding || 0}`;
                document.getElementById('admModalAdvance').textContent = `₹${ledger.advanceBalance || 0}`;
                document.getElementById('admModalCoverage').textContent = ledger.advanceCoveredUpto || 'None';
                document.getElementById('admModalNextAmount').textContent = `₹${ledger.nextDueAmount || 0}`;
                document.getElementById('admModalNextDate').textContent = ledger.nextDueDate ? `on ${ledger.nextDueDate}` : 'N/A';

                if (!ledger.monthlyStatements || !ledger.monthlyStatements.length) {
                    admMonthly.innerHTML = '<tr><td colspan="6" class="text-center py-2 text-muted small">No monthly dues records.</td></tr>';
                } else {
                    admMonthly.innerHTML = ledger.monthlyStatements.map(m => `
                        <tr>
                            <td><strong>${m.monthName}</strong></td>
                            <td>${m.feeType}</td>
                            <td>₹${m.totalAmount}</td>
                            <td class="text-success fw-bold">₹${m.paidAmount}</td>
                            <td class="${m.dueBalance > 0 ? 'text-danger fw-bold' : 'text-muted'}">₹${m.dueBalance}</td>
                            <td>
                                <span class="badge ${m.status === 'PAID' ? 'bg-success' : m.status === 'PARTIAL' ? 'bg-warning text-dark' : 'bg-danger'}">${m.status}</span>
                            </td>
                        </tr>
                    `).join('');
                }
            } else {
                admMonthly.innerHTML = '<tr><td colspan="6" class="text-center py-2 text-muted small">Fee plan not configured yet.</td></tr>';
            }
        } catch (err) {
            admMonthly.innerHTML = '<tr><td colspan="6" class="text-center py-2 text-danger small">Error fetching ledger.</td></tr>';
        }

        detailModal.show();
    };

    // ========================================================
    // 5. APPROVE & REJECT ACTIONS
    // ========================================================
    window.openApproveModal = function(id, name) {
        document.getElementById('modalStudentId').value = id;
        document.getElementById('modalStudentName').textContent = name;
        approveModal.show();
    };

    const feeSetupForm = document.getElementById('feeSetupForm');
    if (feeSetupForm) {
        feeSetupForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const studentId = document.getElementById('modalStudentId').value;
            const admissionFee = document.getElementById('admissionFee').value;
            const monthlyFee = document.getElementById('monthlyFee').value;
            const effectiveFrom = document.getElementById('effectiveFrom').value;
            const btn = document.getElementById('btnConfirmApprove');

            btn.disabled = true;
            btn.textContent = 'Processing Approval...';

            try {
                const resApprove = await fetch(`/api/admin/students/approve/${studentId}`, { method: 'POST' });
                if (!resApprove.ok) throw new Error('Could not approve student');

                const feePayload = {
                    studentId: studentId,
                    admissionFee: admissionFee,
                    monthlyFee: monthlyFee,
                    effectiveFrom: effectiveFrom
                };

                await fetch('/api/fees/setup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(feePayload)
                });

                approveModal.hide();
                showAlert('Student application approved and fee activated successfully!', true);
                loadDashboardData();

            } catch (err) {
                showAlert(err.message || 'Operation failed', false);
            } finally {
                btn.disabled = false;
                btn.textContent = 'Confirm & Activate Admission';
            }
        });
    }

    window.openRejectModal = function(id, name) {
        document.getElementById('rejectStudentId').value = id;
        document.getElementById('rejectStudentName').textContent = name;
        document.getElementById('rejectReason').value = '';
        rejectModal.show();
    };

    const confirmRejectBtn = document.getElementById('btnConfirmReject');
    if (confirmRejectBtn) {
        confirmRejectBtn.addEventListener('click', async () => {
            const studentId = document.getElementById('rejectStudentId').value;
            const reason = document.getElementById('rejectReason').value.trim();

            if (!reason) {
                alert('Please specify a rejection reason.');
                return;
            }

            try {
                const res = await fetch(`/api/admin/students/reject/${studentId}?reason=${encodeURIComponent(reason)}`, {
                    method: 'POST'
                });

                if (res.ok) {
                    rejectModal.hide();
                    showAlert('Application rejected successfully.', true);
                    loadDashboardData();
                } else {
                    showAlert('Failed to reject application.', false);
                }
            } catch (err) {
                showAlert('Network error during rejection.', false);
            }
        });
    }

    // ========================================================
    // 6. DISCONTINUE & RE-JOIN ACTIONS
    // ========================================================
    window.openDiscontinueModal = function(id, name) {
        document.getElementById('discStudentId').value = id;
        document.getElementById('discStudentName').textContent = name;
        document.getElementById('discReason').value = '';
        discModal.show();
    };

    const confirmDiscBtn = document.getElementById('btnConfirmDiscontinue');
    if (confirmDiscBtn) {
        confirmDiscBtn.addEventListener('click', async () => {
            const id = document.getElementById('discStudentId').value;
            const reason = document.getElementById('discReason').value.trim();

            if (!reason) {
                alert('Please specify a discontinuation reason.');
                return;
            }

            try {
                const res = await fetch(`/api/admin/students/discontinue/${id}?reason=${encodeURIComponent(reason)}`, { method: 'POST' });
                if (res.ok) {
                    discModal.hide();
                    showAlert('Student marked as Discontinued.', true);
                    loadDashboardData();
                } else {
                    showAlert('Failed to update status.', false);
                }
            } catch (e) {
                showAlert('Network error occurred.', false);
            }
        });
    }

    window.rejoinStudentAction = async function(id) {
        if (!confirm('Are you sure you want to re-activate this student back to Approved classes?')) return;
        try {
            const res = await fetch(`/api/admin/students/rejoin/${id}`, { method: 'POST' });
            if (res.ok) {
                showAlert('Student re-joined and reactivated successfully!', true);
                loadDashboardData();
            } else {
                showAlert('Failed to re-activate student.', false);
            }
        } catch (e) {
            showAlert('Network error occurred.', false);
        }
    };

    // Header buttons
    const logoutBtn = document.getElementById('btnLogout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            sessionStorage.clear();
            window.location.href = '/login';
        });
    }

    const refreshBtn = document.getElementById('btnRefreshData');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', loadDashboardData);
    }

    window.printReceiptSlip = function() {
        const printContent = document.getElementById('receiptPrintArea').innerHTML;
        const printWindow = window.open('', '_blank', 'width=600,height=700');
        printWindow.document.write(`
            <html>
                <head>
                    <title>Payment Receipt</title>
                    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/bootstrap/5.3.2/css/bootstrap.min.css">
                    <style>
                        body { font-family: sans-serif; padding: 20px; }
                        .badge { border: 1px solid #000; }
                    </style>
                </head>
                <body onload="window.print();window.close();">
                    ${printContent}
                </body>
            </html>
        `);
        printWindow.document.close();
    };

    function renderPaymentAuditTrail() {
        const body = document.getElementById('paymentAuditTableBody');
        if (!body) return;

        const filter = document.getElementById('auditStatusFilter') ? document.getElementById('auditStatusFilter').value : 'ALL';

        let list = allPaymentsAuditCache || [];
        if (filter !== 'ALL') {
            list = list.filter(p => p.status === filter);
        }

        if (!list.length) {
            body.innerHTML = '<tr><td colspan="8" class="text-center py-4 text-muted">No transaction records found matching filter.</td></tr>';
            return;
        }

        body.innerHTML = list.map(p => {
            const s = studentsCache.get(Number(p.studentId));
            const sName = s ? s.name : `Student #${p.studentId}`;
            const sMobile = s ? s.mobile : '--';
            const dateStr = p.paymentDate ? p.paymentDate.replace('T', ' ').substring(0, 19) : '--';
            const receiptImg = p.screenshotPath ? resolveFileUrl(p.screenshotPath) : null;

            let statusBadge = '';
            let auditNote = '';

            if (p.status === 'APPROVED') {
                statusBadge = '<span class="badge bg-success"><i class="bi bi-check2"></i> APPROVED</span>';
                auditNote = p.collectedBy === 'ADMIN_CASH' ? '<small class="text-muted d-block">Collected at Desk (Cash)</small>' :
                            p.collectedBy === 'ADMIN_UPI' ? '<small class="text-muted d-block">Desk QR Scan</small>' :
                            '<small class="text-success fw-semibold d-block">Online Verified by Admin</small>';
            } else if (p.status === 'REJECTED') {
                statusBadge = '<span class="badge bg-danger"><i class="bi bi-x-circle"></i> REJECTED</span>';
                auditNote = `<small class="text-danger fw-bold d-block"><i class="bi bi-exclamation-triangle"></i> ${p.rejectionReason || 'Receipt Mismatch'}</small>`;
            } else {
                statusBadge = '<span class="badge bg-warning text-dark"><i class="bi bi-hourglass-split"></i> PENDING</span>';
                auditNote = '<small class="text-muted d-block">Awaiting Verification</small>';
            }

            return `
                <tr>
                    <td class="fw-bold text-secondary">#REC${p.id}</td>
                    <td class="small">${dateStr}</td>
                    <td>
                        <span class="student-link fw-bold" onclick="viewStudentDetails(${p.studentId})">${sName}</span><br>
                        <small class="text-muted">#${p.studentId} | Mob: ${sMobile}</small>
                    </td>
                    <td class="fw-bold text-dark fs-6">₹${p.amount}</td>
                    <td>
                        <span class="badge bg-light text-dark border">${p.paymentMode}</span><br>
                        <small class="text-muted fw-semibold">Ref: ${p.transactionId || '--'}</small>
                    </td>
                    <td class="small text-muted">${p.collectedBy || 'ONLINE'}</td>
                    <td>
                        ${statusBadge}
                        ${auditNote}
                    </td>
                    <td class="text-center">
                        ${receiptImg ? `
                            <a href="${receiptImg}" target="_blank" class="btn btn-sm btn-outline-dark py-0" title="View Uploaded Proof">
                                <i class="bi bi-image"></i> Proof
                            </a>
                        ` : `
                            <button class="btn btn-sm btn-outline-primary py-0" onclick="viewAuditReceiptSlip(${p.id})">
                                <i class="bi bi-printer"></i> Slip
                            </button>
                        `}
                    </td>
                </tr>
            `;
        }).join('');
    }

    const auditFilterEl = document.getElementById('auditStatusFilter');
    if (auditFilterEl) {
        auditFilterEl.onchange = renderPaymentAuditTrail;
    }

    window.viewAuditReceiptSlip = function(paymentId) {
        const p = allPaymentsAuditCache.find(x => x.id == paymentId);
        if (!p) return;
        const s = studentsCache.get(Number(p.studentId));

        document.getElementById('recId').textContent = 'REC' + p.id;
        document.getElementById('recDate').textContent = p.paymentDate ? p.paymentDate.substring(0, 10) : new Date().toLocaleDateString('en-IN');
        document.getElementById('recStudentName').textContent = s ? s.name : 'Student #' + p.studentId;
        document.getElementById('recStudentId').textContent = '#' + p.studentId;
        document.getElementById('recMobile').textContent = s ? s.mobile : '--';
        document.getElementById('recMode').textContent = p.paymentMode;
        document.getElementById('recAmount').textContent = '₹' + parseFloat(p.amount).toFixed(2);
        document.getElementById('recUtr').textContent = p.transactionId || 'OFFLINE_DESK';
        document.getElementById('recRemarks').textContent = p.remarks || (p.status === 'APPROVED' ? 'Fee Verified & Cleared' : 'Payment Cleared');

        const recModal = new bootstrap.Modal(document.getElementById('receiptModal'));
        recModal.show();
    };

    // Initial Dashboard Load
    loadDashboardData();
});
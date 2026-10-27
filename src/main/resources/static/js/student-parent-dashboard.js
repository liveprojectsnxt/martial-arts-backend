document.addEventListener('DOMContentLoaded', async () => {
    // 1. Session Check
    const loggedUser = JSON.parse(sessionStorage.getItem('loggedUser') || '{}');
    const userRole = sessionStorage.getItem('userRole');

    if (!loggedUser || !loggedUser.mobile) {
        alert('Session expired. Please login with your registered mobile.');
        window.location.href = '/login';
        return;
    }

    document.getElementById('portalUserMobile').textContent = `Mobile: +91 ${loggedUser.mobile}`;

    // DOM Elements
    const childSwitcher = document.getElementById('childSwitcherCard');
    const childSelector = document.getElementById('childSelector');
    const feeSection = document.getElementById('feeSectionContainer');
    const rejectAlert = document.getElementById('admissionRejectAlert');

    let activeStudent = null;
    let studentsList = [];
    let paymentsCache = [];

	function resolveFileUrl(fullPath) {
	    if (!fullPath) return 'https://placehold.co/150x150?text=No+File';
	    const normalized = fullPath.replace(/\\/g, '/');
	    const fileName = normalized.substring(normalized.lastIndexOf('/') + 1);
	    return `/files/${encodeURIComponent(fileName)}`;
	}

    // ==========================================
    // 2. MULTI-CHILD PROFILE LOADING
    // ==========================================
    studentsList = loggedUser.students || [];

    if (studentsList.length > 1) {
        childSwitcher.classList.remove('d-none');
        childSelector.innerHTML = studentsList.map(s => `<option value="${s.id}">${s.name} (#${s.id})</option>`).join('');

        childSelector.addEventListener('change', (e) => {
            const sel = studentsList.find(s => s.id == e.target.value);
            if (sel) loadSelectedStudent(sel.id);
        });
    }

    if (studentsList.length > 0) {
        loadSelectedStudent(studentsList[0].id);
    } else {
        alert('No registered student profiles linked with this mobile number.');
    }

	async function loadSelectedStudent(studentId) {
	        try {
	            // 1. सबसे पहले सेशन में मौजूद डेटा से तुरंत प्रोफ़ाइल दिखाएं (No Blank Screen)
	            const cachedStudent = studentsList.find(s => s.id == studentId) || loggedUser;
	            if (cachedStudent && cachedStudent.name) {
	                activeStudent = cachedStudent;
	                renderProfile(activeStudent);
	            }

	            // 2. ताज़ा डेटा के लिए API फ़ेच करें (Fallback के साथ)
	            let res = await fetch(`/api/student/details/${studentId}`);
	            if (!res.ok) {
	                // अगर /details/{id} नहीं मिला तो सीधे /{id} ट्राई करें
	                res = await fetch(`/api/student/${studentId}`);
	            }

	            if (res.ok) {
	                activeStudent = await res.json();
	                renderProfile(activeStudent);
	            } else if (!activeStudent) {
	                throw new Error('Failed to fetch details from server');
	            }

	            // 3. स्टेटस के आधार पर लेज़र लोड करें
	            if (activeStudent.status === 'APPROVED') {
	                feeSection.classList.remove('d-none');
	                rejectAlert.classList.add('d-none');
	                loadFeeLedger(activeStudent.id);
	                loadPaymentHistory(activeStudent.id);
					loadStudentAttendanceHistory(activeStudent.id);
	            } else if (activeStudent.status === 'REJECTED') {
	                feeSection.classList.add('d-none');
	                rejectAlert.classList.remove('d-none');
	                document.getElementById('rejectionReasonText').textContent = activeStudent.rejectionReason || 'Application rejected.';
	            } else {
	                feeSection.classList.add('d-none');
	                rejectAlert.classList.add('d-none');
	            }
	        } catch (e) {
	            console.error('Error loading profile:', e);
	        }
	    }

    function renderProfile(s) {
        document.getElementById('pStudentId').textContent = s.id;
        document.getElementById('pStudentName').textContent = s.name;
        document.getElementById('pFatherName').textContent = s.fatherName || 'N/A';
        document.getElementById('pAdmissionDate').textContent = s.createdAt ? s.createdAt.substring(0, 10) : 'N/A';
        document.getElementById('pAddress').textContent = s.currentAddress || 'N/A';
        document.getElementById('pStudentPhoto').src = resolveFileUrl(s.photoPath);

        const badge = document.getElementById('pStatusBadge');
        if (s.status === 'APPROVED') {
            badge.className = 'status-pill bg-success text-white';
            badge.textContent = 'Active & Approved';
        } else if (s.status === 'REJECTED') {
            badge.className = 'status-pill bg-danger text-white';
            badge.textContent = 'Application Rejected';
        } else {
            badge.className = 'status-pill bg-warning text-dark';
            badge.textContent = 'Verification Pending';
        }
    }

    // ==========================================
    // 3. FETCH MONTHLY LEDGER
    // ==========================================
    async function loadFeeLedger(studentId) {
        try {
            const res = await fetch(`/api/fees/ledger/${studentId}`);
            if (!res.ok) return;

            const ledger = await res.json();

            document.getElementById('feeMonthlyRate').textContent = `₹${ledger.monthlyFeeRate || 0}`;
            document.getElementById('feeTotalDue').textContent = `₹${ledger.netOutstanding || 0}`;
            document.getElementById('feeAdvanceAmount').textContent = `₹${ledger.advanceBalance || 0}`;
            document.getElementById('feeAdvanceCoverage').textContent = ledger.advanceCoveredUpto || 'No Advance';
            document.getElementById('feeNextDueAmount').textContent = `₹${ledger.nextDueAmount || 0}`;
            document.getElementById('feeNextDueDate').textContent = ledger.nextDueDate ? ledger.nextDueDate : 'N/A';

            const dueStatus = document.getElementById('dueStatusText');
            if (ledger.netOutstanding > 0) {
                dueStatus.textContent = 'Immediate Clearance Required';
                dueStatus.className = 'text-danger fw-bold';
            } else {
                dueStatus.textContent = 'All Clear (No Dues)';
                dueStatus.className = 'text-success fw-bold';
            }

            // Set Default Pay Modal Amount
            const defaultAmt = ledger.netOutstanding > 0 ? ledger.netOutstanding : (ledger.monthlyFeeRate || 800);
            document.getElementById('payAmount').value = defaultAmt;
            updateDynamicQr(defaultAmt);

            // Month-by-Month Statement
            const mBody = document.getElementById('monthlyLedgerBody');
            if (!ledger.monthlyStatements || !ledger.monthlyStatements.length) {
                mBody.innerHTML = '<tr><td colspan="7" class="text-center py-3 text-muted">No monthly dues generated yet.</td></tr>';
                return;
            }

            mBody.innerHTML = ledger.monthlyStatements.map(m => `
                <tr>
                    <td><strong>${m.monthName}</strong></td>
                    <td><span class="badge bg-light text-dark border">${m.feeType}</span></td>
                    <td>₹${m.totalAmount}</td>
                    <td class="text-success fw-bold">₹${m.paidAmount}</td>
                    <td class="${m.dueBalance > 0 ? 'text-danger fw-bold' : 'text-muted'}">₹${m.dueBalance}</td>
                    <td>${m.dueDate ? m.dueDate : '--'}</td>
                    <td class="text-center">
                        ${m.status === 'PAID' ? '<span class="badge bg-success">PAID</span>' :
                          m.status === 'PARTIAL' ? '<span class="badge bg-warning text-dark">PARTIAL</span>' :
                          '<span class="badge bg-danger">UNPAID</span>'}
                    </td>
                </tr>
            `).join('');

        } catch (e) {
            console.error('Ledger error:', e);
        }
    }

    // ==========================================
    // 4. LOAD PAYMENT RECEIPTS & AUDIT TRAIL
    // ==========================================
    async function loadPaymentHistory(studentId) {
        const body = document.getElementById('paymentHistoryBody');
        try {
            const res = await fetch(`/api/fees/payments/${studentId}`);
            if (!res.ok) throw new Error('Failed to load payments');

            paymentsCache = await res.json();

            if (!paymentsCache.length) {
                body.innerHTML = '<tr><td colspan="5" class="text-center py-3 text-muted">No payment records found yet.</td></tr>';
                return;
            }

            body.innerHTML = paymentsCache.map(p => {
                const dateStr = p.paymentDate ? p.paymentDate.substring(0, 10) : '--';
                const receiptUrl = resolveFileUrl(p.screenshotPath);

                if (p.status === 'REJECTED') {
                    return `
                        <tr class="table-danger border-danger">
                            <td>${dateStr}</td>
                            <td class="fw-bold text-danger">₹${p.amount}</td>
                            <td>
                                ${p.paymentMode}<br>
                                <small class="text-muted">Ref/UTR: ${p.transactionId || 'N/A'}</small><br>
                                <a href="${receiptUrl}" target="_blank" class="btn btn-sm btn-outline-danger py-0 mt-1">
                                    <i class="bi bi-image"></i> View Failed Receipt
                                </a>
                            </td>
                            <td>
                                <span class="badge bg-danger">REJECTED</span>
                                <small class="text-danger fw-bold d-block mt-1"><i class="bi bi-exclamation-circle"></i> ${p.rejectionReason || 'Receipt Mismatch'}</small>
                                <button class="btn btn-sm btn-dark fw-bold mt-2 py-1 px-3 shadow-sm" onclick="openMakePaymentModal(${p.amount})">
                                    <i class="bi bi-arrow-repeat text-warning"></i> Pay Again / Resubmit
                                </button>
                            </td>
                            <td class="text-center text-muted small">--</td>
                        </tr>
                    `;
                } else if (p.status === 'APPROVED') {
                    return `
                        <tr class="table-success">
                            <td>${dateStr}</td>
                            <td class="fw-bold text-success">₹${p.amount}</td>
                            <td>
                                ${p.paymentMode}<br>
                                <small class="text-muted">Ref/UTR: ${p.transactionId || 'N/A'}</small>
                            </td>
                            <td><span class="badge bg-success">Verified & Cleared</span></td>
                            <td class="text-center">
                                <button class="btn btn-sm btn-outline-dark fw-bold py-1 px-2" onclick="viewParentReceipt(${p.id})">
                                    <i class="bi bi-printer me-1"></i> Receipt
                                </button>
                            </td>
                        </tr>
                    `;
                } else {
                    return `
                        <tr class="table-warning">
                            <td>${dateStr}</td>
                            <td class="fw-bold text-dark">₹${p.amount}</td>
                            <td>
                                ${p.paymentMode}<br>
                                <small class="text-muted">Ref/UTR: ${p.transactionId || 'N/A'}</small>
                            </td>
                            <td><span class="badge bg-warning text-dark"><i class="bi bi-hourglass-split"></i> Under Verification</span></td>
                            <td class="text-center text-muted small">--</td>
                        </tr>
                    `;
                }
            }).join('');

        } catch (e) {
            body.innerHTML = '<tr><td colspan="5" class="text-center py-3 text-danger">Error loading payments history.</td></tr>';
        }
    }

    // ==========================================
    // 5. DYNAMIC UPI QR & MAKE PAYMENT
    // ==========================================
    const payModalElement = document.getElementById('makePaymentModal');
    const payModal = payModalElement ? new bootstrap.Modal(payModalElement) : null;
    const upiVpa = '8210007280@okbizaxis';
    const payeeName = 'The School of Martial Art';

    function updateDynamicQr(amount) {
        const amt = parseFloat(amount) || 0;
        const upiUrl = `upi://pay?pa=${upiVpa}&pn=${encodeURIComponent(payeeName)}&am=${amt}&cu=INR`;
        const qrImg = document.getElementById('dynamicQrImage');
        if (qrImg) {
            qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(upiUrl)}`;
        }
    }

    const payAmountInput = document.getElementById('payAmount');
    if (payAmountInput) {
        payAmountInput.addEventListener('input', (e) => {
            updateDynamicQr(e.target.value);
        });
    }

    window.openMakePaymentModal = function(amount) {
        if (amount) {
            document.getElementById('payAmount').value = amount;
            updateDynamicQr(amount);
        }
        document.getElementById('payUtr').value = '';
        document.getElementById('payScreenshot').value = '';
        if (payModal) payModal.show();
    };

    // Submit Payment Receipt
    document.getElementById('payForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const btn = document.getElementById('btnSubmitPayment');
        btn.disabled = true;
        btn.textContent = 'Submitting Receipt...';

        const formData = new FormData();
        formData.append('studentId', activeStudent.id);
        formData.append('amount', document.getElementById('payAmount').value);
        formData.append('mode', document.getElementById('payMode').value);
        formData.append('transactionId', document.getElementById('payUtr').value);
        formData.append('screenshot', document.getElementById('payScreenshot').files[0]);

        try {
            const res = await fetch('/api/fees/submit-payment', {
                method: 'POST',
                body: formData
            });

            const msg = await res.text();
            if (res.ok) {
                alert(msg);
                if (payModal) payModal.hide();
                document.getElementById('payForm').reset();
                loadPaymentHistory(activeStudent.id);
            } else {
                alert('Submission failed: ' + msg);
            }
        } catch (err) {
            alert('Server error occurred during payment submission.');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Submit Receipt for Verification';
        }
    });

    // ==========================================
    // 6. OFFICIAL RECEIPT SLIP PRINTING
    // ==========================================
    const pReceiptModalElement = document.getElementById('parentReceiptModal');
    const pReceiptModal = pReceiptModalElement ? new bootstrap.Modal(pReceiptModalElement) : null;

    window.viewParentReceipt = function(paymentId) {
        const p = paymentsCache.find(item => item.id == paymentId);
        if (!p || !activeStudent) return;

        document.getElementById('pRecId').textContent = 'REC' + p.id;
        document.getElementById('pRecDate').textContent = p.paymentDate ? p.paymentDate.substring(0, 10) : new Date().toLocaleDateString('en-IN');
        document.getElementById('pRecStudentName').textContent = activeStudent.name;
        document.getElementById('pRecStudentId').textContent = '#' + activeStudent.id;
        document.getElementById('pRecFather').textContent = activeStudent.fatherName || 'N/A';
        document.getElementById('pRecMode').textContent = p.paymentMode;
        document.getElementById('pRecAmount').textContent = '₹' + parseFloat(p.amount).toFixed(2);
        document.getElementById('pRecUtr').textContent = p.transactionId || 'OFFLINE_DESK';

        if (pReceiptModal) pReceiptModal.show();
    };

    window.printParentSlip = function() {
        const printContent = document.getElementById('parentReceiptPrintArea').innerHTML;
        const printWindow = window.open('', '_blank', 'width=600,height=700');
        printWindow.document.write(`
            <html>
                <head>
                    <title>Official Payment Receipt</title>
                    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/bootstrap/5.3.2/css/bootstrap.min.css">
                    <style>
                        body { font-family: sans-serif; padding: 25px; }
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

    document.getElementById('btnPortalLogout').addEventListener('click', () => {
        sessionStorage.clear();
        window.location.href = '/login';
    });
	
	
	// ==========================================
	    // STUDENT ATTENDANCE & HISTORY
	    // ==========================================
	    const studentBatchSelect = document.getElementById('studentBatchSelect');
	    const btnStudentCheckIn = document.getElementById('btnStudentCheckIn');

	    // 1. Load Batches
	    async function loadStudentBatches() {
	        try {
	            const res = await fetch('/api/attendance/batches');
	            if (res.ok) {
	                const batches = await res.json();
	                studentBatchSelect.innerHTML = batches.map(b => 
	                    `<option value="${b.id}">${b.name} (${b.startTime} - ${b.endTime})</option>`
	                ).join('');
	            }
	        } catch (e) {
	            console.error('Batch load error:', e);
	        }
	    }
	    loadStudentBatches();

	    // 2. Student Self Check-in Trigger
	    if (btnStudentCheckIn) {
	        btnStudentCheckIn.addEventListener('click', async () => {
	            if (!activeStudent || !activeStudent.id) {
	                alert('No active student profile loaded.');
	                return;
	            }
	            const batchId = studentBatchSelect.value;
	            if (!batchId) {
	                alert('Please select a batch.');
	                return;
	            }

	            btnStudentCheckIn.disabled = true;
	            btnStudentCheckIn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Submitting...';

	            try {
	                const res = await fetch(`/api/attendance/student/check-in?studentId=${activeStudent.id}&batchId=${batchId}`, {
	                    method: 'POST'
	                });
	                const data = await res.json();
	                alert(data.message);
	                loadStudentAttendanceHistory(activeStudent.id);
	            } catch (e) {
	                alert('Failed to submit check-in request.');
	            } finally {
	                btnStudentCheckIn.disabled = false;
	                btnStudentCheckIn.innerHTML = '<i class="bi bi-fingerprint"></i> Mark Today\'s Check-In';
	            }
	        });
	    }

	    // 3. Load Student Attendance History
	    async function loadStudentAttendanceHistory(studentId) {
	        const body = document.getElementById('studentAttendanceHistoryBody');
	        if (!body) return;

	        try {
	            const res = await fetch(`/api/attendance/history/${studentId}`);
	            if (!res.ok) throw new Error('Failed to fetch history');

	            const history = await res.json();
	            if (!history.length) {
	                body.innerHTML = '<tr><td colspan="5" class="text-center py-3 text-muted">No attendance logged yet.</td></tr>';
	                return;
	            }

	            body.innerHTML = history.map(h => {
	                const dateStr = h.attendanceDate || '--';
	                const timeStr = h.checkInTime ? h.checkInTime.substring(11, 16) : '--:--';
	                
	                let badge = '<span class="badge bg-warning text-dark">PENDING</span>';
	                if (h.status === 'PRESENT') badge = '<span class="badge bg-success">PRESENT</span>';
	                else if (h.status === 'LATE') badge = '<span class="badge bg-info text-dark">LATE</span>';
	                else if (h.status === 'REJECTED') badge = '<span class="badge bg-danger">REJECTED</span>';
	                else if (h.status === 'EXCUSED') badge = '<span class="badge bg-secondary">EXCUSED</span>';

	                return `
	                    <tr>
	                        <td class="fw-bold">${dateStr}</td>
	                        <td>${timeStr}</td>
	                        <td>${badge}</td>
	                        <td><small class="badge bg-light text-dark border">${h.entryMode}</small></td>
	                        <td><small class="text-muted">${h.remarks || '--'}</small></td>
	                    </tr>
	                `;
	            }).join('');

	        } catch (e) {
	            body.innerHTML = '<tr><td colspan="5" class="text-center py-3 text-danger">Error loading history.</td></tr>';
	        }
	    }

	    // loadSelectedStudentDetails() me fee ledger ke sath ise call karein:
	    // loadStudentAttendanceHistory(activeStudent.id);
});
// 1. DOMContentLoaded: जब तक पूरा HTML रेंडर न हो, JS शुरू नहीं होगी
document.addEventListener('DOMContentLoaded', () => {

    // HTML Elements को उनके ID से पकड़ना (DOM Selection) - Preserved
    const roleSelect = document.getElementById('userRole');
    const mobileInput = document.getElementById('loginMobile');
    const otpInput = document.getElementById('loginOtp');
    const btnRequestOtp = document.getElementById('btnRequestOtp');
    const btnLoginSubmit = document.getElementById('btnLoginSubmit');
    const alertBox = document.getElementById('loginAlert');
    const timerDisplay = document.getElementById('loginOtpTimer');

    let countdownTimer = null;

    // Helper Function: स्क्रीन पर Success/Error मैसेज दिखाने के लिए - Preserved
    function showNotification(message, isSuccess = false) {
        alertBox.className = `alert ${isSuccess ? 'alert-success' : 'alert-danger'} shadow-sm`;
        alertBox.textContent = message;
        alertBox.classList.remove('d-none');
    }

    // Helper Function: 3 मिनट का OTP काउंटडाउन चलाने के लिए - Preserved
    function startTimer(durationInSeconds = 180) {
        let remaining = durationInSeconds;
        btnRequestOtp.disabled = true;

        clearInterval(countdownTimer);
        countdownTimer = setInterval(() => {
            const minutes = Math.floor(remaining / 60);
            const seconds = remaining % 60;
            timerDisplay.textContent = `Resend in: ${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

            if (--remaining < 0) {
                clearInterval(countdownTimer);
                timerDisplay.textContent = '';
                btnRequestOtp.disabled = false;
                btnRequestOtp.textContent = 'Get OTP';
            }
        }, 1000);
    }

    // ==========================================
    // ACTION 1: SEND OTP (GET REQUEST) - PRESERVED & ENHANCED
    // ==========================================
	btnRequestOtp.addEventListener('click', async () => {
	    const mobile = mobileInput.value.trim();
	    const role = roleSelect.value;

	    // Validation: 10 अंकों का नंबर होना चाहिए
	    if (mobile.length !== 10 || !/^\d{10}$/.test(mobile)) {
	        showNotification('Please enter a valid 10-digit mobile number.');
	        mobileInput.focus();
	        return;
	    }

	    btnRequestOtp.disabled = true;
	    btnRequestOtp.textContent = 'Sending...';

	    try {
	        // fetch() से GET रिक्वेस्ट भेजना
	        const response = await fetch(
	            `/api/otp/send?mobile=${encodeURIComponent(mobile)}&role=${role}`
	        );

	        // JSON या plain-text backend response safely handle करें
	        const contentType = response.headers.get("content-type");

	        let message = "";
	        let generatedOtp = "";

	        if (contentType && contentType.includes("application/json")) {
	            const data = await response.json();

	            // Existing message preserve
	            message = data.message ||
	                      (data.success
	                          ? "OTP sent successfully"
	                          : "Failed to send OTP");

	            // Backend response से OTP निकालें
	            generatedOtp = data.otp || "";

	        } else {
	            // अगर backend plain text response भेजता है
	            message = await response.text();
	        }

	        if (response.ok) {

	            // OTP मिला है तो उसी success notification में दिखाएँ
	            const displayMsg = generatedOtp
	                ? `${message} | Your OTP is: [ ${generatedOtp} ]`
	                : `${message}`;

	            showNotification(displayMsg, true);

	            // OTP automatically OTP input में भी भर दें
	            if (generatedOtp) {
	                otpInput.value = generatedOtp;
	            }

	            startTimer(180);
	            otpInput.focus();

	        } else {
	            showNotification(message, false);
	            btnRequestOtp.disabled = false;
	            btnRequestOtp.textContent = 'Get OTP';
	        }

	    } catch (error) {
	        console.error('OTP request error:', error);

	        showNotification(
	            'Server connection failed. Please check backend service.',
	            false
	        );

	        btnRequestOtp.disabled = false;
	        btnRequestOtp.textContent = 'Get OTP';
	    }
	});


    // ==========================================
    // ACTION 2: VERIFY OTP & LOGIN (POST REQUEST)
    // ==========================================
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        // e.preventDefault() पेज को रीलोड होने से रोकता है
        e.preventDefault();

        const role = roleSelect.value;
        const mobile = mobileInput.value.trim();
        const otp = otpInput.value.trim();

        if (!mobile || !otp) {
            showNotification('Please provide both Mobile number and OTP.');
            return;
        }

        btnLoginSubmit.disabled = true;
        btnLoginSubmit.textContent = 'Verifying...';

        try {
            let response;
            let userData;

            // 🎯 CASE 1: PARENT LOGIN (student टेबल से लिंक सभी बच्चों को लाना)
            if (role === 'PARENT') {
                const params = new URLSearchParams();
                params.append('mobile', mobile);
                params.append('otp', otp);
                params.append('role', 'PARENT');

                // OtpController.java का /api/otp/verify-login कॉल होगा
                response = await fetch('/api/otp/verify-login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: params
                });

                if (response.ok) {
                    const resData = await response.json();
                    userData = {
                        mobile: resData.mobile,
                        students: resData.students || []
                    };
                }
            } 
            // 🎯 CASE 2: STUDENT LOGIN (Existing Student Controller Call Preserved)
            else if (role === 'STUDENT') {
                const params = new URLSearchParams();
                params.append('mobile', mobile);
                params.append('otp', otp);

                response = await fetch('/api/student/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: params
                });

                if (response.ok) {
                    userData = await response.json();
                    // सुनिश्चित करें कि अगर यह सीधा स्टूडेंट ऑब्जेक्ट है, तो mobile और id सेशन में रहे
                    if (!userData.mobile) userData.mobile = mobile;
                }
            } 
            // 🎯 CASE 3: ADMIN / STAFF LOGIN (Existing Auth Controller Call Preserved)
			// CASE 3: ADMIN / STAFF LOGIN
			else {
			    const params = new URLSearchParams();
			    params.append('mobile', mobile);
			    params.append('otp', otp);
			    params.append('role', role);

			    response = await fetch('/api/otp/verify-login', {
			        method: 'POST',
			        headers: {
			            'Content-Type': 'application/x-www-form-urlencoded'
			        },
			        credentials: 'same-origin',
			        body: params
			    });

			    if (response.ok) {
			        userData = await response.json();
			    }
			}

            if (response && response.ok && userData) {
                showNotification('Login successful! Redirecting...', true);

                // sessionStorage में यूजर का डेटा सेव करना ताकि अगले पेज पर नाम/रोल दिख सके
                sessionStorage.setItem('loggedUser', JSON.stringify(userData));
                sessionStorage.setItem('userRole', role);

                // रोल के हिसाब से सही डैशबोर्ड पर भेजना
                setTimeout(() => {
                    if (role === 'ADMIN') {
                        window.location.href = '/admin/dashboard';
                    } else if (role === 'PARENT') {
                        window.location.href = '/parent/dashboard';
                    } else {
                        window.location.href = '/student/dashboard';
                    }
                }, 1000);

            } else {
                let errorMsg = 'Invalid OTP or Login Failed';
                if (response) {
                    const contentType = response.headers.get("content-type");
                    if (contentType && contentType.includes("application/json")) {
                        const errData = await response.json();
                        errorMsg = errData.message || errorMsg;
                    } else {
                        const text = await response.text();
                        if (text) errorMsg = text;
                    }
                }
                showNotification(errorMsg, false);
                btnLoginSubmit.disabled = false;
                btnLoginSubmit.textContent = 'Verify & Login';
            }

        } catch (error) {
            showNotification('Something went wrong. Could not verify login.', false);
            btnLoginSubmit.disabled = false;
            btnLoginSubmit.textContent = 'Verify & Login';
        }
    });
});
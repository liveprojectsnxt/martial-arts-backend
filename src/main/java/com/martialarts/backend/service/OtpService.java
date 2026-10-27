package com.martialarts.backend.service;

import com.martialarts.backend.repository.AuthorizedUserRepository;
import com.martialarts.backend.repository.StudentRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class OtpService {

    @Autowired
    private AuthorizedUserRepository authorizedUserRepo;

    @Autowired
    private StudentRepository studentRepo;

    // ==========================================
    // 1. EXISTING OTP DATA MODEL (PRESERVED)
    // ==========================================
    private static class OtpData {
        private final String otp;
        private final LocalDateTime expiryTime;

        public OtpData(String otp, LocalDateTime expiryTime) {
            this.otp = otp;
            this.expiryTime = expiryTime;
        }

        public String getOtp() { return otp; }
        public LocalDateTime getExpiryTime() { return expiryTime; }
    }

    // ==========================================
    // 2. EXISTING STORAGE & LOGIC (PRESERVED)
    // ==========================================
    private final Map<String, OtpData> otpStorage = new ConcurrentHashMap<>();

    public String generateOtp(String mobile) {
        if (mobile == null || mobile.trim().isEmpty()) {
            throw new IllegalArgumentException("Mobile number is required");
        }

        String cleanMobile = mobile.trim();

        SecureRandom random = new SecureRandom();
        int num = 100000 + random.nextInt(900000);
        String otp = String.valueOf(num);

        LocalDateTime expiry = LocalDateTime.now().plusMinutes(3);

        otpStorage.put(cleanMobile, new OtpData(otp, expiry));

        return otp;
    }

    public boolean validateOtp(String mobile, String userOtp) {
        if (mobile == null || userOtp == null) {
            return false;
        }

        String cleanMobile = mobile.trim();
        String cleanOtp = userOtp.trim();

        OtpData data = otpStorage.get(cleanMobile);

        if (data == null) {
            return false;
        }

        if (LocalDateTime.now().isAfter(data.getExpiryTime())) {
            otpStorage.remove(cleanMobile, data);
            return false;
        }

        if (data.getOtp().equals(cleanOtp)) {
            otpStorage.remove(cleanMobile, data);
            return true;
        }

        return false;
    }

    // ========================================================
    // 3. EXISTING METHOD (PRESERVED - LIVE CODE SAFE)
    // ========================================================
    public boolean isAuthorizedMobile(String mobile) {
        return mobile != null && mobile.trim().length() == 10;
    }

    // ========================================================
    // 4. 🎯 NEW OVERLOADED METHOD (ROLE-BASED AUTHORIZATION)
    // ========================================================
    public boolean isAuthorizedMobile(String mobile, String role) {
        if (mobile == null || mobile.trim().length() != 10) {
            return false;
        }
        String cleanMobile = mobile.trim();

        // Admin या Staff के लिए authorized_user टेबल
        if ("ADMIN".equalsIgnoreCase(role) || "STAFF".equalsIgnoreCase(role)) {
            return authorizedUserRepo.existsByMobile(cleanMobile);
        }

        // Parent या Student के लिए सीधे student टेबल
        if ("PARENT".equalsIgnoreCase(role) || "PARENT_LOGIN".equalsIgnoreCase(role) || "STUDENT".equalsIgnoreCase(role) || "STUDENT_LOGIN".equalsIgnoreCase(role)) {
            return !studentRepo.findAllByMobile(cleanMobile).isEmpty();
        }

        // Student registration के लिए केवल 10 डिजिट नंबर पर्याप्त है
        return true;
    }
}
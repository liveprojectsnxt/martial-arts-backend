package com.martialarts.backend.controller;

import com.martialarts.backend.entity.AuthorizedUser;
import com.martialarts.backend.entity.Student;
import com.martialarts.backend.repository.AuthorizedUserRepository;
import com.martialarts.backend.repository.StudentRepository;
import com.martialarts.backend.service.OtpService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import com.martialarts.backend.security.SecurityUser;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.SecurityContextRepository;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/otp")
public class OtpController {

    @Autowired
    private OtpService otpService;

    @Autowired
    private StudentRepository studentRepo;

    @Autowired
    private AuthorizedUserRepository authorizedUserRepo;
    
    @Autowired
    private SecurityContextRepository securityContextRepository;

    // ==========================================
    // 1. SEND OTP
    // ==========================================
    @GetMapping("/send")
    public ResponseEntity<?> sendOtp(@RequestParam String mobile, @RequestParam String role) {

        if (mobile == null || !mobile.matches("^[0-9]{10}$")) {
            return ResponseEntity.badRequest().body("Invalid 10-digit mobile number!");
        }

        // 🎯 ADMIN / STAFF के लिए authorized_user टेबल
        if ("ADMIN".equalsIgnoreCase(role) || "STAFF".equalsIgnoreCase(role)) {
            if (!authorizedUserRepo.existsByMobile(mobile.trim())) {
                return ResponseEntity.badRequest().body("Unregistered Admin/Staff mobile number.");
            }
        }

        // 🎯 PARENT / STUDENT के लिए सीधे student टेबल (findAllByMobile)
        if ("PARENT".equalsIgnoreCase(role) || "PARENT_LOGIN".equalsIgnoreCase(role) || "STUDENT".equalsIgnoreCase(role)) {
            List<Student> linkedStudents = studentRepo.findAllByMobile(mobile.trim());
            if (linkedStudents.isEmpty()) {
                Map<String, Object> err = new HashMap<>();
                err.put("success", false);
                err.put("message", "This mobile number is not registered with any student profile. Please contact Academy admin.");
                return ResponseEntity.badRequest().body(err);
            }
        }

        // OTP जनरेट करना
        String otp = otpService.generateOtp(mobile);
        System.err.println("****** OTP for " + mobile + " (" + role + ") is: " + otp + " ******");

        Map<String, Object> response = new HashMap<>();
        response.put("success", true);
        response.put("message", "OTP sent successfully to " + mobile);
        response.put("otp", otp);

        return ResponseEntity.ok(response);
    }

    // ==========================================
    // 2. VERIFY LOGIN
    // ==========================================
    @PostMapping("/verify-login")
    public ResponseEntity<?> verifyLogin(@RequestParam String mobile, 
                                         @RequestParam String otp, 
                                         @RequestParam(defaultValue = "PARENT") String role,
                                         HttpServletRequest request,
                                         HttpServletResponse response) {

        if (!otpService.validateOtp(mobile, otp)) {
            Map<String, Object> err = new HashMap<>();
            err.put("success", false);
            err.put("message", "Invalid or expired OTP!");
            return ResponseEntity.badRequest().body(err);
        }

        String finalRole = role.toUpperCase();
        Long targetId = null;
        Map<String, Object> res = new HashMap<>();
        res.put("success", true);
        res.put("mobile", mobile);

        if ("ADMIN".equalsIgnoreCase(role) || "STAFF".equalsIgnoreCase(role)) {
            AuthorizedUser user = authorizedUserRepo.findByMobile(mobile.trim()).orElse(null);
            if (user == null) {
                return ResponseEntity.badRequest().body(Map.of("success", false, "message", "User not found"));
            }
            finalRole = user.getRole();
            targetId = user.getId();
            res.put("role", finalRole);
            res.put("user", user);
        } else {
            List<Student> students = studentRepo.findAllByMobile(mobile.trim());
            if (students.isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of("success", false, "message", "No student associated with this mobile"));
            }
            finalRole = "PARENT";
            targetId = students.get(0).getId();
            res.put("role", "PARENT");
            res.put("students", students);
        }

        // 🎯 Spring Security Context Session me persist karein
        SecurityUser userDetails = new SecurityUser(mobile, finalRole, targetId);
        UsernamePasswordAuthenticationToken authentication =
                new UsernamePasswordAuthenticationToken(userDetails, null, userDetails.getAuthorities());

        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication);
        SecurityContextHolder.setContext(context);
        securityContextRepository.saveContext(context, request, response);

        return ResponseEntity.ok(res);
    }
}
package com.martialarts.backend.controller;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import com.martialarts.backend.entity.AuthorizedUser;
import com.martialarts.backend.entity.ParentStudentMapping;
import com.martialarts.backend.entity.Student;
import com.martialarts.backend.repository.StudentRepository;
import com.martialarts.backend.service.OtpService;
import com.martialarts.backend.service.StudentService;

@RestController
@RequestMapping("/api/parent")
public class ParentController {

    @Autowired
    private StudentService studentService;
    
    @Autowired
    private StudentRepository studentRepo;
    
    @Autowired
    private OtpService otpService;
    
//    @PostMapping("/login")
//    public ResponseEntity<?> login(@RequestParam String mobile, @RequestParam String otp) {
//        
//        // Verify OTP
//        if (!otpService.validateOtp(mobile, otp)) {
//            return ResponseEntity.badRequest().body("Invalid or Expired OTP!");
//        }
//        
//        // Get parent details
//        AuthorizedUser parent = studentService.parentLogin(mobile);
//        
//        // Get all students for this parent
//        List<ParentStudentMapping> mappings = studentService.getStudentsByParentMobile(mobile);
//        
//        List<Map<String, Object>> students = mappings.stream().map(mapping -> {
//            Student s = studentRepo.findById(mapping.getStudentId()).orElse(null);
//            Map<String, Object> studentMap = new HashMap<>();
//            studentMap.put("id", mapping.getStudentId());
//            studentMap.put("name", mapping.getStudentName());
//            studentMap.put("status", mapping.getStudentStatus());
//            if (s != null) {
//                studentMap.put("photoPath", s.getPhotoPath());
//                studentMap.put("admissionDate", s.getCreatedAt());
//            }
//            return studentMap;
//        }).collect(Collectors.toList());
//        
//        Map<String, Object> response = new HashMap<>();
//        response.put("parent", parent);
//        response.put("students", students);
//        
//        return ResponseEntity.ok(response);
//    }
}
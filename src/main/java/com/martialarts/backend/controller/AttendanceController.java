package com.martialarts.backend.controller;

import com.martialarts.backend.entity.Attendance;
import com.martialarts.backend.repository.AttendanceRepository;
import com.martialarts.backend.repository.BatchRepository;
import com.martialarts.backend.service.AttendanceService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/attendance")
public class AttendanceController {

    @Autowired
    private AttendanceService attendanceService;
    
    @Autowired
    private BatchRepository batchRepo;
    
    @Autowired
    private AttendanceRepository attendanceRepo;

    // ================= 1. STUDENT SELF CHECK-IN =================
    @PostMapping("/student/check-in")
    public ResponseEntity<?> studentCheckIn(@RequestParam Long studentId, @RequestParam Long batchId) {
        try {
            Attendance att = attendanceService.studentCheckIn(studentId, batchId);
            return ResponseEntity.ok(Map.of(
                "success", true,
                "message", "Check-in submitted successfully. Awaiting teacher verification.",
                "attendanceId", att.getId()
            ));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", e.getMessage()));
        }
    }

    // ================= 2. TEACHER ROSTER & REVIEW =================
    @GetMapping("/teacher/roster")
    @PreAuthorize("hasAnyRole('ADMIN', 'STAFF')")
    public ResponseEntity<?> getBatchRoster(
            @RequestParam Long batchId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        List<Attendance> roster = attendanceService.getRoster(batchId, date);
        return ResponseEntity.ok(roster);
    }

    @PostMapping("/teacher/review/{attendanceId}")
    @PreAuthorize("hasAnyRole('ADMIN', 'STAFF')")
    public ResponseEntity<?> reviewAttendance(
            @PathVariable Long attendanceId,
            @RequestParam String status,
            @RequestParam(required = false) String remarks,
            @RequestParam(required = false) String correctedCheckIn,
            Authentication auth) {
        try {
            LocalTime correctedTime = (correctedCheckIn != null && !correctedCheckIn.isBlank()) 
                    ? LocalTime.parse(correctedCheckIn) : null;

            Attendance att = attendanceService.reviewAttendance(
                    attendanceId, status, remarks, correctedTime, auth.getName());

            return ResponseEntity.ok(Map.of("success", true, "message", "Attendance reviewed successfully", "status", att.getStatus()));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", e.getMessage()));
        }
    }

    // ================= 3. TEACHER MANUAL MARK (REALTIME / RETROSPECTIVE) =================
    @PostMapping("/teacher/manual-mark")
    @PreAuthorize("hasAnyRole('ADMIN', 'STAFF')")
    public ResponseEntity<?> teacherManualMark(
            @RequestParam Long studentId,
            @RequestParam Long batchId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate targetDate,
            @RequestParam String status,
            @RequestParam(required = false) String checkIn,
            @RequestParam(required = false) String checkOut,
            @RequestParam(required = false) String reason,
            Authentication auth) {
        try {
            LocalTime inTime = (checkIn != null && !checkIn.isBlank()) ? LocalTime.parse(checkIn) : null;
            LocalTime outTime = (checkOut != null && !checkOut.isBlank()) ? LocalTime.parse(checkOut) : null;

            Attendance att = attendanceService.teacherManualMark(
                    studentId, batchId, targetDate, status, inTime, outTime, reason, auth.getName());

            return ResponseEntity.ok(Map.of("success", true, "message", "Manual attendance recorded", "attendanceId", att.getId()));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", e.getMessage()));
        }
    }
    
 // 🎯 1. सक्रिय बैचों की सूची (Student Dropdown + Teacher Dropdown)
    @GetMapping("/batches")
    public ResponseEntity<?> getAllBatches() {
        return ResponseEntity.ok(batchRepo.findByIsActiveTrue());
    }

    // 🎯 2. किसी छात्र की पूरी अटेंडेंस हिस्ट्री (Student Portal + Teacher Audit)
    @GetMapping("/history/{studentId}")
    public ResponseEntity<?> getStudentHistory(@PathVariable Long studentId) {
        return ResponseEntity.ok(attendanceRepo.findByStudentIdOrderByAttendanceDateDesc(studentId));
    }
}
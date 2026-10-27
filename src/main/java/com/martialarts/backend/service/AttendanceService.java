package com.martialarts.backend.service;

import com.martialarts.backend.entity.Attendance;
import com.martialarts.backend.entity.Batch;
import com.martialarts.backend.entity.Student;
import com.martialarts.backend.repository.AttendanceRepository;
import com.martialarts.backend.repository.BatchRepository;
import com.martialarts.backend.repository.StudentRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;

@Service
public class AttendanceService {

    @Autowired
    private AttendanceRepository attendanceRepo;

    @Autowired
    private StudentRepository studentRepo;

    @Autowired
    private BatchRepository batchRepo;

    // 🎯 1. STUDENT INITIATED CHECK-IN
    @Transactional
    public Attendance studentCheckIn(Long studentId, Long batchId) {
        LocalDate today = LocalDate.now();
        LocalDateTime now = LocalDateTime.now();

        // Validate Student
        Student student = studentRepo.findById(studentId)
                .orElseThrow(() -> new RuntimeException("Student not found"));

        if (!"APPROVED".equalsIgnoreCase(student.getStatus())) {
            throw new RuntimeException("Student admission is not Active/Approved");
        }

        // Validate Batch
        Batch batch = batchRepo.findById(batchId)
                .orElseThrow(() -> new RuntimeException("Batch not found"));

        // Duplicate Check
        if (attendanceRepo.findByStudentIdAndBatchIdAndAttendanceDate(studentId, batchId, today).isPresent()) {
            throw new RuntimeException("Attendance request already submitted for today's batch!");
        }

        Attendance att = new Attendance();
        att.setStudentId(studentId);
        att.setBatchId(batchId);
        att.setAttendanceDate(today);
        att.setCheckInTime(now);
        att.setStatus("PENDING");
        att.setEntryMode("STUDENT_CHECKIN");
        att.setCreatedAt(now);

        return attendanceRepo.save(att);
    }

    // 🎯 2. TEACHER REVIEW (APPROVE / REJECT / MARK LATE / TIME CORRECTION)
    @Transactional
    public Attendance reviewAttendance(Long attendanceId, String status, String remarks, 
                                       LocalTime correctedCheckIn, String teacherMobile) {
        Attendance att = attendanceRepo.findById(attendanceId)
                .orElseThrow(() -> new RuntimeException("Attendance record not found"));

        att.setStatus(status); // 'PRESENT', 'LATE', 'REJECTED', 'EXCUSED'
        att.setReviewedBy(teacherMobile);
        att.setReviewedAt(LocalDateTime.now());
        att.setRemarks(remarks);

        if (correctedCheckIn != null) {
            att.setCheckInTime(LocalDateTime.of(att.getAttendanceDate(), correctedCheckIn));
        }

        return attendanceRepo.save(att);
    }

    // 🎯 3. TEACHER MANUAL ATTENDANCE (REALTIME YA RETROSPECTIVE / GHAR SE)
    @Transactional
    public Attendance teacherManualMark(Long studentId, Long batchId, LocalDate targetDate,
                                       String status, LocalTime checkInTime, LocalTime checkOutTime, 
                                       String reason, String teacherMobile) {

        if (targetDate.isAfter(LocalDate.now())) {
            throw new RuntimeException("Cannot mark future attendance!");
        }

        Attendance att = attendanceRepo.findByStudentIdAndBatchIdAndAttendanceDate(studentId, batchId, targetDate)
                .orElse(new Attendance());

        boolean isRetro = targetDate.isBefore(LocalDate.now());

        att.setStudentId(studentId);
        att.setBatchId(batchId);
        att.setAttendanceDate(targetDate);
        att.setStatus(status);
        att.setReviewedBy(teacherMobile);
        att.setReviewedAt(LocalDateTime.now());
        att.setEntryMode(isRetro ? "TEACHER_RETRO" : "TEACHER_REALTIME");

        if (checkInTime != null) {
            att.setCheckInTime(LocalDateTime.of(targetDate, checkInTime));
        }
        if (checkOutTime != null) {
            att.setCheckOutTime(LocalDateTime.of(targetDate, checkOutTime));
        }

        String auditNote = (isRetro ? "[RETROSPECTIVE ENTRY] " : "[MANUAL ENTRY] ") + (reason != null ? reason : "");
        att.setRemarks(auditNote);

        return attendanceRepo.save(att);
    }

    // 🎯 4. FETCH ROSTER FOR TEACHER VERIFICATION
    public List<Attendance> getRoster(Long batchId, LocalDate date) {
        return attendanceRepo.findByBatchIdAndAttendanceDate(batchId, date);
    }
}
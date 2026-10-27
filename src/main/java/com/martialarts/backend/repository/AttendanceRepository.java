package com.martialarts.backend.repository;

import com.martialarts.backend.entity.Attendance;
import org.springframework.data.jpa.repository.JpaRepository;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

public interface AttendanceRepository extends JpaRepository<Attendance, Long> {

    Optional<Attendance> findByStudentIdAndBatchIdAndAttendanceDate(Long studentId, Long batchId, LocalDate attendanceDate);

    List<Attendance> findByBatchIdAndAttendanceDate(Long batchId, LocalDate attendanceDate);

    List<Attendance> findByBatchIdAndAttendanceDateAndStatus(Long batchId, LocalDate attendanceDate, String status);

    List<Attendance> findByStudentIdOrderByAttendanceDateDesc(Long studentId);
}
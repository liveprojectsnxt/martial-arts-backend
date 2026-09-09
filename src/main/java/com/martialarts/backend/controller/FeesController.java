package com.martialarts.backend.controller;

import com.martialarts.backend.dto.FeeLedgerDTO;
import com.martialarts.backend.dto.PaymentRequestDTO;
import com.martialarts.backend.entity.Payment;
import com.martialarts.backend.entity.Student;
import com.martialarts.backend.repository.PaymentRepository;
import com.martialarts.backend.repository.StudentRepository;
import com.martialarts.backend.service.FeesService;
import com.martialarts.backend.service.FileStorageService;

import java.io.File;
import java.io.FileOutputStream;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/fees")
public class FeesController {
	
	@Value("${file.upload-dir}")
    private String uploadDir;

    @Autowired
    private FeesService service;
    
    @Autowired
    private PaymentRepository paymentRepo;

    @Autowired
    private StudentRepository studentRepo;
    
    @Autowired
    private FileStorageService fileStorageService; 	

    // ================= UTILITY METHOD (Preserved) =================
    private LocalDate parseDate(String input) {

        if (input == null || input.isEmpty()) {
            throw new RuntimeException("effectiveFrom is required");
        }

        try {
            // Format: 2026-07-01 OR 2026-7-1
            return LocalDate.parse(input, DateTimeFormatter.ofPattern("yyyy-M-d"));
        } catch (Exception e1) {
            try {
                // Format: 01-07-2026
                return LocalDate.parse(input, DateTimeFormatter.ofPattern("dd-MM-yyyy"));
            } catch (Exception e2) {
                // Format: ISO datetime 2026-05-02T10:15:30
                return LocalDate.parse(input.substring(0, 10));
            }
        }
    }

    // ================= SETUP (Preserved) =================
    @PostMapping("/setup")
    public String setup(@RequestBody Map<String, Object> body) {

        LocalDate effectiveDate = parseDate(body.get("effectiveFrom").toString());

        service.setupFees(
                Long.valueOf(body.get("studentId").toString()),
                Double.parseDouble(body.get("monthlyFee").toString()),
                Double.parseDouble(body.get("admissionFee").toString()),
                effectiveDate
        );

        return "Setup Done";
    }

    // ================= UPDATE MONTHLY (Preserved) =================
    @PostMapping("/update-monthly")
    public String updateMonthly(@RequestBody Map<String, Object> body) {

        service.updateMonthlyFrom(
                Long.valueOf(body.get("studentId").toString()),
                Integer.parseInt(body.get("fromMonth").toString()),
                Integer.parseInt(body.get("year").toString()),
                Double.parseDouble(body.get("amount").toString())
        );

        return "Updated";
    }

    // ================= PAYMENT (Preserved) =================
    @PostMapping("/pay")
    public String pay(@RequestBody PaymentRequestDTO req) {

        if (req.getStudentId() == null ||
            req.getAmount() == null ||
            req.getMode() == null) {
            throw new RuntimeException("Missing required fields");
        }

        service.makePayment(
                req.getStudentId(),
                req.getAmount(),
                req.getMode(),
                req.getTransactionId(),
                req.getLateFee() != null ? req.getLateFee() : 0
        );

        return "Payment Successful";
    }

    // ================= SUMMARY (Preserved) =================
    @GetMapping("/summary/{studentId}")
    public Map<String, Object> summary(@PathVariable Long studentId) {
        return service.getSummary(studentId);
    }

    // ================= UPDATE FEE STRUCTURE (Preserved) =================
    @PostMapping("/update-fee-structure")
    public String updateFeeStructure(@RequestBody Map<String, Object> body) {

        Long studentId = Long.valueOf(body.get("studentId").toString());
        double newMonthlyFee = Double.parseDouble(body.get("monthlyFee").toString());

        LocalDate effectiveDate = parseDate(body.get("effectiveFrom").toString());

        service.updateMonthlyFeeWithEffectiveDate(
                studentId,
                effectiveDate,
                newMonthlyFee
        );

        return "Fee structure updated successfully from " + effectiveDate;
    }

    // ================= COMPREHENSIVE LEDGER (Preserved) =================
    @GetMapping("/ledger/{studentId}")
    public ResponseEntity<?> getComprehensiveLedger(@PathVariable Long studentId) {
        FeeLedgerDTO ledger = service.getComprehensiveLedger(studentId);
        return ResponseEntity.ok(ledger);
    }

    // ================= ADMIN DESK FEE COLLECTION (Preserved) =================
    @PostMapping("/admin-collect-fee")
    public ResponseEntity<?> adminCollectFee(
            @RequestParam("studentId") Long studentId,
            @RequestParam("amount") Double amount,
            @RequestParam("mode") String mode,
            @RequestParam(value = "transactionId", required = false) String transactionId,
            @RequestParam(value = "remarks", required = false) String remarks) {

        try {
            if (amount == null || amount <= 0) {
                return ResponseEntity.badRequest().body("Please enter a valid payment amount greater than 0.");
            }

            Payment p = new Payment();
            p.setStudentId(studentId);
            p.setAmount(amount);
            p.setPaymentMode(mode);
            p.setTransactionId(transactionId != null && !transactionId.trim().isEmpty() 
                    ? transactionId.trim() 
                    : "DESK_" + mode + "_" + System.currentTimeMillis());
            p.setRemarks(remarks);
            p.setPaymentDate(LocalDateTime.now());
            p.setStatus("APPROVED"); // एडमिन ने खुद लिया है, इसलिए तुरंत Approved
            p.setCollectedBy("ADMIN_" + mode);

            paymentRepo.save(p);

            // लेजर सेटलमेंट चलाएं
            service.processPaymentSettlement(p);

            // 🔔 Console notification for desk payment
            System.err.println("===============================================================================");
            System.err.println("💵 [DESK PAYMENT COLLECTED BY ADMIN] Student ID: #" + studentId);
            System.err.println("   Amount: ₹" + amount + " | Mode: " + mode + " | Ref: " + p.getTransactionId());
            System.err.println("   Time: " + LocalDateTime.now() + " | Status: APPROVED & SETTLED");
            System.err.println("===============================================================================");

            return ResponseEntity.ok("Fee of ₹" + amount + " collected successfully! Ledger updated.");
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body("Collection failed: " + e.getMessage());
        }
    }

  
    @PostMapping("/submit-payment")
    public ResponseEntity<?> submitPayment(
            @RequestParam("studentId") Long studentId,
            @RequestParam("amount") Double amount,
            @RequestParam("mode") String mode,
            @RequestParam("transactionId") String transactionId,
            @RequestParam(value = "screenshot", required = false) MultipartFile screenshot) {

        try {
            Student student = studentRepo.findById(studentId)
                    .orElseThrow(() -> new RuntimeException("Student not found"));

            Payment p = new Payment();
            p.setStudentId(studentId);
            p.setAmount(amount);
            p.setPaymentMode(mode != null ? mode : "UPI");
            p.setTransactionId(transactionId != null ? transactionId.trim() : "ONLINE_" + System.currentTimeMillis());
            p.setPaymentDate(LocalDateTime.now());
            p.setStatus("PENDING");
            p.setCollectedBy("STUDENT_ONLINE");

            // 🎯 File Validation & Save
            if (screenshot != null && !screenshot.isEmpty()) {
                boolean isPdf = screenshot.getContentType() != null && screenshot.getContentType().contains("pdf");
                fileStorageService.validateFile(screenshot, isPdf ? "PDF" : "IMAGE");
                
                String savedPath = fileStorageService.storeFile(screenshot, "receipt");
                p.setScreenshotPath(savedPath);
            }

            paymentRepo.save(p);

            System.err.println("📢 [NEW ONLINE PAYMENT SUBMITTED] Student: " + student.getName() + " (#" + studentId + ") | Amount: ₹" + amount);

            return ResponseEntity.ok("Payment receipt submitted successfully! Admin will verify and clear your fee dues.");
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(e.getMessage());
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body("Failed: " + e.getMessage());
        }
    }
    // ================= 🎯 NEW: GET PAYMENTS LIST FOR STUDENT =================
    @GetMapping("/payments/{studentId}")
    public ResponseEntity<?> getStudentPayments(@PathVariable Long studentId) {
        List<Payment> list = paymentRepo.findByStudentIdOrderByPaymentDateDesc(studentId);
        return ResponseEntity.ok(list);
    }

    // ================= 🎯 NEW: ADMIN APPROVE ONLINE PAYMENT =================
    @PostMapping("/approve-payment/{paymentId}")
    public ResponseEntity<?> approveOnlinePayment(@PathVariable Long paymentId) {
        try {
            Payment p = paymentRepo.findById(paymentId)
                    .orElseThrow(() -> new RuntimeException("Payment not found"));

            p.setStatus("APPROVED");
            p.setPaymentDate(LocalDateTime.now());
            paymentRepo.save(p);

            // लेजर सेटलमेंट चलाएं
            service.processPaymentSettlement(p);

            Student s = studentRepo.findById(p.getStudentId()).orElse(null);
            String studentName = s != null ? s.getName() : "Student #" + p.getStudentId();

            // 🔔 CONSOLE INTIMATION ON PAYMENT APPROVAL
            System.err.println("===============================================================================");
            System.err.println("✅ [PAYMENT APPROVED & LEDGER SETTLED] Payment ID: #" + paymentId);
            System.err.println("   Student: " + studentName + " | Amount: ₹" + p.getAmount() + " | Mode: " + p.getPaymentMode());
            System.err.println("   UTR: " + p.getTransactionId() + " | Approved At: " + LocalDateTime.now());
            System.err.println("===============================================================================");

            return ResponseEntity.ok("Payment approved and student ledger settled successfully!");
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body("Error approving payment: " + e.getMessage());
        }
    }
    
    
 // ================= 🎯 1. GET ALL PENDING ONLINE PAYMENTS FOR ADMIN =================
    @GetMapping("/pending-payments")
    public ResponseEntity<?> getPendingPayments() {
        // केवल वही पेमेंट्स जिनका स्टेटस PENDING है
        List<Payment> list = paymentRepo.findByStatusOrderByPaymentDateDesc("PENDING");
        return ResponseEntity.ok(list);
    }

    // ================= 🎯 2. ADMIN REJECT ONLINE PAYMENT WITH REASON =================
    @PostMapping("/reject-payment/{paymentId}")
    public ResponseEntity<?> rejectOnlinePayment(
            @PathVariable Long paymentId,
            @RequestParam("reason") String reason) {
        try {
            Payment p = paymentRepo.findById(paymentId)
                    .orElseThrow(() -> new RuntimeException("Payment not found"));

            p.setStatus("REJECTED");
            p.setRejectionReason(reason);
            p.setPaymentDate(LocalDateTime.now());
            paymentRepo.save(p);

            Student s = studentRepo.findById(p.getStudentId()).orElse(null);
            String studentName = s != null ? s.getName() : "Student #" + p.getStudentId();

            // 🔔 CONSOLE INTIMATION ON PAYMENT REJECTION
            System.err.println("===============================================================================");
            System.err.println("❌ [PAYMENT REJECTED BY ADMIN] Payment ID: #" + paymentId);
            System.err.println("   Student: " + studentName + " | Amount: ₹" + p.getAmount() + " | Mode: " + p.getPaymentMode());
            System.err.println("   Reason for Rejection: " + reason);
            System.err.println("   Time: " + LocalDateTime.now());
            System.err.println("===============================================================================");

            return ResponseEntity.ok("Payment receipt rejected. Reason recorded.");
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body("Error rejecting payment: " + e.getMessage());
        }
    }
    
 // ================= 🎯 3. GET ALL PAYMENTS TRAIL FOR ADMIN AUDIT =================
    @GetMapping("/all-payments-history")
    public ResponseEntity<?> getAllPaymentsHistory() {
        // सारे पेमेंट्स को पेमेंट डेट के घटते क्रम (Latest First) में निकालें
        List<Payment> allPayments = paymentRepo.findAll();
        allPayments.sort((a, b) -> {
            if (a.getPaymentDate() == null || b.getPaymentDate() == null) return 0;
            return b.getPaymentDate().compareTo(a.getPaymentDate());
        });
        return ResponseEntity.ok(allPayments);
    }
}
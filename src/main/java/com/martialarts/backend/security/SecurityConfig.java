package com.martialarts.backend.security;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.config.annotation.authentication.configuration.AuthenticationConfiguration;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.context.SecurityContextRepository;

@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class SecurityConfig {

    @Bean
    public SecurityContextRepository securityContextRepository() {
        return new HttpSessionSecurityContextRepository();
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable()) // Production REST/AJAX setup ke liye
            .authorizeHttpRequests(auth -> auth
                // 1. Static Assets & File Downloads
                .requestMatchers("/css/**", "/js/**", "/images/**", "/files/**").permitAll()
                
                // 2. Public Pages & Registration
                .requestMatchers("/", "/login", "/register-student").permitAll()
                
                // 3. OTP & Public APIs
                .requestMatchers("/api/otp/**", "/api/student/register").permitAll()

                // 4. Role-based Route Protection
                .requestMatchers("/admin/**", "/api/admin/**").hasRole("ADMIN")
                .requestMatchers("/api/fees/admin-collect-fee", "/api/fees/approve-payment/**", "/api/fees/reject-payment/**").hasRole("ADMIN")
                
                // Teacher / Staff Routes
                .requestMatchers("/api/attendance/teacher/**").hasAnyRole("ADMIN", "STAFF")
                
                // Student & Parent Routes
                .requestMatchers("/student/**", "/parent/**", "/api/fees/submit-payment").hasAnyRole("ADMIN", "PARENT", "STUDENT")
                
                .requestMatchers("/api/otp/**","/api/student/register","/api/student/login").permitAll()
                .requestMatchers("/api/otp/**", "/api/student/register").permitAll()
                // Any other request must be authenticated
                .anyRequest().authenticated()
            )
            .logout(logout -> logout
                .logoutUrl("/api/auth/logout")
                .logoutSuccessHandler((request, response, authentication) -> {
                    response.setStatus(HttpServletResponse.SC_OK);
                    response.getWriter().write("{\"success\":true,\"message\":\"Logged out successfully\"}");
                })
                .invalidateHttpSession(true)
                .deleteCookies("JSESSIONID")
                .permitAll()
            );

        return http.build();
    }

    @Bean
    public AuthenticationManager authenticationManager(AuthenticationConfiguration config) throws Exception {
        return config.getAuthenticationManager();
    }
}
package com.martialarts.backend.security;


import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

import java.util.Collection;
import java.util.List;

public class SecurityUser implements UserDetails {

    private final String username; // mobile number
    private final String role;
    private final Long userId; // studentId or authorizedUserId

    public SecurityUser(String mobile, String role, Long userId) {
        this.username = mobile;
        this.role = role.startsWith("ROLE_") ? role : "ROLE_" + role;
        this.userId = userId;
    }

    public Long getUserId() {
        return userId;
    }

    public String getRawRole() {
        return role.replace("ROLE_", "");
    }

    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() {
        return List.of(new SimpleGrantedAuthority(role));
    }

    @Override public String getPassword() { return ""; }
    @Override public String getUsername() { return username; }
    @Override public boolean isAccountNonExpired() { return true; }
    @Override public boolean isAccountNonLocked() { return true; }
    @Override public boolean isCredentialsNonExpired() { return true; }
    @Override public boolean isEnabled() { return true; }
}
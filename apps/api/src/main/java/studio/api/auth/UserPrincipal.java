package studio.api.auth;

public record UserPrincipal(String id, String username, String role, boolean mustChangePassword) {}

package studio.api.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.crypto.password.Pbkdf2PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.web.filter.OncePerRequestFilter;
import studio.api.common.ApiErrors;
import studio.api.common.ApiException;
import java.io.IOException;
import java.util.List;

@Configuration
public class AuthSecurity {
    @Bean PasswordEncoder passwordEncoder(){return Pbkdf2PasswordEncoder.defaultsForSpringSecurity_v5_8();}
    @Bean CookieCsrfTokenRepository csrfTokenRepository(@org.springframework.beans.factory.annotation.Value("${studio.cookie-secure:false}") boolean secure){CookieCsrfTokenRepository r=CookieCsrfTokenRepository.withHttpOnlyFalse();r.setCookiePath("/");r.setCookieCustomizer(c->c.secure(secure).sameSite("Lax"));return r;}
    @Bean SecurityFilterChain security(HttpSecurity http, AuthService auth, CookieCsrfTokenRepository csrf) throws Exception {
        http.csrf(c->c.csrfTokenRepository(csrf).csrfTokenRequestHandler(new org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler()));
        http.sessionManagement(s->s.sessionCreationPolicy(SessionCreationPolicy.STATELESS));
        http.addFilterBefore(new SessionFilter(auth), UsernamePasswordAuthenticationFilter.class);
        http.authorizeHttpRequests(a->a.requestMatchers("/api/auth/session","/api/auth/register","/api/auth/login","/api/health","/health").permitAll()
            .requestMatchers("/api/admin/**").hasRole("ADMIN").anyRequest().authenticated());
        http.exceptionHandling(e->e.authenticationEntryPoint((req,res,ex)->writeError(res,new ApiException("AUTH","请登录后继续。",401,false)))
            .accessDeniedHandler((req,res,ex)->writeError(res,new ApiException("AUTH","无权执行此操作。",403,false))));
        http.logout(l->l.disable());
        return http.build();
    }
    private static void writeError(HttpServletResponse response,ApiException ex)throws IOException{response.setStatus(ex.status());response.setContentType("application/json;charset=UTF-8");response.getWriter().write(new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(java.util.Map.of("error",ApiErrors.error(ex))));}
    static class SessionFilter extends OncePerRequestFilter {
        private final AuthService auth; SessionFilter(AuthService auth){this.auth=auth;}
        @Override protected void doFilterInternal(HttpServletRequest req,HttpServletResponse res,FilterChain chain)throws ServletException,IOException{
            if(req.getCookies()!=null)for(Cookie c:req.getCookies())if(c.getName().equals("STUDIO_SESSION")){UserPrincipal p=auth.session(c.getValue());if(p!=null){var token=new UsernamePasswordAuthenticationToken(p,null,List.of(new SimpleGrantedAuthority("ROLE_"+p.role())));org.springframework.security.core.context.SecurityContextHolder.getContext().setAuthentication(token);}break;}
            String path=req.getRequestURI();
            var current=org.springframework.security.core.context.SecurityContextHolder.getContext().getAuthentication();
            if(current!=null&&current.getPrincipal() instanceof UserPrincipal p&&p.mustChangePassword()
                    && !(path.endsWith("/auth/session")||path.endsWith("/auth/password")||path.endsWith("/auth/logout"))){
                writeError(res,new ApiException("AUTH","必须先修改密码。",403,false));return;
            }
            chain.doFilter(req,res);
        }
    }
}

package studio.api.auth;

import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.security.core.context.SecurityContextHolder;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(AuthController.class)
@AutoConfigureMockMvc
@Import(AuthSecurity.class)
class AuthSecurityMvcTest {
    @Autowired MockMvc mvc;
    @MockBean AuthService auth;

    @AfterEach void clearSecurityContext(){SecurityContextHolder.clearContext();}

    @Test void sessionIssuesReadableCsrfCookieAndHeaderAllowsLogin() throws Exception {
        MvcResult get=mvc.perform(get("/api/auth/session"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.user").value(org.hamcrest.Matchers.nullValue())).andReturn();
        String xsrf=cookie(get.getResponse(),"XSRF-TOKEN");
        when(auth.login("alice","a-long-password",null)).thenReturn(new AuthService.AuthResult(new UserPrincipal("u1","alice","USER",false),"opaque-session"));
        mvc.perform(post("/api/auth/login").cookie(new Cookie("XSRF-TOKEN",xsrf)).header("X-XSRF-TOKEN",xsrf)
                        .contentType("application/json").content("{\"username\":\"alice\",\"password\":\"a-long-password\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.user.role").value("USER"));
    }

    @Test void loginWithoutCsrfHeaderIsRejected() throws Exception {
        MvcResult get=mvc.perform(get("/api/auth/session")).andExpect(status().isOk()).andReturn();
        String xsrf=cookie(get.getResponse(),"XSRF-TOKEN");
        mvc.perform(post("/api/auth/login").cookie(new Cookie("XSRF-TOKEN",xsrf))
                        .contentType("application/json").content("{\"username\":\"alice\",\"password\":\"a-long-password\"}"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.error.code").value("AUTH"));
        verify(auth,never()).login(anyString(),anyString(),any());
        verify(auth,never()).register(anyString(),anyString(),anyString());
    }

    @Test void registrationAlsoRequiresCsrfHeader() throws Exception {
        MvcResult get=mvc.perform(get("/api/auth/session")).andExpect(status().isOk()).andReturn();
        String xsrf=cookie(get.getResponse(),"XSRF-TOKEN");
        when(auth.register("alice","a-long-password","invite")).thenReturn(new AuthService.AuthResult(new UserPrincipal("u1","alice","USER",false),"opaque-session"));
        mvc.perform(post("/api/auth/register").cookie(new Cookie("XSRF-TOKEN",xsrf)).header("X-XSRF-TOKEN",xsrf)
                        .contentType("application/json").content("{\"username\":\"alice\",\"password\":\"a-long-password\",\"inviteCode\":\"invite\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.user.id").value("u1"));
    }
    private String cookie(MockHttpServletResponse response,String name){
        for(String header:response.getHeaders("Set-Cookie"))if(header.startsWith(name+"="))return header.substring(name.length()+1,header.indexOf(';'));
        throw new AssertionError("Missing "+name+" cookie");
    }
}

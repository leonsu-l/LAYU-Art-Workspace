package studio.api.auth;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.*;
import studio.api.common.ApiException;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class AuthController {
    private final AuthService auth; private final boolean secure;
    public AuthController(AuthService auth,@Value("${studio.cookie-secure:false}") boolean secure){this.auth=auth;this.secure=secure;}
    @GetMapping("/auth/session") public Map<String,Object> session(HttpServletRequest request,CsrfToken csrf){csrf.getToken();var p=auth.session(cookie(request));var result=new java.util.HashMap<String,Object>();result.put("user",p==null?null:new AuthService.Account(p.id(),p.username(),p.role(),p.mustChangePassword()));return result;}
    @PostMapping("/auth/register") public Map<String,Object> register(@RequestBody JsonNode body,HttpServletResponse response){var result=auth.register(text(body,"username",64),text(body,"password",1024),text(body,"inviteCode",128));setCookie(response,result.token());return Map.of("user",account(result.user()));}
    @PostMapping("/auth/login") public Map<String,Object> login(@RequestBody JsonNode body,HttpServletRequest request,HttpServletResponse response){var result=auth.login(text(body,"username",64),text(body,"password",1024),cookie(request));setCookie(response,result.token());return Map.of("user",account(result.user()));}
    @PostMapping("/auth/logout") public Map<String,Object> logout(HttpServletRequest req,HttpServletResponse res){auth.logout(cookie(req));clearCookie(res);return Map.of("ok",true);}
    @PostMapping("/auth/password") public Map<String,Object> password(@RequestBody JsonNode b,HttpServletRequest req,HttpServletResponse res){var p=auth.requireUser();auth.changePassword(p,text(b,"currentPassword",1024),text(b,"newPassword",1024));clearCookie(res);return Map.of("ok",true);}
    @GetMapping("/admin/users") public Map<String,Object> users(){return Map.of("users",auth.users());}
    @PatchMapping("/admin/users/{id}") public Map<String,Object> update(@PathVariable String id,@RequestBody JsonNode b){Boolean enabled=b.has("enabled")&&!b.get("enabled").isNull()?bool(b.get("enabled")):null;boolean hasLimit=b.has("dailyLimit");Integer limit=hasLimit&&!b.get("dailyLimit").isNull()?intValue(b.get("dailyLimit")):null;return Map.of("user",auth.updateUser(id,enabled,limit,hasLimit));}
    @PostMapping("/admin/users/{id}/reset-password") public Map<String,Object> reset(@PathVariable String id,@RequestBody JsonNode b){auth.resetPassword(id,text(b,"password",1024));return Map.of("ok",true);}
    @GetMapping("/admin/invites") public Map<String,Object> invites(){return Map.of("invites",auth.invites());}
    @PostMapping("/admin/invites") public Map<String,Object> create(){var p=auth.requireAdmin();return Map.of("invite",auth.createInvite(p.id()));}
    @DeleteMapping("/admin/invites/{id}") public Map<String,Object> revoke(@PathVariable String id){auth.revokeInvite(id);return Map.of("ok",true);}
    private Map<String,Object> account(UserPrincipal p){return Map.of("id",p.id(),"username",p.username(),"role",p.role(),"mustChangePassword",p.mustChangePassword());}
    private String cookie(HttpServletRequest r){if(r.getCookies()!=null)for(var c:r.getCookies())if(c.getName().equals("STUDIO_SESSION"))return c.getValue();return null;}
    private void setCookie(HttpServletResponse r,String token){r.addHeader("Set-Cookie","STUDIO_SESSION="+token+"; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000"+(secure?"; Secure":""));}
    private void clearCookie(HttpServletResponse r){r.addHeader("Set-Cookie","STUDIO_SESSION=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"+(secure?"; Secure":""));}
    private String text(JsonNode b,String k,int max){if(b==null||!b.isObject()||!b.has(k)||!b.get(k).isTextual()||b.get(k).asText().length()>max||b.get(k).asText().isBlank())throw ApiException.validation(k+"不能为空或超过长度限制。");return b.get(k).asText();}
    private boolean bool(JsonNode n){if(!n.isBoolean())throw ApiException.validation("enabled 必须为布尔值。");return n.asBoolean();}
    private int intValue(JsonNode n){if(!n.isIntegralNumber()||!n.canConvertToInt())throw ApiException.validation("dailyLimit 必须为整数或 null。");return n.intValue();}
}

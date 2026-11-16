package studio.api.auth;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import studio.api.common.ApiException;
import studio.api.common.DatabaseTransactions;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;
import java.security.MessageDigest;

@Service
public class AuthService {
    private static final long SESSION_MILLIS = 30L * 24 * 60 * 60 * 1000;
    private static final Pattern USERNAME = Pattern.compile("[A-Za-z0-9_.-]{3,64}");
    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    private final DatabaseTransactions locked;
    private final PasswordEncoder passwords;
    private final ApplicationEventPublisher events;
    private final SecureRandom random = new SecureRandom();

    public AuthService(JdbcTemplate db, TransactionTemplate tx, DatabaseTransactions locked,
                       PasswordEncoder passwords, ApplicationEventPublisher events) {
        this.db=db; this.tx=tx; this.locked=locked; this.passwords=passwords; this.events=events;
    }

    public UserPrincipal requireUser() {
        Authentication a=SecurityContextHolder.getContext().getAuthentication();
        if (a == null || !(a.getPrincipal() instanceof UserPrincipal p)) throw unauthorized();
        UserPrincipal current=db.query("SELECT username,role,must_change_password,enabled FROM app_users WHERE id=?", rs -> {
            if (!rs.next() || !rs.getBoolean("enabled")) return null;
            return new UserPrincipal(p.id(), rs.getString("username"), rs.getString("role"), rs.getBoolean("must_change_password"));
        }, p.id());
        if(current==null) throw unauthorized();
        if(current.mustChangePassword() && !passwordRoute()) throw forbidden("必须先修改密码。");
        return current;
    }
    private boolean passwordRoute() { return org.springframework.web.context.request.RequestContextHolder.getRequestAttributes() instanceof org.springframework.web.context.request.ServletRequestAttributes a && a.getRequest().getRequestURI().endsWith("/auth/password"); }
    public UserPrincipal requireAdmin() { UserPrincipal p=requireUser(); if(!"ADMIN".equals(p.role())) throw forbidden("需要管理员权限。"); return p; }
    private ApiException unauthorized(){return new ApiException("AUTH","请登录后继续。",401,false);}
    private ApiException forbidden(String m){return new ApiException("AUTH",m,403,false);}
    public record AuthResult(UserPrincipal user,String token) {}
    public record Account(String id,String username,String role,boolean mustChangePassword) {}
    public record AdminUser(String id,String username,String role,boolean enabled,boolean mustChangePassword,Integer dailyLimit,String createdAt) {}
    public record Invite(String id,String code,boolean enabled,String createdAt,long registrationCount) {}

    public AuthResult register(String username,String password,String invite) {
        validateUsername(username); validatePassword(password);
        String encoded=passwords.encode(password);
        return locked.locked(() -> {
            if(db.queryForObject("SELECT COUNT(*) FROM app_users WHERE username=?",Integer.class,username)>0)
                throw new ApiException("CONFLICT","用户名已被使用。",409,false);
            Integer count=db.query("SELECT COUNT(*) FROM invite_codes WHERE code=? AND enabled=TRUE", rs->{rs.next();return rs.getInt(1);},invite);
            if(count==0) throw ApiException.validation("邀请码无效或已撤销。");
            String id=UUID.randomUUID().toString();
            try { db.update("INSERT INTO app_users(id,username,password_hash,role,enabled,must_change_password,created_at,invite_id) VALUES(?,?,?,'USER',TRUE,FALSE,?,(SELECT id FROM invite_codes WHERE code=?))",id,username,encoded,Instant.now().toString(),invite); }
            catch(org.springframework.dao.DuplicateKeyException e){throw new ApiException("CONFLICT","用户名已被使用。",409,false);}
            return issue(id,username,"USER",false);
        });
    }
    public AuthResult login(String username,String password){return login(username,password,null);}
    public AuthResult login(String username,String password,String previousToken) {
        var rows=db.query("SELECT id,username,password_hash,role,must_change_password,enabled FROM app_users WHERE username=?",(rs,n)->new Object[]{rs.getString(1),rs.getString(2),rs.getString(3),rs.getString(4),rs.getBoolean(5),rs.getBoolean(6)},username);
        if(rows.isEmpty()) { passwords.matches(password, passwords.encode("constant-unknown-password")); throw unauthorized(); }
        Object[] r=rows.get(0); String observedHash=(String)r[2];
        if(!(Boolean)r[5] || !passwords.matches(password,observedHash)) throw unauthorized();
        return locked.locked(()->{
            var current=db.query("SELECT username,password_hash,role,must_change_password,enabled FROM app_users WHERE id=?",(rs,n)->new Object[]{rs.getString(1),rs.getString(2),rs.getString(3),rs.getBoolean(4),rs.getBoolean(5)},r[0]);
            if(current.isEmpty()||!(Boolean)current.get(0)[4]||!observedHash.equals(current.get(0)[1]))throw unauthorized();
            if(previousToken!=null&&!previousToken.isBlank())db.update("DELETE FROM login_sessions WHERE token_hash=? AND user_id=?",hash(previousToken),r[0]);
            Object[] fresh=current.get(0);
            return issue((String)r[0],(String)fresh[0],(String)fresh[2],(Boolean)fresh[3]);
        });
    }
    private AuthResult issue(String id,String username,String role,boolean force) {
        byte[] bytes=new byte[32]; random.nextBytes(bytes); String token=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        db.update("INSERT INTO login_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)",hash(token),id,System.currentTimeMillis()+SESSION_MILLIS);
        return new AuthResult(new UserPrincipal(id,username,role,force),token);
    }
    public UserPrincipal session(String token) {
        if(token==null || token.isBlank()) return null;
        var rows=db.query("SELECT u.id,u.username,u.role,u.must_change_password FROM login_sessions s JOIN app_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.enabled=TRUE",(rs,n)->new UserPrincipal(rs.getString(1),rs.getString(2),rs.getString(3),rs.getBoolean(4)),hash(token),System.currentTimeMillis());
        return rows.isEmpty()?null:rows.get(0);
    }
    public void logout(String token){if(token!=null) db.update("DELETE FROM login_sessions WHERE token_hash=?",hash(token));}
    public void changePassword(UserPrincipal p,String old,String next){
        validatePassword(next);
        String observed=db.queryForObject("SELECT password_hash FROM app_users WHERE id=?",String.class,p.id());
        if(!passwords.matches(old,observed))throw ApiException.validation("当前密码不正确。");
        String encoded=passwords.encode(next);
        locked.locked(()->{
            var current=db.query("SELECT password_hash,enabled FROM app_users WHERE id=?",(rs,n)->new Object[]{rs.getString(1),rs.getBoolean(2)},p.id());
            if(current.isEmpty()||!(Boolean)current.get(0)[1]||!observed.equals(current.get(0)[0]))throw ApiException.validation("当前密码已变更，请重新登录。");
            db.update("UPDATE app_users SET password_hash=?,must_change_password=FALSE WHERE id=?",encoded,p.id());
            db.update("DELETE FROM login_sessions WHERE user_id=?",p.id());return null;
        });
    }
    public List<AdminUser> users(){requireAdmin();return db.query("SELECT id,username,role,enabled,must_change_password,daily_limit,created_at FROM app_users ORDER BY created_at",(rs,n)->new AdminUser(rs.getString(1),rs.getString(2),rs.getString(3),rs.getBoolean(4),rs.getBoolean(5),(Integer)rs.getObject(6),rs.getString(7)));}
    public AdminUser updateUser(String id,Boolean enabled,Integer limit,boolean hasLimit){requireAdmin();return locked.locked(()->{
        var target=db.query("SELECT role FROM app_users WHERE id=?",(rs,n)->rs.getString(1),id); if(target.isEmpty())throw ApiException.notFound();
        if(!"USER".equals(target.get(0))&&enabled!=null)throw forbidden("不能禁用或启用管理员账户。");
        if(enabled!=null){db.update("UPDATE app_users SET enabled=? WHERE id=?",enabled,id);if(!enabled){db.update("DELETE FROM login_sessions WHERE user_id=?",id);events.publishEvent(new UserDisabledEvent(id));}}
        if(hasLimit){if(limit!=null&&(limit < -1||limit>1_000_000))throw ApiException.validation("dailyLimit 必须为 -1 到 1000000 或 null。");db.update("UPDATE app_users SET daily_limit=? WHERE id=?",limit,id);}
        return db.queryForObject("SELECT id,username,role,enabled,must_change_password,daily_limit,created_at FROM app_users WHERE id=?",(rs,n)->new AdminUser(rs.getString(1),rs.getString(2),rs.getString(3),rs.getBoolean(4),rs.getBoolean(5),(Integer)rs.getObject(6),rs.getString(7)),id);
    });}
    public void resetPassword(String id,String password){requireAdmin();validatePassword(password);String encoded=passwords.encode(password);locked.locked(()->{var role=db.query("SELECT role FROM app_users WHERE id=?",(rs,n)->rs.getString(1),id);if(role.isEmpty())throw ApiException.notFound();if(!"USER".equals(role.get(0)))throw forbidden("不能重置管理员账户密码。");db.update("UPDATE app_users SET password_hash=?,must_change_password=TRUE WHERE id=?",encoded,id);db.update("DELETE FROM login_sessions WHERE user_id=?",id);return null;});}
    public List<Invite> invites(){requireAdmin();return db.query("SELECT i.id,i.code,i.enabled,i.created_at,(SELECT COUNT(*) FROM app_users u WHERE u.invite_id=i.id) FROM invite_codes i ORDER BY i.created_at",(rs,n)->new Invite(rs.getString(1),rs.getString(2),rs.getBoolean(3),rs.getString(4),rs.getLong(5)));}
    public Invite createInvite(String admin){String code;byte[] b=new byte[24];random.nextBytes(b);code=Base64.getUrlEncoder().withoutPadding().encodeToString(b);String finalCode=code;return tx.execute(s->{String id=UUID.randomUUID().toString(),at=Instant.now().toString();db.update("INSERT INTO invite_codes(id,code,enabled,created_by,created_at) VALUES(?,?,TRUE,?,?)",id,finalCode,admin,at);return new Invite(id,finalCode,true,at,0);});}
    public void revokeInvite(String id){requireAdmin();locked.locked(()->{db.update("UPDATE invite_codes SET enabled=FALSE WHERE id=?",id);return null;});}
    public void bootstrap(String username,String password){if(username==null||password==null||password.isBlank())return;validateUsername(username);validatePassword(password);String encoded=passwords.encode(password);locked.locked(()->{Integer n=db.queryForObject("SELECT COUNT(*) FROM app_users WHERE role='ADMIN'",Integer.class);if(n==0)db.update("INSERT INTO app_users(id,username,password_hash,role,enabled,must_change_password,created_at) VALUES(?,?,?,'ADMIN',TRUE,FALSE,?)",UUID.randomUUID().toString(),username,encoded,Instant.now().toString());return null;});}
    public String hashToken(String token){return hash(token);}
    private String hash(String token){try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(java.nio.charset.StandardCharsets.UTF_8)));}catch(Exception e){throw new IllegalStateException(e);}}
    public static void validateUsername(String u){if(u==null||!USERNAME.matcher(u).matches())throw ApiException.validation("用户名需为3至64位字母、数字、点、下划线或连字符。");}
    public static void validatePassword(String p){if(p==null||p.length()<12||p.length()>1024)throw ApiException.validation("密码长度需为12至1024个字符。");}
}

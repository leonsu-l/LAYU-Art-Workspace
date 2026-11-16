package studio.api.auth;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.Pbkdf2PasswordEncoder;
import org.springframework.transaction.support.TransactionTemplate;
import studio.api.common.DatabaseTransactions;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;
import java.util.List;

class AuthServiceTest {
    JdbcTemplate db; AuthService auth;
    @org.junit.jupiter.api.AfterEach void clearSecurityContext(){SecurityContextHolder.clearContext();}
    @BeforeEach void setup(){
        var ds=new DriverManagerDataSource("jdbc:h2:mem:auth;DB_CLOSE_DELAY=-1;MODE=PostgreSQL","sa","");
        db=new JdbcTemplate(ds);
        db.execute("DROP ALL OBJECTS");
        db.execute("CREATE TABLE runtime_lock(id INTEGER PRIMARY KEY)");db.update("INSERT INTO runtime_lock VALUES(1)");
        db.execute("CREATE TABLE app_users(id VARCHAR(36) PRIMARY KEY,username VARCHAR(64) UNIQUE,password_hash VARCHAR(512),role VARCHAR(16),enabled BOOLEAN,must_change_password BOOLEAN,daily_limit INTEGER,invite_id VARCHAR(36),created_at VARCHAR(40))");
        db.execute("CREATE TABLE login_sessions(token_hash VARCHAR(64) PRIMARY KEY,user_id VARCHAR(36),expires_at BIGINT)");
        db.execute("CREATE TABLE invite_codes(id VARCHAR(36) PRIMARY KEY,code VARCHAR(128) UNIQUE,enabled BOOLEAN,created_by VARCHAR(36),created_at VARCHAR(40))");
        var tm=new org.springframework.jdbc.datasource.DataSourceTransactionManager(ds);var tx=new TransactionTemplate(tm);
        auth=new AuthService(db,tx,new DatabaseTransactions(db,tx),Pbkdf2PasswordEncoder.defaultsForSpringSecurity_v5_8(),mock(ApplicationEventPublisher.class));
        db.update("INSERT INTO app_users(id,username,password_hash,role,enabled,must_change_password,created_at) VALUES('admin','root',?,'ADMIN',TRUE,FALSE,'now')",Pbkdf2PasswordEncoder.defaultsForSpringSecurity_v5_8().encode("administrator-password"));
        db.update("INSERT INTO invite_codes VALUES('invite','invite-code',TRUE,'admin','now')");
    }
    @Test void inviteCanRegisterRepeatedlyUntilRevoked(){
        setAdmin();
        var one=auth.register("person.one","a-long-unique-passphrase","invite-code");
        var two=auth.register("person.two","another-long-passphrase","invite-code");
        assertEquals("USER",one.user().role());assertEquals("USER",two.user().role());
        auth.revokeInvite("invite");
        assertThrows(RuntimeException.class,()->auth.register("person.three","third-long-passphrase","invite-code"));
    }
    @Test void loginRotatesOnlySuppliedBrowserSession(){
        var first=auth.register("multi.user","a-long-unique-passphrase","invite-code");
        var second=auth.login("multi.user","a-long-unique-passphrase",first.token());
        assertNull(auth.session(first.token()));assertNotNull(auth.session(second.token()));
        var otherDevice=auth.login("multi.user","a-long-unique-passphrase");
        assertNotNull(auth.session(second.token()));assertNotNull(auth.session(otherDevice.token()));
    }
    @Test void loginPreservesRoleAndDisableInvalidatesSession(){
        var created=auth.register("normal.user","a-long-unique-passphrase","invite-code");
        var loggedIn=auth.login("normal.user","a-long-unique-passphrase");
        assertEquals("USER",loggedIn.user().role());
        setAdmin();auth.updateUser(created.user().id(),false,null,false);
        assertNull(auth.session(loggedIn.token()));
        assertThrows(RuntimeException.class,()->auth.login("normal.user","a-long-unique-passphrase"));
        SecurityContextHolder.clearContext();
    }
    @Test void passwordChangeClearsForceChangeAndOldSessions(){
        var created=auth.register("forced.user","a-long-unique-passphrase","invite-code");
        setAdmin();auth.resetPassword(created.user().id(),"reset-long-password");
        SecurityContextHolder.clearContext();
        var forced=auth.login("forced.user","reset-long-password");assertTrue(forced.user().mustChangePassword());
        auth.changePassword(forced.user(),"reset-long-password","new-long-password");
        assertNull(auth.session(forced.token()));assertFalse(db.queryForObject("SELECT must_change_password FROM app_users WHERE id=?",Boolean.class,created.user().id()));
    }
    private void setAdmin(){var principal=new UserPrincipal("admin","root","ADMIN",false);SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(principal,null,List.of(new SimpleGrantedAuthority("ROLE_ADMIN"))));}
}

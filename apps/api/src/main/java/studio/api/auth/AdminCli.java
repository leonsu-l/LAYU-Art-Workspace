package studio.api.auth;

import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.crypto.password.Pbkdf2PasswordEncoder;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import java.time.Instant;
import java.util.UUID;

/** Offline-web bootstrap/reset command. Invoke before SpringApplication.run. */
public final class AdminCli {
    private AdminCli(){}
    public static boolean requested(String[] args){for(String a:args)if(a.startsWith("--admin-command="))return true;return false;}
    public static int run(String[] args){
        try{
            String command=value(args,"--admin-command="),username=value(args,"--admin-username="),password=System.getenv("ADMIN_PASSWORD");
            if(!"create-admin".equals(command)&&!"reset-admin".equals(command))throw new CliFailure("--admin-command must be create-admin or reset-admin");
            AuthService.validateUsername(username);AuthService.validatePassword(password);
            String url=System.getenv("DATABASE_URL");if(url==null||url.isBlank())url="jdbc:postgresql://localhost:5432/studio";else if(url.startsWith("postgres://"))url="jdbc:"+url.replaceFirst("^postgres://","postgresql://");else if(url.startsWith("postgresql://"))url="jdbc:"+url;
            DriverManagerDataSource ds=new DriverManagerDataSource(url,System.getenv().getOrDefault("DATABASE_USER","studio"),System.getenv().getOrDefault("DATABASE_PASSWORD",""));
            JdbcTemplate db=new JdbcTemplate(ds);DataSourceTransactionManager tm=new DataSourceTransactionManager(ds);TransactionTemplate tx=new TransactionTemplate(tm);PasswordEncoder encoder=Pbkdf2PasswordEncoder.defaultsForSpringSecurity_v5_8();
            tx.execute(status->{
                try{db.queryForObject("SELECT id FROM runtime_lock WHERE id=1 FOR UPDATE",Integer.class);}catch(Exception e){throw new CliFailure("数据库迁移尚未完成。请先启动一次主服务完成 SQL 迁移，再重试管理员命令。");}
                var existing=db.query("SELECT id,role FROM app_users WHERE username=? FOR UPDATE",(rs,n)->new String[]{rs.getString(1),rs.getString(2)},username);
                if("create-admin".equals(command)){if(!existing.isEmpty())throw new CliFailure("该用户名已存在；不会将普通用户提升为管理员。");db.update("INSERT INTO app_users(id,username,password_hash,role,enabled,must_change_password,created_at) VALUES(?,?,?,'ADMIN',TRUE,FALSE,?)",UUID.randomUUID().toString(),username,encoder.encode(password),Instant.now().toString());}
                else {if(existing.isEmpty())throw new CliFailure("管理员账户不存在。");if(!"ADMIN".equals(existing.get(0)[1]))throw new CliFailure("该用户名属于普通用户；拒绝提升权限。");db.update("UPDATE app_users SET password_hash=?,must_change_password=FALSE,enabled=TRUE WHERE id=?",encoder.encode(password),existing.get(0)[0]);db.update("DELETE FROM login_sessions WHERE user_id=?",existing.get(0)[0]);}
                return null;
            });
            System.out.println("管理员操作成功。");return 0;
        }catch(CliFailure|studio.api.common.ApiException e){System.err.println("管理员操作失败："+e.getMessage());return 2;}
        catch(Exception e){System.err.println("管理员操作失败：数据库操作未完成，请检查数据库连接和迁移状态。");return 2;}
    }
    private static String value(String[] args,String prefix){for(String a:args)if(a.startsWith(prefix))return a.substring(prefix.length());throw new CliFailure("缺少参数 "+prefix+"...");}
    private static final class CliFailure extends RuntimeException { CliFailure(String message){super(message);} }
}

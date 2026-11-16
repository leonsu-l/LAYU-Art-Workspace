package studio.api.auth;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

@Component
public class AdminBootstrap implements ApplicationRunner {
    private final AuthService auth; private final Environment env;
    public AdminBootstrap(AuthService auth,Environment env){this.auth=auth;this.env=env;}
    @Override public void run(ApplicationArguments args){auth.bootstrap(env.getProperty("BOOTSTRAP_ADMIN_USERNAME"),env.getProperty("BOOTSTRAP_ADMIN_PASSWORD"));}
}

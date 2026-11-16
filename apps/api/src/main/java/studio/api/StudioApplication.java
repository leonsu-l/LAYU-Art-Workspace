package studio.api;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@EnableScheduling
@SpringBootApplication(exclude = org.springframework.boot.autoconfigure.security.servlet.UserDetailsServiceAutoConfiguration.class)
public class StudioApplication {
    public static void main(String[] args) {
        if (studio.api.auth.AdminCli.requested(args)) {
            System.exit(studio.api.auth.AdminCli.run(args));
            return;
        }
        SpringApplication.run(StudioApplication.class, args);
    }
}

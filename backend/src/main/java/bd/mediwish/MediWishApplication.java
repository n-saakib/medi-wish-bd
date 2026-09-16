package bd.mediwish;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication(excludeName = "org.springframework.boot.security.autoconfigure.UserDetailsServiceAutoConfiguration")
public class MediWishApplication {
    public static void main(String[] args) {
        SpringApplication.run(MediWishApplication.class, args);
    }
}

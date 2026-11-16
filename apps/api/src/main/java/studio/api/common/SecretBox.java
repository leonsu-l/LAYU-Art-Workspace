package studio.api.common;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.SecureRandom;
import java.util.Base64;

@Component
public class SecretBox {
    private final SecretKeySpec key;
    private final SecureRandom random = new SecureRandom();

    public SecretBox(@Value("${studio.data-dir}") String directory,
                     @Value("${studio.encryption-key:}") String configuredKey) throws Exception {
        byte[] bytes;
        if (!configuredKey.isBlank()) {
            bytes = Base64.getDecoder().decode(configuredKey.trim());
        } else {
            Path dir = Path.of(directory).toAbsolutePath().normalize();
            Files.createDirectories(dir);
            Path keyFile = dir.resolve("master.key");
            if (!Files.exists(keyFile)) {
                byte[] fresh = new byte[32];
                random.nextBytes(fresh);
                try {
                    if (Files.getFileStore(dir).supportsFileAttributeView("posix")) {
                        Files.createFile(keyFile, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
                        Files.writeString(keyFile, Base64.getEncoder().encodeToString(fresh));
                    } else {
                        Files.writeString(keyFile, Base64.getEncoder().encodeToString(fresh), StandardOpenOption.CREATE_NEW);
                    }
                } catch (java.nio.file.FileAlreadyExistsException ignored) { /* Another startup won creation. */ }
            }
            bytes = Base64.getDecoder().decode(Files.readString(keyFile).trim());
        }
        if (bytes.length != 32) throw new IllegalArgumentException("Encryption key must contain 32 base64-encoded bytes");
        key = new SecretKeySpec(bytes, "AES");
    }

    public String encrypt(String text) {
        try {
            byte[] iv = new byte[12];
            random.nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, iv));
            byte[] encrypted = cipher.doFinal(text.getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(ByteBuffer.allocate(iv.length + encrypted.length).put(iv).put(encrypted).array());
        } catch (Exception e) { throw new IllegalStateException("Unable to encrypt secret", e); }
    }

    public String decrypt(String text) {
        try {
            ByteBuffer buffer = ByteBuffer.wrap(Base64.getDecoder().decode(text));
            byte[] iv = new byte[12];
            buffer.get(iv);
            byte[] encrypted = new byte[buffer.remaining()];
            buffer.get(encrypted);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv));
            return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
        } catch (Exception e) { throw new IllegalStateException("Unable to decrypt secret; check the persistent encryption key", e); }
    }
}

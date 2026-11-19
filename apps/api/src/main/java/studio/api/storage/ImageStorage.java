package studio.api.storage;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import studio.api.common.ApiException;
import studio.api.common.HttpBytes;
import studio.api.provider.GeneratedImage;
import studio.api.provider.ProviderResult;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermission;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;

@Component
public class ImageStorage {
    private static final int MAX_IMAGE_BYTES = 25 * 1024 * 1024;
    private static final Duration DOWNLOAD_TIMEOUT = Duration.ofSeconds(60);
    private static final String PREFIX = "/api/images/";
    private static final byte[] PNG_SIGNATURE = HexFormat.of().parseHex("89504e470d0a1a0a");
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(DOWNLOAD_TIMEOUT)
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();

    private final Path directory;

    @org.springframework.beans.factory.annotation.Autowired
    public ImageStorage(@Value("${studio.data-dir}") String dataDirectory) {
        this(Path.of(dataDirectory));
    }

    public ImageStorage(Path dataDirectory) {
        this.directory = dataDirectory.toAbsolutePath().normalize().resolve("images").normalize();
    }

    public List<ImageRecord> writeResult(ProviderResult result, String prompt, String taskId,
                                         java.util.function.BiConsumer<ImageRecord, byte[]> writer) {
        if (result == null || result.images() == null || result.images().isEmpty() || result.images().size() > 10) {
            throw badResponse("供应商图片数量无效。");
        }
        UUID taskUuid;
        try {
            taskUuid = UUID.fromString(taskId);
            if (!taskUuid.toString().equalsIgnoreCase(taskId)) throw new IllegalArgumentException();
        } catch (RuntimeException exception) {
            throw badResponse("任务 ID 无效。");
        }
        List<ImageRecord> saved = new ArrayList<>();
        for (GeneratedImage image : result.images()) {
            byte[] bytes = resolveImage(image);
            Format format = identify(bytes);
            String id = UUID.randomUUID().toString();
            String filename = taskUuid + "_" + id + "." + format.extension;
            ImageRecord record = new ImageRecord(id, result.createdAt(), result.provider(), result.model(), prompt,
                    format.mime, bytes.length, PREFIX + filename, null, null);
            writer.accept(record, bytes);
            saved.add(record);
        }
        return List.copyOf(saved);
    }

    public void writeLocal(String url, byte[] bytes) {
        try {
            Files.createDirectories(directory);
            writeAtomically(checkedPath(url), bytes);
        } catch (IOException exception) {
            throw new ApiException("STORAGE", "图片保存失败。", 500, false);
        }
    }

    public byte[] read(String url) {
        try {
            return Files.readAllBytes(checkedPath(url));
        } catch (IOException exception) {
            if (exception instanceof java.nio.file.NoSuchFileException) throw ApiException.notFound();
            throw new ApiException("STORAGE", "图片读取失败。", 500, false);
        }
    }

    public void remove(String url) {
        try {
            Files.deleteIfExists(checkedPath(url));
        } catch (IOException exception) {
            throw new ApiException("STORAGE", "图片删除失败。", 500, false);
        }
    }

    String filename(String url) { return checkedPath(url).getFileName().toString(); }

    // Only used when the database cannot journal a local write after a paid provider call.
    // The empty marker identifies an exact candidate for recovery without scanning the gallery.
    private Path markers() { return directory.resolveSibling("pending-local"); }
    void markLocal(String url) {
        try {
            Files.createDirectories(markers());
            Files.createFile(markers().resolve(filename(url)));
        } catch (IOException e) { throw new ApiException("STORAGE", "无法登记图片写入。", 500, false); }
    }
    List<String> markedLocal() {
        if (Files.notExists(markers())) return List.of();
        try (var files = Files.list(markers())) {
            return files.map(path -> PREFIX + path.getFileName()).toList();
        } catch (IOException e) { throw new ApiException("STORAGE", "无法读取图片恢复记录。", 500, true); }
    }
    void unmarkLocal(String url) {
        try { Files.deleteIfExists(markers().resolve(filename(url))); }
        catch (IOException e) { throw new ApiException("STORAGE", "无法清理图片恢复记录。", 500, true); }
    }

    private Path checkedPath(String url) {
        if (url == null || !url.startsWith(PREFIX) || url.indexOf('\\') >= 0 || url.contains("..")) {
            throw badResponse("图片路径无效。");
        }
        String filename = url.substring(PREFIX.length());
        if (!filename.matches("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\\.(png|jpg|gif|webp)")) {
            throw badResponse("图片路径无效。");
        }
        String[] components = filename.split("[_.]", 3);
        if (!isCanonicalUuid(components[0]) || !isCanonicalUuid(components[1])) throw badResponse("图片路径无效。");
        Path target = directory.resolve(filename).normalize();
        if (!target.startsWith(directory) || !target.isAbsolute()) throw badResponse("图片路径越界。");
        return target;
    }

    private static boolean isCanonicalUuid(String value) {
        try {
            return UUID.fromString(value).toString().equalsIgnoreCase(value);
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }

    private static void writeAtomically(Path target, byte[] bytes) throws IOException {
        Path temp;
        try {
            temp = Files.createTempFile(target.getParent(), ".image-", ".tmp",
                    PosixFilePermissions.asFileAttribute(java.util.Set.of(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE)));
        } catch (UnsupportedOperationException exception) {
            temp = Files.createTempFile(target.getParent(), ".image-", ".tmp");
        }
        boolean moved = false;
        try {
            try (FileChannel channel = FileChannel.open(temp, StandardOpenOption.WRITE, StandardOpenOption.TRUNCATE_EXISTING)) {
                ByteBuffer buffer = ByteBuffer.wrap(bytes);
                while (buffer.hasRemaining()) channel.write(buffer);
                channel.force(true);
            }
            try {
                Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException ignored) {
                Files.move(temp, target);
            }
            moved = true;
        } finally {
            if (!moved) Files.deleteIfExists(temp);
        }
    }

    private static byte[] resolveImage(GeneratedImage image) {
        if (image == null) throw badResponse("供应商没有返回图片内容。");
        if (image.base64Data() != null && !image.base64Data().isBlank()) {
            String data = image.base64Data().replaceAll("\\s", "");
            try {
                if (data.length() > ((MAX_IMAGE_BYTES + 2L) / 3L) * 4L || data.length() % 4 != 0 || !data.matches("[A-Za-z0-9+/]*={0,2}")) {
                    throw badResponse("图片 Base64 无效或超过 25 MiB。");
                }
                byte[] decoded = Base64.getDecoder().decode(data);
                if (decoded.length == 0 || decoded.length > MAX_IMAGE_BYTES || !Base64.getEncoder().encodeToString(decoded).equals(data)) {
                    throw badResponse("图片为空或超过 25 MiB。");
                }
                return decoded;
            } catch (IllegalArgumentException exception) {
                throw badResponse("图片 Base64 无效或超过 25 MiB。");
            }
        }
        if (image.url() == null || image.url().isBlank()) throw badResponse("供应商没有返回图片内容。");
        try {
            URI uri = URI.create(image.url());
            if (!("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme())) || uri.getHost() == null || uri.getUserInfo() != null) {
                throw badResponse("供应商图片 URL 无效。");
            }
            HttpRequest request = HttpRequest.newBuilder(uri).timeout(DOWNLOAD_TIMEOUT).GET().build();
            var response = HttpBytes.send(HTTP, request, MAX_IMAGE_BYTES, DOWNLOAD_TIMEOUT);
            if (response.statusCode() < 200 || response.statusCode() >= 300) throw new ApiException("NETWORK", "下载供应商图片失败。", 502, true);
            byte[] bytes = response.body();
            if (bytes.length == 0) throw badResponse("供应商图片为空。");
            return bytes;
        } catch (ApiException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new ApiException("NETWORK", "下载供应商图片失败或超时，生成结果未完整保存。", 502, true);
        }
    }

    private static Format identify(byte[] bytes) {
        if (bytes.length >= 8 && startsWith(bytes, PNG_SIGNATURE)) return new Format("image/png", "png");
        if (bytes.length >= 3 && (bytes[0] & 0xff) == 0xff && (bytes[1] & 0xff) == 0xd8 && (bytes[2] & 0xff) == 0xff) return new Format("image/jpeg", "jpg");
        if (bytes.length >= 6 && bytes[0] == 'G' && bytes[1] == 'I' && bytes[2] == 'F' && bytes[3] == '8' && (bytes[4] == '7' || bytes[4] == '9') && bytes[5] == 'a') return new Format("image/gif", "gif");
        if (bytes.length >= 12 && bytes[0] == 'R' && bytes[1] == 'I' && bytes[2] == 'F' && bytes[3] == 'F' && bytes[8] == 'W' && bytes[9] == 'E' && bytes[10] == 'B' && bytes[11] == 'P') return new Format("image/webp", "webp");
        throw badResponse("供应商返回的内容不是支持的 PNG/JPEG/WebP/GIF 图片。");
    }

    private static boolean startsWith(byte[] bytes, byte[] prefix) {
        for (int i = 0; i < prefix.length; i++) if (bytes[i] != prefix[i]) return false;
        return true;
    }

    private static ApiException badResponse(String message) { return new ApiException("BAD_RESPONSE", message, 502, false); }
    private record Format(String mime, String extension) { }
}

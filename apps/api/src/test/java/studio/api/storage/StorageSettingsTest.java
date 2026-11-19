package studio.api.storage;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.transaction.support.TransactionTemplate;
import studio.api.auth.AuthService;
import studio.api.common.ApiException;
import studio.api.common.DatabaseTransactions;
import studio.api.common.SecretBox;

import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class StorageSettingsTest {
    @TempDir Path temp;
    JdbcTemplate db;
    StorageSettings settings;
    ObjectMapper json = new ObjectMapper();

    @BeforeEach void setup() throws Exception {
        var ds = new DriverManagerDataSource("jdbc:h2:mem:storage_settings;DB_CLOSE_DELAY=-1;MODE=PostgreSQL", "sa", "");
        db = new JdbcTemplate(ds);
        db.execute("DROP ALL OBJECTS");
        new ResourceDatabasePopulator(new ClassPathResource("db/migration/V1__tasks_and_gallery.sql"),
                new ClassPathResource("db/migration/V2__accounts_channels_and_quotas.sql"),
                new ClassPathResource("db/migration/V3__stable_queue_order.sql"),
                new ClassPathResource("db/migration/V4__storage_settings.sql"),
                new ClassPathResource("db/migration/V5__image_locations_and_expiry.sql")).execute(ds);
        var tx = new TransactionTemplate(new DataSourceTransactionManager(ds));
        settings = new StorageSettings(db, new DatabaseTransactions(db, tx), new SecretBox(temp.toString(), ""));
    }
    JsonNode node(String value) throws Exception { return json.readTree(value); }
    StorageSettings.BucketInfo create() throws Exception {
        return settings.create(node("""
                {"accountId":"0123456789abcdef0123456789abcdef","bucketName":"private-images",
                 "accessKeyId":"sensitive-access","secretAccessKey":"sensitive-secret","analyticsToken":"sensitive-token"}
                """));
    }

    @Test void upgradePreservesLegacyImagesAndOutstandingLocalDeletions() {
        var source = new DriverManagerDataSource("jdbc:h2:mem:legacy_gallery;DB_CLOSE_DELAY=-1;MODE=PostgreSQL", "sa", "");
        org.flywaydb.core.Flyway.configure().dataSource(source).target("3").load().migrate();
        var legacy = new JdbcTemplate(source);
        legacy.update("INSERT INTO tasks(id,owner_id,status,request_hash,task_json,created_at,updated_at) VALUES('old','user','succeeded','hash','{}','now','now')");
        legacy.update("INSERT INTO images(id,task_id,owner_id,url,bytes,image_json) VALUES('img','old','user','/api/images/old.png',42,'{}')");
        legacy.update("INSERT INTO file_deletions(url) VALUES('/api/images/deleted.png')");
        org.flywaydb.core.Flyway.configure().dataSource(source).load().migrate();
        assertEquals(1, legacy.queryForObject("SELECT COUNT(*) FROM images i JOIN tasks t ON i.task_id=t.id WHERE i.bytes=42 AND i.bucket_id IS NULL AND t.expires_at IS NULL", Integer.class));
        assertEquals(1, legacy.queryForObject("SELECT COUNT(*) FROM file_deletions WHERE url='/api/images/deleted.png' AND bucket_id IS NULL AND NOT staged AND not_before=0", Integer.class));
    }

    @Test void encryptsCredentialsNeverReturnsThemAndRotatesSelectively() throws Exception {
        var bucket = create();
        String row = db.queryForObject("SELECT access_key_id_cipher || secret_access_key_cipher || analytics_token_cipher FROM r2_buckets WHERE id=?", String.class, bucket.id());
        assertNotNull(row);
        for (String secret : new String[]{"sensitive-access", "sensitive-secret", "sensitive-token"}) {
            assertFalse(row.contains(secret));
            assertFalse(json.writeValueAsString(settings.list()).contains(secret));
        }
        var updated = settings.rotate(bucket.id(), node("{\"secretAccessKey\":\"new-secret\",\"analyticsToken\":null}"));
        assertFalse(updated.hasAnalyticsToken());
        R2Bucket credentials = settings.bucket(bucket.id());
        assertEquals("sensitive-access", credentials.accessKeyId());
        assertEquals("new-secret", credentials.secretAccessKey());
        assertNull(credentials.analyticsToken());
        assertFalse(json.writeValueAsString(updated).contains("new-secret"));
    }

    @Test void validatesIdentityCredentialsAndPolicyWithoutEchoingInput() throws Exception {
        assertNull(settings.policy().bucketId());
        assertNull(settings.policy().retentionDays());
        var b = create();
        assertEquals(409, assertThrows(ApiException.class, this::create).status());
        assertThrows(ApiException.class, () -> settings.create(node("{\"accountId\":\"attacker.example\",\"bucketName\":\"abc\",\"accessKeyId\":\"x\",\"secretAccessKey\":\"y\"}")));
        assertThrows(ApiException.class, () -> settings.create(node("{\"accountId\":\"0123456789abcdef0123456789abcdef\",\"bucketName\":\"evil.example\",\"accessKeyId\":\"x\",\"secretAccessKey\":\"y\"}")));
        assertThrows(ApiException.class, () -> settings.rotate(b.id(), node("{\"accountId\":\"different\"}")));
        ApiException badSecret = assertThrows(ApiException.class, () -> settings.rotate(b.id(), node("{\"secretAccessKey\":\"sensitive secret\"}")));
        assertFalse(badSecret.getMessage().contains("sensitive secret"));
        assertThrows(ApiException.class, () -> settings.rotate(b.id(), node("{\"secretAccessKey\":null}")));
        assertThrows(ApiException.class, () -> settings.updatePolicy(node("{\"activeBucketId\":null,\"retentionDays\":0}")));
        assertThrows(ApiException.class, () -> settings.updatePolicy(node("{\"activeBucketId\":null,\"retentionDays\":3651}")));
        var policy = settings.updatePolicy(node("{\"activeBucketId\":\"" + b.id() + "\",\"retentionDays\":3650}"));
        assertEquals(b.id(), policy.bucketId()); assertEquals(3650, policy.retentionDays());
        settings.updatePolicy(node("{\"activeBucketId\":null,\"retentionDays\":null}"));
        assertNull(settings.policy().bucketId()); assertNull(settings.policy().retentionDays());
    }

    @Test void protectsAllReferencesAndCountsOnlyUnexpiredImages() throws Exception {
        var b = create();
        settings.updatePolicy(node("{\"activeBucketId\":\"" + b.id() + "\",\"retentionDays\":null}"));
        assertEquals(409, assertThrows(ApiException.class, () -> settings.delete(b.id())).status());
        settings.updatePolicy(node("{\"activeBucketId\":null,\"retentionDays\":null}"));
        db.update("INSERT INTO tasks(id,owner_id,status,request_hash,task_json,created_at,updated_at,write_bucket_id) VALUES('pending','u','running','h','{}','now','now',?)", b.id());
        assertEquals(409, assertThrows(ApiException.class, () -> settings.delete(b.id())).status());
        db.update("UPDATE tasks SET write_bucket_id=NULL WHERE id='pending'");
        db.update("INSERT INTO tasks(id,owner_id,status,request_hash,task_json,created_at,updated_at,expires_at) VALUES('expired','u','succeeded','h','{}','now','now',?)", System.currentTimeMillis() - 1000);
        db.update("INSERT INTO images(id,task_id,owner_id,url,bytes,image_json,bucket_id) VALUES('a','pending','u','/a',12,'{}',?),('b','expired','u','/b',100,'{}',?)", b.id(), b.id());
        assertEquals(new StorageSettings.ApplicationUsage(1, 12), settings.applicationUsage(b.id()));
        assertEquals(409, assertThrows(ApiException.class, () -> settings.delete(b.id())).status());
        db.update("DELETE FROM images");
        db.update("INSERT INTO file_deletions(url,bucket_id) VALUES('/pending',?)", b.id());
        assertEquals(409, assertThrows(ApiException.class, () -> settings.delete(b.id())).status());
        db.update("DELETE FROM file_deletions");
        settings.delete(b.id());
        assertTrue(settings.list().isEmpty());
    }

    @Test void administratorCheckPrecedesEveryRead() throws Exception {
        var auth = mock(AuthService.class);
        var r2 = mock(R2Client.class);
        doThrow(new ApiException("AUTH", "无权执行此操作。", 403, false)).when(auth).requireAdmin();
        var controller = new StorageAdminController(auth, settings, r2);
        assertEquals(403, assertThrows(ApiException.class, controller::settings).status());
        assertEquals(403, assertThrows(ApiException.class, controller::buckets).status());
        assertEquals(403, assertThrows(ApiException.class, () -> controller.usage("unknown")).status());
        verifyNoInteractions(r2);
    }

    @Test void cloudFailureNeverBlocksApplicationCountOrReturnsException() throws Exception {
        var b = create();
        var auth = mock(AuthService.class);
        var r2 = mock(R2Client.class);
        when(r2.usage(any())).thenThrow(new IllegalStateException("sensitive-secret"));
        var controller = new StorageAdminController(auth, settings, r2);
        var usage = controller.usage(b.id());
        assertEquals(new StorageSettings.ApplicationUsage(0, 0), usage.application());
        assertEquals("unavailable", usage.cloudflare().status());
        assertFalse(json.writeValueAsString(usage).contains("sensitive-secret"));
        verify(auth).requireAdmin();
    }
}

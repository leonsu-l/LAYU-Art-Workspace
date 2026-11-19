package studio.api.ops;

import org.flywaydb.core.Flyway;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import studio.api.common.ApiException;

import java.time.Duration;
import java.util.ArrayList;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;
import static studio.api.ops.OpsIssues.Kind.*;

class OpsIssuesTest {
    private JdbcTemplate db;
    private OpsIssues issues;
    private DataSourceTransactionManager manager;
    private final String task = UUID.randomUUID().toString();
    private final String owner = UUID.randomUUID().toString();
    private final String channel = UUID.randomUUID().toString();
    private final String bucket = UUID.randomUUID().toString();

    @BeforeEach void setup() {
        JdbcDataSource ds = new JdbcDataSource();
        ds.setURL("jdbc:h2:mem:" + UUID.randomUUID() + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000");
        Flyway.configure().dataSource(ds).locations("classpath:db/migration").load().migrate();
        db = new JdbcTemplate(ds);
        manager = new DataSourceTransactionManager(ds);
        issues = new OpsIssues(db, manager);
    }

    @Test void concurrentReportsAccumulateAndContextSeparatesFailures() throws Exception {
        int count = 24;
        var executor = Executors.newFixedThreadPool(8);
        var start = new CountDownLatch(1);
        var futures = new ArrayList<java.util.concurrent.Future<?>>();
        try {
            for (int i = 0; i < count; i++) futures.add(executor.submit(() -> {
                start.await();
                issues.record(GENERATION_FAILED, task, owner, channel, bucket, "NETWORK");
                return null;
            }));
            start.countDown();
            for (var future : futures) future.get(20, TimeUnit.SECONDS);
        } finally { executor.shutdownNow(); }
        var issue = issues.list(0, 20, null).issues().getFirst();
        assertEquals(count, issue.occurrences());
        assertTrue(issue.firstSeen() <= issue.lastSeen());
        issues.record(GENERATION_FAILED, task, owner, channel, UUID.randomUUID().toString(), "NETWORK");
        issues.record(GENERATION_FAILED, task, owner, channel, bucket, "STORAGE");
        issues.record(R2_FALLBACK, null, owner, channel, bucket, "NETWORK");
        issues.record(R2_FALLBACK, null, UUID.randomUUID().toString(), channel, bucket, "NETWORK");
        assertEquals(5, issues.openCount());
    }

    @Test void unsafeInputsAreNeverPersistedOrReturned() {
        String secret = "prompt image https://upstream.invalid/secret exception-token";
        issues.record(IMAGE_WRITE_FAILED, secret, secret, secret, secret, secret);
        var issue = issues.list(0, 20, null).issues().getFirst();
        assertNull(issue.taskId());
        assertNull(issue.ownerId());
        assertNull(issue.channelId());
        assertNull(issue.bucketId());
        assertEquals("UNKNOWN", issue.errorCode());
        assertFalse(issue.toString().contains(secret));
        assertFalse(db.queryForList("SELECT * FROM admin_issues").toString().contains(secret));
    }

    @Test void resolvedIssueReopensWhenReportedAgain() {
        issues.record(IMAGE_READ_FAILED, task, owner, channel, bucket, "STORAGE");
        var first = issues.list(0, 20, "open").issues().getFirst();
        issues.resolve(first.id());
        assertEquals(0, issues.openCount());
        assertEquals(1, issues.list(0, 20, "resolved").total());
        issues.record(IMAGE_READ_FAILED, task, owner, channel, bucket, "STORAGE");
        var reopened = issues.list(0, 20, "open").issues().getFirst();
        assertEquals(first.id(), reopened.id());
        assertEquals(2, reopened.occurrences());
        assertEquals(first.firstSeen(), reopened.firstSeen());
        assertEquals(1, issues.openCount());
        assertThrows(ApiException.class, () -> issues.resolve(UUID.randomUUID().toString()));
    }

    @Test void retentionFilteringPagingAndCleanup() {
        for (int i = 0; i < 4; i++) issues.record(IMAGE_DELETE_FAILED, UUID.randomUUID().toString(), owner, channel, bucket, "STORAGE");
        var all = issues.list(0, 20, null).issues();
        long now = System.currentTimeMillis();
        for (int i = 0; i < all.size(); i++) db.update("UPDATE admin_issues SET last_seen=? WHERE id=?", now - i * 1000L, all.get(i).id());
        db.update("UPDATE admin_issues SET last_seen=? WHERE id=?", now - Duration.ofDays(31).toMillis(), all.getLast().id());
        assertEquals(3, issues.openCount());
        var page0 = issues.list(0, 2, null);
        var page1 = issues.list(1, 2, null);
        assertEquals(3, page0.total());
        assertEquals(2, page0.issues().size());
        assertEquals(1, page1.issues().size());
        assertTrue(page0.issues().getFirst().lastSeen() > page1.issues().getFirst().lastSeen());
        assertThrows(ApiException.class, () -> issues.resolve(all.getLast().id()));
        assertThrows(ApiException.class, () -> issues.list(-1, 20, null));
        assertThrows(ApiException.class, () -> issues.list(0, 101, null));
        assertThrows(ApiException.class, () -> issues.list(0, 20, "anything"));
        issues.purgeExpired();
        assertEquals(3, db.queryForObject("SELECT COUNT(*) FROM admin_issues", Integer.class));
    }

    @Test void reportingIsIndependentOfTaskRollbackAndSafeWhileRuntimeLockHeld() {
        new TransactionTemplate(manager).execute(status -> {
            db.queryForObject("SELECT id FROM runtime_lock WHERE id=1 FOR UPDATE", Integer.class);
            issues.record(GENERATION_FAILED, task, owner, channel, bucket, "NETWORK");
            status.setRollbackOnly();
            return null;
        });
        assertEquals(1, issues.openCount());
        db.execute("DROP TABLE admin_issues");
        assertDoesNotThrow(() -> issues.record(GENERATION_FAILED, task, owner, channel, bucket, "NETWORK"));
    }
}

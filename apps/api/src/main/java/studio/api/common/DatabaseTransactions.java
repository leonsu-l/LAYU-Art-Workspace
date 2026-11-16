package studio.api.common;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import java.util.function.Supplier;

@Component
public class DatabaseTransactions {
    private final JdbcTemplate db;
    private final TransactionTemplate transactions;
    public DatabaseTransactions(JdbcTemplate db, TransactionTemplate transactions) {
        this.db = db; this.transactions = transactions;
    }
    public <T> T locked(Supplier<T> action) {
        return transactions.execute(status -> {
            db.queryForObject("SELECT id FROM runtime_lock WHERE id=1 FOR UPDATE", Integer.class);
            return action.get();
        });
    }
}

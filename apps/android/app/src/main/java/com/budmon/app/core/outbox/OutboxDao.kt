// F-254: the outbox's queries.
package com.budmon.app.core.outbox

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface OutboxDao {
    /** Fails on a duplicate idempotency key (the unique index). */
    @Insert
    suspend fun insert(entry: OutboxEntry): Long

    @Query("SELECT * FROM outbox WHERE status = 'PENDING' ORDER BY createdAtEpochMs ASC, id ASC LIMIT :limit")
    suspend fun pendingOldestFirst(limit: Int): List<OutboxEntry>

    @Query("UPDATE outbox SET status = :status, lastErrorKey = :errorKey WHERE id = :id")
    suspend fun markStatus(id: Long, status: String, errorKey: String?)

    @Query("UPDATE outbox SET attempts = attempts + 1 WHERE id = :id")
    suspend fun incrementAttempts(id: Long)

    /** F-255: entries a dead process left in SENDING go back to PENDING. */
    @Query("UPDATE outbox SET status = 'PENDING' WHERE status = 'SENDING'")
    suspend fun resetSending(): Int

    @Query("DELETE FROM outbox WHERE id = :id")
    suspend fun delete(id: Long)

    @Query(
        "SELECT " +
            "COALESCE(SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END), 0) AS pending, " +
            "COALESCE(SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END), 0) AS failed, " +
            "COALESCE(SUM(CASE WHEN status = 'NEEDS_CONFIRMATION' THEN 1 ELSE 0 END), 0) AS needsConfirmation " +
            "FROM outbox",
    )
    fun observeCounts(): Flow<OutboxCounts>

    /** A-23: every entry, whatever its status; returns the rows deleted. */
    @Query("DELETE FROM outbox")
    suspend fun deleteAll(): Int

    /** A-23: every entry, whatever its status. */
    @Query("SELECT COUNT(*) FROM outbox")
    suspend fun countAll(): Int
}

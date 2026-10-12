// F-254 the outbox table and DAO, on an in-memory Room database (Robolectric). TP-13.4.
//
// Shapes per A-344: BudmonDatabase (the Room database class) with outboxDao(); OutboxEntry's
// constructor takes the F-254 columns by name; OutboxCounts(pending, failed, needsConfirmation).
package com.budmon.app.core.outbox

import android.content.Context
import android.database.sqlite.SQLiteConstraintException
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.budmon.app.core.db.BudmonDatabase
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class OutboxDaoTest {
    private lateinit var db: BudmonDatabase
    private lateinit var dao: OutboxDao

    @Before
    fun setUp() {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext<Context>(), BudmonDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        dao = db.outboxDao()
    }

    @After
    fun tearDown() {
        db.close()
    }

    private fun entry(key: String, createdAt: Long, status: String = "PENDING") = OutboxEntry(
        id = 0,
        idempotencyKey = key,
        method = "POST",
        path = "/api/v1/things",
        body = byteArrayOf(1, 2, 3),
        contentType = "application/json",
        createdAtEpochMs = createdAt,
        status = status,
        lastErrorKey = null,
        attempts = 0,
    )

    @Test
    fun `TP-13_4 three inserts come back oldest first, with correct counts`() = runTest {
        dao.insert(entry("k-2", createdAt = 2_000))
        dao.insert(entry("k-1", createdAt = 1_000))
        dao.insert(entry("k-3", createdAt = 3_000, status = "FAILED"))

        val pending = dao.pendingOldestFirst(10)
        assertEquals(listOf("k-1", "k-2"), pending.map { it.idempotencyKey })
        val counts = dao.observeCounts().first()
        assertEquals(2, counts.pending)
        assertEquals(1, counts.failed)
        assertEquals(0, counts.needsConfirmation)
    }

    @Test
    fun `TP-13_4 the idempotency key is unique`() = runTest {
        dao.insert(entry("same", createdAt = 1_000))

        assertThrows(SQLiteConstraintException::class.java) {
            kotlinx.coroutines.runBlocking { dao.insert(entry("same", createdAt = 2_000)) }
        }
    }

    @Test
    fun `TP-13_4 (A-23) countAll and deleteAll span every status - 3, 3, 0, 0`() = runTest {
        dao.insert(entry("p", 1_000, "PENDING"))
        dao.insert(entry("f", 2_000, "FAILED"))
        dao.insert(entry("n", 3_000, "NEEDS_CONFIRMATION"))

        assertEquals(3, dao.countAll())
        assertEquals(3, dao.deleteAll())
        assertEquals(0, dao.countAll())
        assertEquals(0, dao.deleteAll())
    }

    @Test
    fun `TP-13_4 markStatus sets the status and error key`() = runTest {
        val id = dao.insert(entry("k", 1_000))

        dao.markStatus(id, "FAILED", "VALIDATION_FAILED")

        assertEquals(0, dao.pendingOldestFirst(10).size)
        assertEquals(1, dao.observeCounts().first().failed)
    }
}

// F-255 apiRoot, resolveOutboxPath and OutboxRepository.enqueue's path check (A-474). TP-13.18.
//
// Assumed: OutboxRepository keeps its constructor (dao, workManager, clock); A-474 doesn't change it.
package com.budmon.app.core.outbox

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.work.WorkManager
import com.budmon.app.core.db.BudmonDatabase
import com.budmon.app.core.network.apiRoot
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.time.Clock

@RunWith(RobolectricTestRunner::class)
class OutboxPathTest {
    private lateinit var db: BudmonDatabase

    @Before
    fun setUp() {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext<Context>(), BudmonDatabase::class.java)
            .allowMainThreadQueries()
            .build()
    }

    @After
    fun tearDown() {
        db.close()
    }

    @Test
    fun `TP-13_18 apiRoot appends api-v1 to a base URL ending in a slash`() {
        assertEquals("https://h/api/v1/", apiRoot("https://h/".toHttpUrl()).toString())
        assertEquals("https://h/budmon/api/v1/", apiRoot("https://h/budmon/".toHttpUrl()).toString())
    }

    @Test
    fun `TP-13_18 apiRoot of a base URL without a trailing slash throws IllegalArgumentException`() {
        assertThrows(IllegalArgumentException::class.java) { apiRoot("https://h/budmon".toHttpUrl()) }
    }

    @Test
    fun `TP-13_18 resolveOutboxPath accepts relative references under the root`() {
        val root = apiRoot("https://h/budmon/".toHttpUrl())

        assertEquals("https://h/budmon/api/v1/things", resolveOutboxPath(root, "things").toString())
        assertEquals(
            "https://h/budmon/api/v1/transactions/7f3a?x=1",
            resolveOutboxPath(root, "transactions/7f3a?x=1").toString(),
        )
    }

    @Test
    fun `TP-13_18 resolveOutboxPath refuses everything else with null`() {
        val root = apiRoot("https://h/budmon/".toHttpUrl())
        val invalid = listOf(
            "",
            "/things",
            "https://evil.example/x",
            "//evil.example/x",
            "../x",
            "a/./b",
            "a/../../x",
            "a\\b",
            "x#f",
            "a b",
        )

        for (path in invalid) assertNull(path, resolveOutboxPath(root, path))
    }

    @Test
    fun `TP-13_18 enqueue refuses an absolute path and stores nothing, then stores a relative one`() = runTest {
        val dao = db.outboxDao()
        val repo = OutboxRepository(dao, mockk<WorkManager>(relaxed = true), Clock.systemUTC())

        val error = runCatching { repo.enqueue("POST", "/things", "{}".toByteArray(), "application/json") }.exceptionOrNull()
        assertTrue(error.toString(), error is IllegalArgumentException)
        assertEquals("invalid outbox path", error?.message)
        assertEquals(0, dao.countAll())

        val id = repo.enqueue("POST", "things", "{}".toByteArray(), "application/json")
        assertTrue(id > 0)
        assertEquals(1, dao.countAll())
    }
}

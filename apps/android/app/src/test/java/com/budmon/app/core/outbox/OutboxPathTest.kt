// F-255 apiRoot, resolveOutboxPath and OutboxRepository.enqueue's path check (A-474). TP-13.18.
// The repository is built as OutboxRepository(dao, workManager, clock, baseUrl) (A-482).
package com.budmon.app.core.outbox

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequest
import androidx.work.WorkManager
import com.budmon.app.core.db.BudmonDatabase
import com.budmon.app.core.network.apiRoot
import io.mockk.Called
import io.mockk.confirmVerified
import io.mockk.mockk
import io.mockk.verify
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
    fun `TP-13_18 OutboxRepository with a base URL without a trailing slash throws IllegalArgumentException`() {
        val workManager = mockk<WorkManager>(relaxed = true)

        assertThrows(IllegalArgumentException::class.java) {
            OutboxRepository(db.outboxDao(), workManager, Clock.systemUTC(), "https://h/budmon".toHttpUrl())
        }
        verify { workManager wasNot Called }
    }

    @Test
    fun `TP-13_18 enqueue refuses an absolute or dot-dot path, storing nothing and scheduling nothing`() = runTest {
        val dao = db.outboxDao()
        val workManager = mockk<WorkManager>(relaxed = true)
        val repo = OutboxRepository(dao, workManager, Clock.systemUTC(), "https://h/budmon/".toHttpUrl())

        for (path in listOf("/things", "../x")) {
            val error = runCatching { repo.enqueue("POST", path, "{}".toByteArray(), "application/json") }.exceptionOrNull()
            assertTrue("$path: $error", error is IllegalArgumentException)
            assertEquals(path, "invalid outbox path", error?.message)
            assertEquals(path, 0, dao.countAll())
        }
        verify { workManager wasNot Called }
    }

    @Test
    fun `TP-13_18 enqueue of a relative path stores it as passed and asks for one sync`() = runTest {
        val dao = db.outboxDao()
        val workManager = mockk<WorkManager>(relaxed = true)
        val repo = OutboxRepository(dao, workManager, Clock.systemUTC(), "https://h/budmon/".toHttpUrl())

        val id = repo.enqueue("POST", "things", "{}".toByteArray(), "application/json")

        assertTrue(id > 0)
        assertEquals(1, dao.countAll())
        assertEquals(listOf("things"), dao.pendingOldestFirst(10).map { it.path })
        verify(exactly = 1) {
            workManager.enqueueUniqueWork("outbox-sync-now", ExistingWorkPolicy.KEEP, any<OneTimeWorkRequest>())
        }
        confirmVerified(workManager)
    }
}

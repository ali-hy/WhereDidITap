// F-255 SyncWorker: sync outcomes. TP-13.5.
//
// Construction per A-344 (a @HiltWorker, built directly here):
// SyncWorker(context, params, dao: OutboxDao, http: OkHttpClient, baseUrl: HttpUrl,
// updates: UpdateRepository, clock: java.time.Clock), built here through TestListenableWorkerBuilder
// with a WorkerFactory; UpdateRepository exposes state: StateFlow<UpdateState> and markRequired(min).
package com.budmon.app.core.outbox

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.work.ListenableWorker
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import androidx.work.testing.TestListenableWorkerBuilder
import com.budmon.app.core.db.BudmonDatabase
import com.budmon.app.core.update.UpdateRepository
import com.budmon.app.core.update.UpdateState
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class SyncWorkerTest {
    private val now = Instant.parse("2026-10-07T12:00:00Z")
    private val clock = Clock.fixed(now, ZoneOffset.UTC)
    private val day = TimeUnit.DAYS.toMillis(1)

    private lateinit var server: MockWebServer
    private lateinit var db: BudmonDatabase
    private lateinit var dao: OutboxDao
    private val updateState = MutableStateFlow<UpdateState>(UpdateState.None)
    private lateinit var updates: UpdateRepository

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext<Context>(), BudmonDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        dao = db.outboxDao()
        updates = mockk(relaxed = true)
        every { updates.state } returns updateState
    }

    @After
    fun tearDown() {
        db.close()
        server.shutdown()
    }

    private suspend fun add(key: String, ageMs: Long = 0, status: String = "PENDING", body: ByteArray = """{"k":"$key"}""".toByteArray()): Long =
        dao.insert(
            OutboxEntry(
                id = 0,
                idempotencyKey = key,
                method = "POST",
                path = "/api/v1/things",
                body = body,
                contentType = "application/json",
                createdAtEpochMs = now.toEpochMilli() - ageMs,
                status = status,
                lastErrorKey = null,
                attempts = 0,
            ),
        )

    private suspend fun run(): ListenableWorker.Result {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val factory = object : WorkerFactory() {
            override fun createWorker(appContext: Context, workerClassName: String, workerParameters: WorkerParameters) =
                SyncWorker(appContext, workerParameters, dao, OkHttpClient(), server.url("/"), updates, clock)
        }
        return TestListenableWorkerBuilder<SyncWorker>(context).setWorkerFactory(factory).build().doWork()
    }

    private fun envelope(code: String, status: Int, data: String? = null) = MockResponse()
        .setResponseCode(status)
        .setHeader("Content-Type", "application/json")
        .setBody("""{"defined":true,"code":"$code","status":$status,"message":"x"${data?.let { ",\"data\":$it" } ?: ""}}""")

    private suspend fun statusOf(key: String) =
        db.query("SELECT status FROM outbox WHERE idempotencyKey = ?", arrayOf(key)).use { c -> if (c.moveToFirst()) c.getString(0) else null }

    @Test
    fun `TP-13_5 an entry left in SENDING is reset and sent with the stored bytes and key; 201 deletes it`() = runTest {
        val body = byteArrayOf(0x7b, 0x22, 0x61, 0x22, 0x3a, 0x31, 0x7d)
        add("sending-key", status = "SENDING", body = body)
        server.enqueue(MockResponse().setResponseCode(201).setBody("{}"))

        val result = run()

        val sent = server.takeRequest()
        assertEquals("POST", sent.method)
        assertEquals("/api/v1/things", sent.path)
        assertArrayEquals(body, sent.body.readByteArray())
        assertEquals("sending-key", sent.getHeader("Idempotency-Key"))
        assertEquals("application/json", sent.getHeader("Content-Type")?.substringBefore(";"))
        assertNull(statusOf("sending-key"))
        assertEquals(ListenableWorker.Result.success(), result)
    }

    @Test
    fun `TP-13_5 a replayed 201 deletes the entry too`() = runTest {
        add("replay")
        server.enqueue(MockResponse().setResponseCode(201).setHeader("Idempotent-Replayed", "true").setBody("{}"))

        run()

        assertNull(statusOf("replay"))
    }

    @Test
    fun `TP-13_5 400 VALIDATION_FAILED marks the entry FAILED with the key`() = runTest {
        add("bad")
        server.enqueue(envelope("VALIDATION_FAILED", 400, """{"issues":[]}"""))

        run()

        assertEquals("FAILED", statusOf("bad"))
        val key = db.query("SELECT lastErrorKey FROM outbox WHERE idempotencyKey = 'bad'", null).use { c -> c.moveToFirst(); c.getString(0) }
        assertEquals("VALIDATION_FAILED", key)
    }

    @Test
    fun `TP-13_5 503 retries and keeps the entry`() = runTest {
        add("later")
        server.enqueue(envelope("SERVICE_UNAVAILABLE", 503, """{"outcome":"not_applied"}"""))

        assertEquals(ListenableWorker.Result.retry(), run())
        assertEquals("PENDING", statusOf("later"))
    }

    @Test
    fun `TP-13_5 CLIENT_UPDATE_REQUIRED marks the update required and leaves the rest unsent`() = runTest {
        add("first", ageMs = 2_000)
        add("second", ageMs = 1_000)
        server.enqueue(envelope("CLIENT_UPDATE_REQUIRED", 400, """{"minimumVersion":9}"""))

        run()

        verify { updates.markRequired(9) }
        assertEquals(1, server.requestCount)
        assertEquals("PENDING", statusOf("first"))
        assertEquals("PENDING", statusOf("second"))
    }

    @Test
    fun `TP-13_5 with UpdateState Required nothing is sent and entries stay PENDING`() = runTest {
        updateState.value = UpdateState.Required(9)
        add("held")

        run()

        assertEquals(0, server.requestCount)
        assertEquals("PENDING", statusOf("held"))
    }

    @Test
    fun `TP-13_5 401 UNAUTHENTICATED stops with success, entries stay PENDING`() = runTest {
        add("a", ageMs = 2_000)
        add("b", ageMs = 1_000)
        server.enqueue(envelope("UNAUTHENTICATED", 401))

        assertEquals(ListenableWorker.Result.success(), run())
        assertEquals(1, server.requestCount)
        assertEquals("PENDING", statusOf("a"))
        assertEquals("PENDING", statusOf("b"))
    }

    @Test
    fun `TP-13_5 502 HTML retries`() = runTest {
        add("gw")
        server.enqueue(MockResponse().setResponseCode(502).setBody("<html>Bad Gateway</html>"))

        assertEquals(ListenableWorker.Result.retry(), run())
        assertEquals("PENDING", statusOf("gw"))
    }

    @Test
    fun `TP-13_5 a network failure retries`() = runTest {
        add("net")
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START))

        assertEquals(ListenableWorker.Result.retry(), run())
        assertEquals("PENDING", statusOf("net"))
    }

    @Test
    fun `TP-13_5 an entry 61 days old becomes NEEDS_CONFIRMATION and is never sent`() = runTest {
        add("old", ageMs = 61 * day)

        run()

        assertEquals(0, server.requestCount)
        assertEquals("NEEDS_CONFIRMATION", statusOf("old"))
    }

    @Test
    fun `TP-13_5 attempts is incremented on every send`() = runTest {
        add("count")
        server.enqueue(envelope("SERVICE_UNAVAILABLE", 503, """{"outcome":"not_applied"}"""))

        run()

        val attempts = db.query("SELECT attempts FROM outbox WHERE idempotencyKey = 'count'", null).use { c -> c.moveToFirst(); c.getInt(0) }
        assertEquals(1, attempts)
    }
}

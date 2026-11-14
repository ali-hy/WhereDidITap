// F-255 SyncWorker: sync outcomes. TP-13.5.
//
// Construction per A-344 (a @HiltWorker, built directly here):
// SyncWorker(context, params, dao: OutboxDao, http: OkHttpClient, baseUrl: HttpUrl,
// updates: UpdateRepository, clock: java.time.Clock), built here through TestListenableWorkerBuilder
// with a WorkerFactory; UpdateRepository exposes state: StateFlow<UpdateState>, suspend current()
// and suspend markRequired(min: Int?) (A-471). Stored paths are relative to api/v1/ (A-474).
package com.budmon.app.core.outbox

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.work.ListenableWorker
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import androidx.work.testing.TestListenableWorkerBuilder
import com.budmon.api.apis.MetaApi
import com.budmon.app.core.db.BudmonDatabase
import com.budmon.app.core.update.UpdateRepository
import com.budmon.app.core.update.UpdateState
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.concurrent.TimeUnit

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
        coEvery { updates.current() } coAnswers { updateState.value }
    }

    @After
    fun tearDown() {
        db.close()
        server.shutdown()
    }

    private suspend fun add(
        key: String,
        ageMs: Long = 0,
        status: String = "PENDING",
        body: ByteArray = """{"k":"$key"}""".toByteArray(),
        path: String = "things",
    ): Long = dao.insert(
        OutboxEntry(
            id = 0,
            idempotencyKey = key,
            method = "POST",
            path = path,
            body = body,
            contentType = "application/json",
            createdAtEpochMs = now.toEpochMilli() - ageMs,
            status = status,
            lastErrorKey = null,
            attempts = 0,
        ),
    )

    private suspend fun run(
        client: OkHttpClient = OkHttpClient(),
        baseUrl: HttpUrl = server.url("/"),
        repository: UpdateRepository = updates,
    ): ListenableWorker.Result {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val factory = object : WorkerFactory() {
            override fun createWorker(appContext: Context, workerClassName: String, workerParameters: WorkerParameters) =
                SyncWorker(appContext, workerParameters, dao, client, baseUrl, repository, clock)
        }
        return TestListenableWorkerBuilder<SyncWorker>(context).setWorkerFactory(factory).build().doWork()
    }

    private fun envelope(code: String, status: Int, data: String? = null) = MockResponse()
        .setResponseCode(status)
        .setHeader("Content-Type", "application/json")
        .setBody("""{"defined":true,"code":"$code","status":$status,"message":"x"${data?.let { ",\"data\":$it" } ?: ""}}""")

    private suspend fun statusOf(key: String) = db.query("SELECT status FROM outbox WHERE idempotencyKey = ?", arrayOf(key)).use { c ->
        if (c.moveToFirst()) c.getString(0) else null
    }

    @Test
    fun `TP-13_5 an entry left in SENDING is reset and sent with the stored bytes and key, 201 deletes it`() = runTest {
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
        val key = db.query("SELECT lastErrorKey FROM outbox WHERE idempotencyKey = 'bad'", null).use { c ->
            c.moveToFirst()
            c.getString(0)
        }
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

        coVerify { updates.markRequired(9) }
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

        val attempts = db.query("SELECT attempts FROM outbox WHERE idempotencyKey = 'count'", null).use { c ->
            c.moveToFirst()
            c.getInt(0)
        }
        assertEquals(1, attempts)
    }

    // ---- Review B-9: the rest of F-255's response table ----

    @Test
    fun `TP-13_5 a 429 without an envelope retries and keeps the entry PENDING`() = runTest {
        add("busy")
        server.enqueue(MockResponse().setResponseCode(429))

        assertEquals(ListenableWorker.Result.retry(), run())
        assertEquals("PENDING", statusOf("busy"))
    }

    @Test
    fun `TP-13_5 a RATE_LIMITED envelope retries and keeps the entry PENDING`() = runTest {
        add("limited")
        server.enqueue(envelope("RATE_LIMITED", 429, """{"retryAfterSeconds":30}"""))

        assertEquals(ListenableWorker.Result.retry(), run())
        assertEquals("PENDING", statusOf("limited"))
    }

    @Test
    fun `TP-13_5 a 500 INTERNAL envelope retries and keeps the entry PENDING`() = runTest {
        add("boom")
        server.enqueue(envelope("INTERNAL", 500))

        assertEquals(ListenableWorker.Result.retry(), run())
        assertEquals("PENDING", statusOf("boom"))
    }

    @Test
    fun `TP-13_5 a timeout retries and keeps the entry PENDING`() = runTest {
        add("slow")
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
        val client = OkHttpClient.Builder().readTimeout(500, TimeUnit.MILLISECONDS).build()

        assertEquals(ListenableWorker.Result.retry(), run(client))
        assertEquals("PENDING", statusOf("slow"))
    }

    @Test
    fun `TP-13_5 a 400 marks the first entry FAILED and the batch goes on - the second is sent and deleted`() = runTest {
        add("first-bad", ageMs = 2_000)
        add("second-ok", ageMs = 1_000)
        server.enqueue(envelope("VALIDATION_FAILED", 400))
        server.enqueue(MockResponse().setResponseCode(201).setBody("{}"))

        assertEquals(ListenableWorker.Result.success(), run())
        assertEquals(2, server.requestCount)
        assertEquals("FAILED", statusOf("first-bad"))
        assertNull(statusOf("second-ok"))
        server.takeRequest()
        assertEquals("second-ok", server.takeRequest().getHeader("Idempotency-Key"))
    }

    // ---- A-474: paths relative to api/v1/, resolved under the base URL's own path ----

    private fun column(key: String, name: String): String? =
        db.query("SELECT $name FROM outbox WHERE idempotencyKey = ?", arrayOf(key)).use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }

    @Test
    fun `TP-13_5 (A-474) a stored path things is sent to api-v1-things`() = runTest {
        add("rel")
        server.enqueue(MockResponse().setResponseCode(201).setBody("{}"))

        run()

        assertEquals("/api/v1/things", server.takeRequest().path)
    }

    @Test
    fun `TP-13_5 (A-474) with base URL prefix-slash, things is sent to prefix-api-v1-things`() = runTest {
        add("prefixed")
        server.enqueue(MockResponse().setResponseCode(201).setBody("{}"))

        run(baseUrl = server.url("/prefix/"))

        assertEquals("/prefix/api/v1/things", server.takeRequest().path)
    }

    @Test
    fun `TP-13_5 (A-474) each invalid stored path is FAILED with INVALID_PATH, attempts 0, not sent, and the next entry is still sent`() =
        runTest {
            for ((n, bad) in listOf("/api/v1/things", "https://evil.example/x", "../x", "a/../../x", "x#f").withIndex()) {
                val before = server.requestCount
                add("bad-$n", ageMs = 2_000, path = bad)
                add("next-$n", ageMs = 1_000)
                server.enqueue(MockResponse().setResponseCode(201).setBody("{}"))

                run()

                assertEquals(bad, "FAILED", statusOf("bad-$n"))
                assertEquals(bad, "INVALID_PATH", column("bad-$n", "lastErrorKey"))
                assertEquals(bad, "0", column("bad-$n", "attempts"))
                assertEquals(bad, before + 1, server.requestCount)
                assertEquals(bad, "next-$n", server.takeRequest().getHeader("Idempotency-Key"))
                assertNull(bad, statusOf("next-$n"))
            }
        }

    // ---- A-471, A-481: a real UpdateRepository over DataStore (versionCode 4) ----

    private val minimumKey = intPreferencesKey("minimumVersionCode")

    private fun TestScope.realUpdates(store: DataStore<Preferences>): UpdateRepository = UpdateRepository(
        mockk<MetaApi>(relaxed = true),
        store,
        4,
        clock,
    )

    private fun TestScope.store(): DataStore<Preferences> {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val file = File(context.filesDir, "sync-update-${System.nanoTime()}.preferences_pb")
        return PreferenceDataStoreFactory.create(scope = backgroundScope) { file }
    }

    @Test
    fun `TP-13_5 (A-471) a cold repository whose store holds versionCode + 1 sends nothing - success, entry PENDING`() = runTest {
        val store = store()
        store.edit { it[minimumKey] = 5 }
        add("cold")

        val result = run(repository = realUpdates(store))

        assertEquals(0, server.requestCount)
        assertEquals(ListenableWorker.Result.success(), result)
        assertEquals("PENDING", statusOf("cold"))
    }

    @Test
    fun `TP-13_5 (A-481) CLIENT_UPDATE_REQUIRED with minimum 9, missing, a string or 0`() = runTest {
        val cases = listOf(
            """{"minimumVersion":9}""" to 9,
            null to 5,
            """{"minimumVersion":"9"}""" to 5,
            """{"minimumVersion":0}""" to 5,
        )
        for ((n, case) in cases.withIndex()) {
            val (data, stored) = case
            val store = store()
            val repo = realUpdates(store)
            add("sent-$n", ageMs = 2_000)
            add("held-$n", ageMs = 1_000)
            val before = server.requestCount
            server.enqueue(envelope("CLIENT_UPDATE_REQUIRED", 400, data))

            val result = run(repository = repo)

            val label = data ?: "no data"
            assertEquals(label, ListenableWorker.Result.success(), result)
            assertEquals(label, before + 1, server.requestCount)
            assertEquals(label, "sent-$n", server.takeRequest().getHeader("Idempotency-Key"))
            assertEquals(label, "PENDING", statusOf("sent-$n"))
            assertEquals(label, "1", column("sent-$n", "attempts"))
            assertNull(label, column("sent-$n", "lastErrorKey"))
            assertEquals(label, "PENDING", statusOf("held-$n"))
            assertEquals(label, "0", column("held-$n", "attempts"))
            assertTrue(label, repo.state.value is UpdateState.Required)
            assertEquals(label, stored, store.data.first()[minimumKey])
            dao.deleteAll()
        }
    }
}

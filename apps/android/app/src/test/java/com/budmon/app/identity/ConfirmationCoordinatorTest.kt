// F-216 ConfirmationCoordinator (identity LLD §8.2's S-4 signatures, A-83, A-99). TP-4.35's
// ConfirmationCoordinator rows, plus TP-4.35x.
// Setup per TP-4.35: the real coordinator around a MockK AuthRepository;
// Dispatchers.setMain(StandardTestDispatcher). The LLD doesn't say which scope submit() runs
// repository.confirm on, so tests wait on the coordinator's StateFlows and on the callers' results
// rather than on virtual time alone.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
package com.budmon.app.identity

import com.budmon.app.R
import com.budmon.app.core.error.UiText
import com.budmon.app.core.network.ApiError
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.time.Instant
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class ConfirmationCoordinatorTest {
    private val repository = mockk<AuthRepository> {
        coEvery { confirm(any(), any(), any()) } returns Instant.parse("2026-11-15T10:20:00Z")
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun TestScope.coordinator(): ConfirmationCoordinator {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        return ConfirmationCoordinator(repository)
    }

    private fun confirmationRequired(factor: String) =
        ApiException(ApiError.Defined("CONFIRMATION_REQUIRED", 403, buildJsonObject { put("factor", factor) }))

    /** A run() that throws CONFIRMATION_REQUIRED on its first call and returns [result] after; counts its calls. */
    private class Run(private val factor: String, private val result: String, private val always: Boolean = false) {
        val calls = AtomicInteger(0)

        fun block(error: (String) -> ApiException): suspend () -> String = {
            val n = calls.incrementAndGet()
            if (n == 1 || always) throw error(factor)
            result
        }
    }

    // ---- TP-4.35 ----

    @Test
    fun `TP-4_35 run throws CONFIRMATION_REQUIRED two_step, then a correct code - request TwoStep, confirm(code), run once more, its result returned`() =
        runTest {
            val coordinator = coordinator()
            val run = Run("two_step", "done")

            val outcome = async { runCatching { coordinator.withConfirmation(run.block(::confirmationRequired)) } }
            assertEquals(ConfirmFactor.TwoStep, coordinator.request.first { it != null })
            assertEquals(1, run.calls.get())
            coordinator.submit(code = "123456")

            assertEquals("done", outcome.await().getOrThrow())
            coVerify(exactly = 1) { repository.confirm(null, "123456", null) }
            assertEquals("run() called exactly once more", 2, run.calls.get())
            assertNull("the sheet closes", coordinator.request.first { it == null })
        }

    @Test
    fun `TP-4_35 run throws CONFIRMATION_REQUIRED two_step, then cancel - null, run not called again, no confirm`() = runTest {
        val coordinator = coordinator()
        val run = Run("two_step", "done")

        val outcome = async { runCatching { coordinator.withConfirmation(run.block(::confirmationRequired)) } }
        coordinator.request.first { it != null }
        coordinator.cancel()

        assertNull(outcome.await().getOrThrow())
        assertEquals(1, run.calls.get())
        coVerify(exactly = 0) { repository.confirm(any(), any(), any()) }
        assertNull(coordinator.request.first { it == null })
    }

    // ---- additions ----

    @Test
    fun `TP-4_35x run succeeding at once - its result, no sheet, no confirm`() = runTest {
        val coordinator = coordinator()

        val result = coordinator.withConfirmation { "done" }

        assertEquals("done", result)
        assertNull(coordinator.request.value)
        coVerify(exactly = 0) { repository.confirm(any(), any(), any()) }
    }

    @Test
    fun `TP-4_35x run throwing another error - it propagates, no sheet`() = runTest {
        val coordinator = coordinator()
        val internal = ApiException(ApiError.Defined("INTERNAL", 500, null))

        val outcome = runCatching { coordinator.withConfirmation<String> { throw internal } }

        assertEquals(internal, outcome.exceptionOrNull())
        assertNull(coordinator.request.value)
    }

    @Test
    fun `TP-4_35x factor password - request Password, confirm(password) then run once more`() = runTest {
        val coordinator = coordinator()
        val run = Run("password", "done")

        val outcome = async { runCatching { coordinator.withConfirmation(run.block(::confirmationRequired)) } }
        assertEquals(ConfirmFactor.Password, coordinator.request.first { it != null })
        coordinator.submit(password = "violet staircase umbrella")

        assertEquals("done", outcome.await().getOrThrow())
        coVerify(exactly = 1) { repository.confirm("violet staircase umbrella", null, null) }
        assertEquals(2, run.calls.get())
    }

    @Test
    fun `TP-4_35x a recovery code - confirm(recoveryCode) then run once more`() = runTest {
        val coordinator = coordinator()
        val run = Run("two_step", "done")

        val outcome = async { runCatching { coordinator.withConfirmation(run.block(::confirmationRequired)) } }
        coordinator.request.first { it != null }
        coordinator.submit(recoveryCode = "7KQ2M3XD4TRA")

        assertEquals("done", outcome.await().getOrThrow())
        coVerify(exactly = 1) { repository.confirm(null, null, "7KQ2M3XD4TRA") }
    }

    @Test
    fun `TP-4_35x a second CONFIRMATION_REQUIRED after confirming - it propagates, run called twice`() = runTest {
        val coordinator = coordinator()
        val run = Run("two_step", "done", always = true)

        val outcome = async { runCatching { coordinator.withConfirmation(run.block(::confirmationRequired)) } }
        coordinator.request.first { it != null }
        coordinator.submit(code = "123456")

        val error = outcome.await().exceptionOrNull() as ApiException
        assertEquals("CONFIRMATION_REQUIRED", (error.error as ApiError.Defined).key)
        assertEquals(2, run.calls.get())
    }

    @Test
    fun `TP-4_35x a wrong code - twostep_code_wrong shown, the sheet stays open, run not rerun, then a correct code completes`() =
        runTest {
            val coordinator = coordinator()
            coEvery { repository.confirm(null, "111111", null) } throws
                ApiException(ApiError.Defined("TWO_STEP_CODE_INVALID", 400, null))
            val run = Run("two_step", "done")

            val outcome = async { runCatching { coordinator.withConfirmation(run.block(::confirmationRequired)) } }
            coordinator.request.first { it != null }
            coordinator.submit(code = "111111")

            // The LLD names the message, not which of the form's two fields carries it.
            coordinator.form.first { it.error == R.string.twostep_code_wrong || it.formError == UiText(R.string.twostep_code_wrong) }
            runCurrent()
            assertEquals(ConfirmFactor.TwoStep, coordinator.request.value)
            assertFalse("still waiting", outcome.isCompleted)
            assertEquals(1, run.calls.get())

            coordinator.submit(code = "123456")
            assertEquals("done", outcome.await().getOrThrow())
            assertEquals(2, run.calls.get())
        }

    @Test
    fun `TP-4_35x a wrong password - error_invalid_credentials shown, the sheet stays open, run not rerun`() = runTest {
        val coordinator = coordinator()
        coEvery { repository.confirm("wrong", null, null) } throws
            ApiException(ApiError.Defined("INVALID_CREDENTIALS", 401, null))
        val run = Run("password", "done")

        val outcome = async { runCatching { coordinator.withConfirmation(run.block(::confirmationRequired)) } }
        coordinator.request.first { it != null }
        coordinator.submit(password = "wrong")

        coordinator.form.first {
            it.error == R.string.error_invalid_credentials || it.formError == UiText(R.string.error_invalid_credentials)
        }
        runCurrent()
        assertEquals(ConfirmFactor.Password, coordinator.request.value)
        assertFalse("still waiting", outcome.isCompleted)
        assertEquals(1, run.calls.get())
        coordinator.cancel()
        assertNull(outcome.await().getOrThrow())
    }

    @Test
    fun `TP-4_35x two callers while the sheet is open - one sheet, each run once more in call order, each result (A-83)`() = runTest {
        val coordinator = coordinator()
        val order = CopyOnWriteArrayList<String>()
        val first = Run("two_step", "first")
        val second = Run("two_step", "second")
        fun tracked(name: String, run: Run): suspend () -> String {
            val block = run.block(::confirmationRequired)
            return {
                val result = block()
                order += name
                result
            }
        }

        val a = async { runCatching { coordinator.withConfirmation(tracked("a", first)) } }
        coordinator.request.first { it != null }
        val b = async { runCatching { coordinator.withConfirmation(tracked("b", second)) } }
        runCurrent()
        assertEquals("both asked", 1, second.calls.get())
        coordinator.submit(code = "123456")

        assertEquals("first", a.await().getOrThrow())
        assertEquals("second", b.await().getOrThrow())
        coVerify(exactly = 1) { repository.confirm(any(), any(), any()) }
        assertEquals(2, first.calls.get())
        assertEquals(2, second.calls.get())
        assertEquals(listOf("a", "b"), order)
    }

    @Test
    fun `TP-4_35x two callers while the sheet is open, then cancel - both null, neither run again (A-83)`() = runTest {
        val coordinator = coordinator()
        val first = Run("two_step", "first")
        val second = Run("two_step", "second")

        val a = async { runCatching { coordinator.withConfirmation(first.block(::confirmationRequired)) } }
        coordinator.request.first { it != null }
        val b = async { runCatching { coordinator.withConfirmation(second.block(::confirmationRequired)) } }
        runCurrent()
        coordinator.cancel()

        assertNull(a.await().getOrThrow())
        assertNull(b.await().getOrThrow())
        assertEquals(1, first.calls.get())
        assertEquals(1, second.calls.get())
        assertTrue(coordinator.request.value == null)
    }
}

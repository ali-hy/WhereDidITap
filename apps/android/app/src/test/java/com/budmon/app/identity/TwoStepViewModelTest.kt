// F-209 TwoStepViewModel (identity LLD §8.2's S-4 signatures, A-69, A-86, A-99). TP-4.35's
// TwoStepViewModel rows, plus TP-4.35x. The screens are ui/TwoStepScreensTest.
// Setup per TP-4.35: a MockK AuthRepository; the real OutboxOwnerGuard over a MockK OutboxDao
// (`entries`, empty unless a test fills it), a relaxed MockK TokenStore (`owner`) and a relaxed MockK
// OutboxRepository; Dispatchers.setMain(StandardTestDispatcher) so viewModelScope runs on virtual
// time. `log` records commitSignIn, savePassword and onSignedIn in order; `ended` records onEnded.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
package com.budmon.app.identity

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import com.budmon.app.R
import com.budmon.app.core.network.ApiError
import com.budmon.app.core.outbox.OutboxDao
import com.budmon.app.core.outbox.OutboxRepository
import com.budmon.app.identity.store.TokenStore
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
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

private const val EMAIL = "mona@example.com"
private const val PASSWORD = "violet staircase umbrella"

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class TwoStepViewModelTest {
    private val log = mutableListOf<String>()
    private val ended = mutableListOf<TwoStepEndReason>()

    private val repository = mockk<AuthRepository> {
        coEvery { commitSignIn(any()) } answers { log += "commit" }
        coEvery { abandonSignIn(any()) } answers { log += "abandon" }
    }

    /** The outbox's entry count, as countAll() reports it; deleteAll() empties it. */
    private var entries = 0
    private var owner: String? = null
    private val dao = mockk<OutboxDao> {
        coEvery { countAll() } answers { entries }
        coEvery { deleteAll() } answers {
            val n = entries
            entries = 0
            n
        }
    }
    private val tokenStore = mockk<TokenStore>(relaxed = true) { coEvery { outboxOwnerUserId() } answers { owner } }
    private val outbox = mockk<OutboxRepository>(relaxed = true)
    private val guard = OutboxOwnerGuard(dao, tokenStore, outbox, repository)

    private val challenge = TwoStepChallenge(
        token = "bmc_" + "C".repeat(43),
        expiresAt = Instant.parse("2026-11-15T10:05:00Z"),
        email = EMAIL,
        password = PASSWORD,
    )
    private val pending = PendingSignIn(
        session = storedSession(Instant.parse("2026-12-15T10:00:00Z")),
        deviceToken = "bmd_" + "D".repeat(43),
        me = ME,
    )

    private val savePassword: suspend (String, String) -> Unit = { email, password -> log += "save $email $password" }
    private val onSignedIn: (Me) -> Unit = { me -> log += "signedIn ${me.id}" }
    private val onEnded: (TwoStepEndReason) -> Unit = { ended += it }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun TestScope.viewModel(start: TwoStepChallenge = challenge): TwoStepViewModel {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        val vm = TwoStepViewModel(repository, guard)
        vm.start(start)
        advanceUntilIdle()
        return vm
    }

    private fun TestScope.send(vm: TwoStepViewModel, value: String) {
        vm.onValueChange(value)
        vm.submit(savePassword, onSignedIn, onEnded)
        advanceUntilIdle()
    }

    private fun failure(key: String, status: Int, data: kotlinx.serialization.json.JsonObject? = null) =
        ApiException(ApiError.Defined(key, status, data))

    private fun expired(reason: String?) = failure(
        "TWO_STEP_CHALLENGE_EXPIRED",
        401,
        if (reason == null) null else buildJsonObject { put("reason", reason) },
    )

    private fun noRequest() = coVerify(exactly = 0) { repository.verifyTwoStep(any(), any(), any()) }

    // ---- TP-4.35 ----

    @Test
    fun `TP-4_35 a 6-digit code - verifyTwoStep(challenge, 123456, null), stored through the guard, savePassword, then onSignedIn(me)`() =
        runTest {
            coEvery { repository.verifyTwoStep(challenge, "123456", null) } returns TwoStepVerified(pending, null)
            val vm = viewModel()

            send(vm, "123456")

            coVerify(exactly = 1) { repository.verifyTwoStep(challenge, "123456", null) }
            assertEquals(listOf("commit", "save $EMAIL $PASSWORD", "signedIn ${ME.id}"), log)
            verify(exactly = 1) { outbox.kick() }
            assertEquals(emptyList<TwoStepEndReason>(), ended)
        }

    @Test
    fun `TP-4_35 a recovery code via Use a recovery code instead - verifyTwoStep(challenge, null, 7KQ2M3XD4TRA)`() = runTest {
        coEvery { repository.verifyTwoStep(challenge, null, "7KQ2M3XD4TRA") } returns TwoStepVerified(pending, 9)
        val vm = viewModel()

        vm.toggleRecovery()
        assertTrue(vm.form.useRecovery)
        send(vm, "7KQ2M3XD4TRA")

        coVerify(exactly = 1) { repository.verifyTwoStep(challenge, null, "7KQ2M3XD4TRA") }
        assertEquals(listOf("commit", "save $EMAIL $PASSWORD", "signedIn ${ME.id}"), log)
    }

    @Test
    fun `TP-4_35 a wrong code - error twostep_code_wrong, value cleared, busy false, not signed in or ended`() = runTest {
        coEvery { repository.verifyTwoStep(challenge, "111111", null) } throws
            failure("TWO_STEP_CODE_INVALID", 400, buildJsonObject { put("attemptsLeft", 4) })
        val vm = viewModel()

        send(vm, "111111")

        assertEquals(R.string.twostep_code_wrong, vm.form.error)
        assertEquals("", vm.form.value)
        assertEquals(false, vm.form.busy)
        assertEquals(emptyList<String>(), log)
        assertEquals(emptyList<TwoStepEndReason>(), ended)
    }

    @Test
    fun `TP-4_35 TWO_STEP_CHALLENGE_EXPIRED with reason too_many_attempts - onEnded(TooManyAttempts) once`() = runTest {
        coEvery { repository.verifyTwoStep(challenge, "111111", null) } throws expired("too_many_attempts")
        val vm = viewModel()

        send(vm, "111111")

        assertEquals(listOf(TwoStepEndReason.TooManyAttempts), ended)
        assertEquals(emptyList<String>(), log)
    }

    @Test
    fun `TP-4_35 TWO_STEP_CHALLENGE_EXPIRED with reason expired - onEnded(Expired) once`() = runTest {
        coEvery { repository.verifyTwoStep(challenge, "111111", null) } throws expired("expired")
        val vm = viewModel()

        send(vm, "111111")

        assertEquals(listOf(TwoStepEndReason.Expired), ended)
        assertEquals(emptyList<String>(), log)
    }

    // ---- additions: client rules (F-156) ----

    @Test
    fun `TP-4_35x TWO_STEP_CHALLENGE_EXPIRED without data - onEnded(Expired)`() = runTest {
        coEvery { repository.verifyTwoStep(challenge, "111111", null) } throws expired(null)
        val vm = viewModel()

        send(vm, "111111")

        assertEquals(listOf(TwoStepEndReason.Expired), ended)
    }

    @Test
    fun `TP-4_35x 5 digits - error twostep_code_invalid, no request`() = runTest {
        val vm = viewModel()

        send(vm, "12345")

        assertEquals(R.string.twostep_code_invalid, vm.form.error)
        noRequest()
    }

    @Test
    fun `TP-4_35x 6 characters with a letter - error twostep_code_invalid, no request`() = runTest {
        val vm = viewModel()

        send(vm, "12345a")

        assertEquals(R.string.twostep_code_invalid, vm.form.error)
        noRequest()
    }

    @Test
    fun `TP-4_35x 6 digits with a space - passes the client rule, one code request, no error`() = runTest {
        coEvery { repository.verifyTwoStep(challenge, any(), null) } returns TwoStepVerified(pending, null)
        val vm = viewModel()

        send(vm, "123 456")

        coVerify(exactly = 1) { repository.verifyTwoStep(challenge, any(), null) }
        assertNull(vm.form.error)
    }

    @Test
    fun `TP-4_35x a recovery code with a 9 - error twostep_recovery_invalid, no request (A-99)`() = runTest {
        val vm = viewModel()
        vm.toggleRecovery()

        send(vm, "7KQ2-M3XD-4TR9")

        assertEquals(R.string.twostep_recovery_invalid, vm.form.error)
        noRequest()
    }

    @Test
    fun `TP-4_35x a recovery code of 8 characters - error twostep_recovery_invalid, no request`() = runTest {
        val vm = viewModel()
        vm.toggleRecovery()

        send(vm, "7KQ2-M3XD")

        assertEquals(R.string.twostep_recovery_invalid, vm.form.error)
        noRequest()
    }

    @Test
    fun `TP-4_35x a recovery code with dashes - passes the client rule, one recovery request, no error`() = runTest {
        coEvery { repository.verifyTwoStep(challenge, null, any()) } returns TwoStepVerified(pending, 9)
        val vm = viewModel()
        vm.toggleRecovery()

        send(vm, "7KQ2-M3XD-4TRA")

        coVerify(exactly = 1) { repository.verifyTwoStep(challenge, null, any()) }
        assertNull(vm.form.error)
    }

    // ---- additions: start, savePassword, the owner dialog (A-69, A-86) ----

    @Test
    fun `TP-4_35x start(another challenge) after a wrong code - the form cleared, the next request uses the new challenge`() = runTest {
        val second = challenge.copy(token = "bmc_" + "E".repeat(43))
        coEvery { repository.verifyTwoStep(challenge, "111111", null) } throws failure("TWO_STEP_CODE_INVALID", 400)
        coEvery { repository.verifyTwoStep(second, "123456", null) } returns TwoStepVerified(pending, null)
        val vm = viewModel()
        send(vm, "111111")
        vm.toggleRecovery()
        vm.onValueChange("7KQ2")

        vm.start(second)
        advanceUntilIdle()

        assertEquals(false, vm.form.useRecovery)
        assertEquals("", vm.form.value)
        assertNull(vm.form.error)
        assertNull(vm.form.formError)
        assertEquals(false, vm.form.busy)
        assertNull(vm.form.ownerDialog)
        send(vm, "123456")
        coVerify(exactly = 1) { repository.verifyTwoStep(second, "123456", null) }
    }

    @Test
    fun `TP-4_35x a challenge with no password - savePassword not called, onSignedIn(me)`() = runTest {
        val noPassword = challenge.copy(password = null)
        coEvery { repository.verifyTwoStep(noPassword, "123456", null) } returns TwoStepVerified(pending, null)
        val vm = viewModel(start = noPassword)

        send(vm, "123456")

        assertEquals(listOf("commit", "signedIn ${ME.id}"), log)
    }

    @Test
    fun `TP-4_35x 2 entries of another user - ownerDialog 2, nothing stored or signed in`() = runTest {
        entries = 2
        owner = "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a77"
        coEvery { repository.verifyTwoStep(challenge, "123456", null) } returns TwoStepVerified(pending, null)
        val vm = viewModel()

        send(vm, "123456")

        assertEquals(2, vm.form.ownerDialog)
        assertEquals(emptyList<String>(), log)
    }

    @Test
    fun `TP-4_35x ownerDialog then discardOtherUsersEntries - entries deleted, stored, savePassword, onSignedIn, ownerDialog null`() =
        runTest {
            entries = 2
            owner = "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a77"
            coEvery { repository.verifyTwoStep(challenge, "123456", null) } returns TwoStepVerified(pending, null)
            val vm = viewModel()
            send(vm, "123456")

            vm.discardOtherUsersEntries(savePassword, onSignedIn, onEnded)
            advanceUntilIdle()

            coVerify(exactly = 1) { dao.deleteAll() }
            assertEquals(listOf("commit", "save $EMAIL $PASSWORD", "signedIn ${ME.id}"), log)
            assertNull(vm.form.ownerDialog)
        }

    @Test
    fun `TP-4_35x ownerDialog then keepOtherUsersEntries - the pending sign-in abandoned once, ownerDialog null, not signed in`() = runTest {
        entries = 2
        owner = "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a77"
        coEvery { repository.verifyTwoStep(challenge, "123456", null) } returns TwoStepVerified(pending, null)
        val vm = viewModel()
        send(vm, "123456")

        vm.keepOtherUsersEntries()
        advanceUntilIdle()

        coVerify(exactly = 1) { repository.abandonSignIn(pending) }
        coVerify(exactly = 0) { dao.deleteAll() }
        assertNull(vm.form.ownerDialog)
        assertFalse("not signed in", log.any { it.startsWith("signedIn") })
    }

    @Test
    fun `TP-4_35x the view model cleared while ownerDialog is shown - the pending sign-in released (A-86)`() = runTest {
        entries = 2
        owner = "0190a0b0-1c2d-7e3f-8a4b-5c6d7e8f9a77"
        coEvery { repository.verifyTwoStep(challenge, "123456", null) } returns TwoStepVerified(pending, null)
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        val store = ViewModelStore()
        val factory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T = TwoStepViewModel(repository, guard) as T
        }
        val vm = ViewModelProvider(store, factory)[TwoStepViewModel::class.java]
        vm.start(challenge)
        send(vm, "123456")
        assertEquals(2, vm.form.ownerDialog)

        store.clear()

        // release() cancels on the guard's own IO scope, outside virtual time.
        coVerify(timeout = 5_000, exactly = 1) { repository.abandonSignIn(pending) }
    }
}

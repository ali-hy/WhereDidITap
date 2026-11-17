// F-208 SignInViewModel (identity LLD §4.15, §8.2's S-3 signatures, A-70, A-75). TP-3.57's
// SignInViewModel rows (with A-86's), plus TP-3.57x. The screens are SignInSignOutScreensTest.
// Setup per TP-3.57: a MockK AuthRepository and a relaxed MockK OutboxOwnerGuard; a MockK TokenStore
// whose lastEmail() is null unless a test says otherwise; Dispatchers.setMain(StandardTestDispatcher)
// so viewModelScope runs on virtual time. `log` records savePassword and onSignedIn in order.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
package com.budmon.app.identity

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import com.budmon.app.R
import com.budmon.app.core.error.Operation
import com.budmon.app.core.error.UiText
import com.budmon.app.core.network.ApiError
import com.budmon.app.identity.store.TokenStore
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.time.Instant

private const val EMAIL = "mona@example.com"
private const val PASSWORD = "violet staircase umbrella"

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class SignInViewModelTest {
    private val repository = mockk<AuthRepository>()
    private val guard = mockk<OutboxOwnerGuard>(relaxed = true)
    private val tokenStore = mockk<TokenStore> { coEvery { lastEmail() } returns null }
    private val pending = PendingSignIn(
        session = storedSession(Instant.parse("2026-12-15T10:00:00Z")),
        deviceToken = "bmd_" + "D".repeat(43),
        me = ME,
    )

    private val log = mutableListOf<String>()
    private val savePassword: suspend (String, String) -> Unit = { email, password -> log += "save $email $password" }
    private val onSignedIn: (Me) -> Unit = { me -> log += "signedIn ${me.id}" }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun TestScope.viewModel(): SignInViewModel {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        return SignInViewModel(repository, guard, tokenStore).also { advanceUntilIdle() }
    }

    private fun TestScope.submitted(email: String, password: String, isOnline: Boolean = true): SignInViewModel {
        val vm = viewModel()
        vm.onEmailChange(email)
        vm.onPasswordChange(password)
        vm.submit(isOnline, savePassword, onSignedIn)
        advanceUntilIdle()
        return vm
    }

    private fun noRequest() = coVerify(exactly = 0) { repository.signIn(any(), any()) }

    // ---- client rules: no request ----

    @Test
    fun `TP-3_57 a blank email - emailError form_email_required, no repository call`() = runTest {
        val vm = submitted("   ", PASSWORD)

        assertEquals(R.string.form_email_required, vm.form.emailError)
        noRequest()
    }

    @Test
    fun `TP-3_57 a as the email - emailError form_email_invalid, no repository call`() = runTest {
        val vm = submitted("a", PASSWORD)

        assertEquals(R.string.form_email_invalid, vm.form.emailError)
        noRequest()
    }

    @Test
    fun `TP-3_57 an empty password - passwordError form_password_required, no repository call`() = runTest {
        val vm = submitted(EMAIL, "")

        assertEquals(R.string.form_password_required, vm.form.passwordError)
        assertNull(vm.form.emailError)
        noRequest()
    }

    @Test
    fun `TP-3_57 offline - formError signin_offline, no repository call`() = runTest {
        val vm = submitted(EMAIL, PASSWORD, isOnline = false)

        assertEquals(UiText(R.string.signin_offline), vm.form.formError)
        noRequest()
    }

    // ---- server answers ----

    @Test
    fun `TP-3_57 INVALID_CREDENTIALS - formError error_invalid_credentials, not signed in`() = runTest {
        coEvery { repository.signIn(EMAIL, PASSWORD) } throws ApiException(ApiError.Defined("INVALID_CREDENTIALS", 401, null))

        val vm = submitted(EMAIL, PASSWORD)

        assertEquals(UiText(R.string.error_invalid_credentials), vm.form.formError)
        assertEquals(false, vm.form.busy)
        assertEquals(emptyList<String>(), log)
        coVerify(exactly = 0) { guard.complete(any()) }
    }

    @Test
    fun `TP-3_57x INTERNAL - formError error_generic_read (Operation Read, A-75)`() = runTest {
        coEvery { repository.signIn(EMAIL, PASSWORD) } throws ApiException(ApiError.Defined("INTERNAL", 500, null))

        val vm = submitted(EMAIL, PASSWORD)

        assertEquals(UiText(R.string.error_generic_read), vm.form.formError)
    }

    @Test
    fun `TP-3_57 TwoStepRequired - formError error_generic_read, the guard not called`() = runTest {
        coEvery { repository.signIn(EMAIL, PASSWORD) } returns
            SignInOutcome.TwoStepRequired("bmc_" + "C".repeat(43), Instant.parse("2026-11-15T10:05:00Z"))

        val vm = submitted(EMAIL, PASSWORD)

        assertEquals(UiText(R.string.error_generic_read), vm.form.formError)
        assertEquals(emptyList<String>(), log)
        coVerify(exactly = 0) { guard.complete(any()) }
    }

    @Test
    fun `TP-3_57 Ready then Proceed - savePassword(email, password) once, then onSignedIn(me), password cleared`() = runTest {
        coEvery { repository.signIn(EMAIL, PASSWORD) } returns SignInOutcome.Ready(pending)
        coEvery { guard.complete(pending) } returns OwnerDecision.Proceed

        val vm = submitted(EMAIL, PASSWORD)

        assertEquals(listOf("save $EMAIL $PASSWORD", "signedIn ${ME.id}"), log)
        assertEquals("", vm.form.password)
        coVerify(exactly = 1) { repository.signIn(EMAIL, PASSWORD) }
    }

    @Test
    fun `TP-3_57 Ready then AskDiscard(3) - ownerDialog 3, discardOtherUsersEntries - discardAndProceed, then as Proceed - savePassword once, ownerDialog null, password cleared, onSignedIn`() = runTest {
        coEvery { repository.signIn(EMAIL, PASSWORD) } returns SignInOutcome.Ready(pending)
        coEvery { guard.complete(pending) } returns OwnerDecision.AskDiscard(3)

        val vm = submitted(EMAIL, PASSWORD)

        assertEquals(3, vm.form.ownerDialog)
        assertEquals("nothing saved or signed in while asking", emptyList<String>(), log)

        vm.discardOtherUsersEntries(savePassword, onSignedIn)
        advanceUntilIdle()

        // A-77: from here it behaves as Proceed.
        coVerify(exactly = 1) { guard.discardAndProceed(pending) }
        assertEquals(listOf("save $EMAIL $PASSWORD", "signedIn ${ME.id}"), log)
        assertNull(vm.form.ownerDialog)
        assertEquals("", vm.form.password)
    }

    @Test
    fun `TP-3_57 Ready then AskDiscard(3), then keepOtherUsersEntries - cancel called, ownerDialog null, the form stays, password cleared`() =
        runTest {
            coEvery { repository.signIn(EMAIL, PASSWORD) } returns SignInOutcome.Ready(pending)
            coEvery { guard.complete(pending) } returns OwnerDecision.AskDiscard(3)
            val vm = submitted(EMAIL, PASSWORD)

            vm.keepOtherUsersEntries()
            advanceUntilIdle()

            coVerify(exactly = 1) { guard.cancel(pending) }
            coVerify(exactly = 0) { guard.discardAndProceed(any()) }
            assertNull(vm.form.ownerDialog)
            assertEquals(EMAIL, vm.form.email)
            assertEquals("", vm.form.password)
            assertEquals(emptyList<String>(), log)
        }

    @Test
    fun `TP-3_57 a savePassword that throws - onSignedIn still called`() = runTest {
        coEvery { repository.signIn(EMAIL, PASSWORD) } returns SignInOutcome.Ready(pending)
        coEvery { guard.complete(pending) } returns OwnerDecision.Proceed
        val throwing: suspend (String, String) -> Unit = { _, _ -> throw IllegalStateException("no credential provider") }
        val vm = viewModel()
        vm.onEmailChange(EMAIL)
        vm.onPasswordChange(PASSWORD)

        vm.submit(true, throwing, onSignedIn)
        advanceUntilIdle()

        assertEquals(listOf("signedIn ${ME.id}"), log)
    }

    // ---- additions ----

    @Test
    fun `TP-3_57x the email is prefilled from tokenStore lastEmail() in init`() = runTest {
        coEvery { tokenStore.lastEmail() } returns EMAIL

        val vm = viewModel()

        assertEquals(EMAIL, vm.form.email)
        assertEquals("", vm.form.password)
    }

    @Test
    fun `TP-3_57x submit is ignored while busy - one sign-in request, busy until it answers`() = runTest {
        coEvery { repository.signIn(EMAIL, PASSWORD) } coAnswers {
            delay(1_000)
            throw ApiException(ApiError.Defined("INVALID_CREDENTIALS", 401, null))
        }
        val vm = viewModel()
        vm.onEmailChange(EMAIL)
        vm.onPasswordChange(PASSWORD)

        vm.submit(true, savePassword, onSignedIn)
        runCurrent()
        assertEquals(true, vm.form.busy)
        vm.submit(true, savePassword, onSignedIn)
        advanceUntilIdle()

        coVerify(exactly = 1) { repository.signIn(EMAIL, PASSWORD) }
        assertEquals(false, vm.form.busy)
    }

    // ---- A-86: release, double taps, Back, unexpected exceptions ----

    /** A view model in [store] (so clearing the store runs onCleared), asking about 3 entries. */
    private fun TestScope.askingIn(store: ViewModelStore): SignInViewModel {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        coEvery { repository.signIn(EMAIL, PASSWORD) } returns SignInOutcome.Ready(pending)
        coEvery { guard.complete(pending) } returns OwnerDecision.AskDiscard(3)
        val factory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T = SignInViewModel(repository, guard, tokenStore) as T
        }
        val vm = ViewModelProvider(store, factory)[SignInViewModel::class.java]
        advanceUntilIdle()
        vm.onEmailChange(EMAIL)
        vm.onPasswordChange(PASSWORD)
        vm.submit(true, savePassword, onSignedIn)
        advanceUntilIdle()
        assertEquals(3, vm.form.ownerDialog)
        return vm
    }

    @Test
    fun `TP-3_57 Delete and continue tapped twice quickly - discardAndProceed once (A-86)`() = runTest {
        val vm = askingIn(ViewModelStore())
        val gate = CompletableDeferred<Unit>()
        coEvery { guard.discardAndProceed(pending) } coAnswers { gate.await() }

        vm.discardOtherUsersEntries(savePassword, onSignedIn)
        runCurrent()
        vm.discardOtherUsersEntries(savePassword, onSignedIn)
        runCurrent()
        gate.complete(Unit)
        advanceUntilIdle()

        coVerify(exactly = 1) { guard.discardAndProceed(pending) }
        assertEquals(listOf("save $EMAIL $PASSWORD", "signedIn ${ME.id}"), log)
    }

    @Test
    fun `TP-3_57 the view model cleared while ownerDialog is shown - guard release(pending) once (A-86)`() = runTest {
        val store = ViewModelStore()
        askingIn(store)

        store.clear()
        advanceUntilIdle()

        verify(exactly = 1) { guard.release(pending) }
        assertEquals(emptyList<String>(), log)
    }

    @Test
    fun `TP-3_57x the view model cleared after a Proceed - nothing to release (A-86)`() = runTest {
        val store = ViewModelStore()
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        coEvery { repository.signIn(EMAIL, PASSWORD) } returns SignInOutcome.Ready(pending)
        coEvery { guard.complete(pending) } returns OwnerDecision.Proceed
        val factory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T = SignInViewModel(repository, guard, tokenStore) as T
        }
        val vm = ViewModelProvider(store, factory)[SignInViewModel::class.java]
        vm.onEmailChange(EMAIL)
        vm.onPasswordChange(PASSWORD)
        vm.submit(true, savePassword, onSignedIn)
        advanceUntilIdle()

        store.clear()
        advanceUntilIdle()

        verify(exactly = 0) { guard.release(any()) }
    }

    @Test
    fun `TP-3_57 the owner dialog dismissed (Back is Cancel), dismissed twice quickly - cancel once, ownerDialog null (A-86)`() = runTest {
        val vm = askingIn(ViewModelStore())
        val gate = CompletableDeferred<Unit>()
        coEvery { guard.cancel(pending) } coAnswers { gate.await() }

        vm.keepOtherUsersEntries()
        runCurrent()
        vm.keepOtherUsersEntries()
        runCurrent()
        gate.complete(Unit)
        advanceUntilIdle()

        coVerify(exactly = 1) { guard.cancel(pending) }
        coVerify(exactly = 0) { guard.discardAndProceed(any()) }
        assertNull(vm.form.ownerDialog)
        assertEquals(emptyList<String>(), log)
    }

    @Test
    fun `TP-3_57 repository signIn throwing IllegalStateException - formError F-220's Unknown text, busy false (A-86)`() = runTest {
        coEvery { repository.signIn(EMAIL, PASSWORD) } throws IllegalStateException("unexpected")

        val vm = submitted(EMAIL, PASSWORD)

        assertEquals(IdentityErrorMessages.forError(ApiError.Unknown, Operation.Read), vm.form.formError)
        assertEquals(false, vm.form.busy)
        assertEquals(emptyList<String>(), log)
    }
}

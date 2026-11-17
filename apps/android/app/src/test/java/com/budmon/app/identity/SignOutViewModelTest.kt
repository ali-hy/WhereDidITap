// F-218 SignOutViewModel (identity LLD §4.15, §8.2's S-3 signatures, A-71). TP-3.57's
// SignOutViewModel rows, plus TP-3.57x. The dialog is SignInSignOutScreensTest.
// Setup per TP-3.57: a relaxed MockK AuthRepository, a MockK OutboxDao whose countAll() is
// `entries`, a relaxed MockK OutboxRepository; Dispatchers.setMain(StandardTestDispatcher).
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
package com.budmon.app.identity

import com.budmon.app.R
import com.budmon.app.core.error.UiText
import com.budmon.app.core.network.ApiError
import com.budmon.app.core.outbox.OutboxDao
import com.budmon.app.core.outbox.OutboxRepository
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import io.mockk.verify
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
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class SignOutViewModelTest {
    private val repository = mockk<AuthRepository>(relaxed = true)
    private var entries = 0
    private val dao = mockk<OutboxDao>(relaxed = true) { coEvery { countAll() } answers { entries } }
    private val outbox = mockk<OutboxRepository>(relaxed = true)
    private var signedOut = 0
    private val onSignedOut: () -> Unit = { signedOut += 1 }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun TestScope.viewModel(): SignOutViewModel {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        return SignOutViewModel(repository, dao, outbox)
    }

    @Test
    fun `TP-3_57 0 entries - signed out at once, Idle, then onSignedOut`() = runTest {
        val vm = viewModel()
        var stateAtCallback: SignOutState? = null

        vm.requestSignOut {
            stateAtCallback = vm.state
            onSignedOut()
        }
        advanceUntilIdle()

        coVerify(exactly = 1) { repository.signOut() }
        assertEquals(1, signedOut)
        // A-77: Idle before onSignedOut runs, and it stays Idle.
        assertEquals(SignOutState.Idle, stateAtCallback)
        assertEquals(SignOutState.Idle, vm.state)
    }

    @Test
    fun `TP-3_57 2 entries then Sync now - Confirming(2), then kick and Idle, no sign-out`() = runTest {
        entries = 2
        val vm = viewModel()

        vm.requestSignOut(onSignedOut)
        advanceUntilIdle()
        assertEquals(SignOutState.Confirming(2), vm.state)
        coVerify(exactly = 0) { repository.signOut() }

        vm.syncNow()
        advanceUntilIdle()

        verify(exactly = 1) { outbox.kick() }
        assertEquals(SignOutState.Idle, vm.state)
        coVerify(exactly = 0) { repository.signOut() }
        assertEquals(0, signedOut)
    }

    @Test
    fun `TP-3_57 2 entries then Sign out anyway - signOut, Idle, then onSignedOut, entries left`() = runTest {
        entries = 2
        val vm = viewModel()
        var stateAtCallback: SignOutState? = null
        vm.requestSignOut(onSignedOut)
        advanceUntilIdle()

        vm.signOutAnyway {
            stateAtCallback = vm.state
            onSignedOut()
        }
        advanceUntilIdle()

        coVerify(exactly = 1) { repository.signOut() }
        assertEquals(1, signedOut)
        assertEquals(SignOutState.Idle, stateAtCallback)
        assertEquals(SignOutState.Idle, vm.state)
        coVerify(exactly = 0) { dao.deleteAll() }
        verify(exactly = 0) { outbox.kick() }
    }

    @Test
    fun `TP-3_57 sign-out failing - Failed(the F-220 mutation text), no onSignedOut`() = runTest {
        coEvery { repository.signOut() } throws ApiException(ApiError.Defined("INTERNAL", 500, null))
        val vm = viewModel()

        vm.requestSignOut(onSignedOut)
        advanceUntilIdle()

        // Operation.Mutation: INTERNAL reads "couldn't confirm" (Read would be error_generic_read).
        assertEquals(SignOutState.Failed(UiText(R.string.error_generic_unknown_outcome)), vm.state)
        assertEquals(0, signedOut)
    }

    // ---- additions ----

    @Test
    fun `TP-3_57x dismiss while Confirming - Idle, no sign-out and no kick`() = runTest {
        entries = 2
        val vm = viewModel()
        vm.requestSignOut(onSignedOut)
        advanceUntilIdle()

        vm.dismiss()
        advanceUntilIdle()

        assertEquals(SignOutState.Idle, vm.state)
        coVerify(exactly = 0) { repository.signOut() }
        verify(exactly = 0) { outbox.kick() }
        assertEquals(0, signedOut)
    }

    @Test
    fun `TP-3_57x Busy while the sign-out runs`() = runTest {
        coEvery { repository.signOut() } coAnswers { delay(1_000) }
        val vm = viewModel()

        vm.requestSignOut(onSignedOut)
        runCurrent()
        assertEquals(SignOutState.Busy, vm.state)
        advanceUntilIdle()

        assertEquals(1, signedOut)
    }
}

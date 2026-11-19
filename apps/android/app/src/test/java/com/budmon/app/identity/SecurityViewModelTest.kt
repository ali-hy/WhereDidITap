// F-214 SecurityViewModel (identity LLD §8.2's S-4 signatures, A-100, A-101, A-102). TP-4.41 rows
// (a) to (e), plus TP-4.41x. Row (f), SessionViewModel.onMeUpdated, is in SessionViewModelTest.
// Setup per TP-4.41: a MockK AuthRepository; the real ConfirmationCoordinator around it; a recording
// onMeUpdated; Dispatchers.setMain(StandardTestDispatcher) so viewModelScope runs on virtual time.
// Errors use Operation.Mutation (A-102).
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
package com.budmon.app.identity

import com.budmon.app.R
import com.budmon.app.core.error.ErrorMessages
import com.budmon.app.core.error.Operation
import com.budmon.app.core.error.UiText
import com.budmon.app.core.network.ApiError
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.just
import io.mockk.mockk
import io.mockk.runs
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
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class SecurityViewModelTest {
    /** What getMe() answers after a change: two-step now off. */
    private val meAfter = ME.copy(twoStepEnabled = false, recoveryCodesLeft = 0, codesAcknowledged = true)
    private val codes = "ABCDEFGHJK".map { "7KQ2-M3XD-4TR$it" }

    private val repository = mockk<AuthRepository> {
        coEvery { getMe() } returns meAfter
        coEvery { twoStepDisable(any(), any()) } just runs
        coEvery { regenerateRecoveryCodes() } returns codes
        coEvery { acknowledgeRecoveryCodes() } just runs
    }

    /** Every me passed to onMeUpdated, in order. */
    private val updates = mutableListOf<Me>()
    private val onMeUpdated: (Me) -> Unit = { updates += it }

    private lateinit var coordinator: ConfirmationCoordinator

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun TestScope.viewModel(): SecurityViewModel {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        coordinator = ConfirmationCoordinator(repository)
        return SecurityViewModel(repository, coordinator)
    }

    private fun failure(key: String, status: Int, data: kotlinx.serialization.json.JsonObject? = null) =
        ApiException(ApiError.Defined(key, status, data))

    private val SecurityViewModel.turnOff: TurnOffFormState? get() = state.value.turnOff

    /** Opens the Turn off dialog, types [value] (after switching to a recovery code if asked) and submits. */
    private fun TestScope.turnOffWith(vm: SecurityViewModel, value: String, recovery: Boolean = false) {
        vm.openTurnOff()
        if (recovery) vm.toggleTurnOffRecovery()
        vm.onTurnOffValueChange(value)
        vm.submitTurnOff(onMeUpdated)
        advanceUntilIdle()
    }

    private fun noDisable() = coVerify(exactly = 0) { repository.twoStepDisable(any(), any()) }

    /** Shows the regenerated codes (createNewCodes with no step-up needed). */
    private fun TestScope.showNewCodes(vm: SecurityViewModel) {
        vm.createNewCodes()
        advanceUntilIdle()
        assertEquals(codes, vm.state.value.newCodes)
    }

    // ---- (a) Turn off: client rules, normalised values, success ----

    @Test
    fun `TP-4_41 (a) openTurnOff - a fresh TurnOffFormState`() = runTest {
        val vm = viewModel()
        assertNull(vm.turnOff)

        vm.openTurnOff()

        assertEquals(TurnOffFormState(), vm.turnOff)
    }

    @Test
    fun `TP-4_41 (a) submitTurnOff with 12345 - error twostep_code_invalid, no request`() = runTest {
        val vm = viewModel()

        turnOffWith(vm, "12345")

        assertEquals(R.string.twostep_code_invalid, vm.turnOff?.error)
        noDisable()
        assertTrue(updates.isEmpty())
    }

    @Test
    fun `TP-4_41 (a) submitTurnOff with 123 456 - twoStepDisable(123456, null), turnOff null, message twostep_off_done, getMe, onMeUpdated(me)`() =
        runTest {
            val vm = viewModel()

            turnOffWith(vm, "123 456")

            coVerify(exactly = 1) { repository.twoStepDisable("123456", null) }
            coVerify(exactly = 1) { repository.twoStepDisable(any(), any()) }
            assertNull(vm.turnOff)
            assertEquals(UiText(R.string.twostep_off_done), vm.state.value.message)
            coVerify(exactly = 1) { repository.getMe() }
            assertEquals(listOf(meAfter), updates)
        }

    @Test
    fun `TP-4_41 (a) submitTurnOff with recovery code 7kq2-m3xd 4tra - twoStepDisable(null, 7KQ2M3XD4TRA)`() = runTest {
        val vm = viewModel()

        turnOffWith(vm, "7kq2-m3xd 4tra", recovery = true)

        coVerify(exactly = 1) { repository.twoStepDisable(null, "7KQ2M3XD4TRA") }
        coVerify(exactly = 1) { repository.twoStepDisable(any(), any()) }
        assertNull(vm.turnOff)
        assertEquals(UiText(R.string.twostep_off_done), vm.state.value.message)
        assertEquals(listOf(meAfter), updates)
    }

    @Test
    fun `TP-4_41x submitTurnOff with recovery code 7KQ2-M3XD - error twostep_recovery_invalid, no request`() = runTest {
        val vm = viewModel()

        turnOffWith(vm, "7KQ2-M3XD", recovery = true)

        assertEquals(R.string.twostep_recovery_invalid, vm.turnOff?.error)
        noDisable()
    }

    // ---- (b) Turn off: errors, busy ----

    @Test
    fun `TP-4_41 (b) TWO_STEP_CODE_INVALID - error twostep_code_wrong, value empty, busy false, dialog stays`() = runTest {
        coEvery { repository.twoStepDisable("111111", null) } throws failure("TWO_STEP_CODE_INVALID", 400)
        val vm = viewModel()

        turnOffWith(vm, "111111")

        val form = vm.turnOff
        assertNotNull("the dialog stays", form)
        assertEquals(R.string.twostep_code_wrong, form!!.error)
        assertEquals("", form.value)
        assertEquals(false, form.busy)
        assertNull(vm.state.value.message)
        assertTrue(updates.isEmpty())
    }

    @Test
    fun `TP-4_41 (b) RATE_LIMITED on a code - formError the platform's rate-limit text, showRecoveryHint true, busy false`() = runTest {
        val limited = ApiError.Defined("RATE_LIMITED", 429, buildJsonObject { put("retryAfterSeconds", 120) })
        coEvery { repository.twoStepDisable("111111", null) } throws ApiException(limited)
        val vm = viewModel()

        turnOffWith(vm, "111111")

        val form = vm.turnOff!!
        assertEquals(ErrorMessages.forError(limited, Operation.Read), form.formError)
        assertTrue(form.showRecoveryHint)
        assertEquals(false, form.busy)
    }

    @Test
    fun `TP-4_41 (b) TWO_STEP_NOT_ENABLED - turnOff null, getMe called, onMeUpdated(me), message null`() = runTest {
        coEvery { repository.twoStepDisable("123456", null) } throws failure("TWO_STEP_NOT_ENABLED", 409)
        val vm = viewModel()

        turnOffWith(vm, "123456")

        assertNull(vm.turnOff)
        coVerify(exactly = 1) { repository.getMe() }
        assertEquals(listOf(meAfter), updates)
        assertNull(vm.state.value.message)
    }

    @Test
    fun `TP-4_41 (b) twoStepDisable throwing IllegalStateException - formError ApiError Unknown's text, busy false`() = runTest {
        coEvery { repository.twoStepDisable("123456", null) } throws IllegalStateException("unexpected")
        val vm = viewModel()

        turnOffWith(vm, "123456")

        val form = vm.turnOff!!
        assertEquals(IdentityErrorMessages.forError(ApiError.Unknown, Operation.Mutation), form.formError)
        assertEquals(false, form.busy)
        assertTrue(updates.isEmpty())
    }

    @Test
    fun `TP-4_41 (b) two submitTurnOff calls while busy - one twoStepDisable call, busy false after`() = runTest {
        coEvery { repository.twoStepDisable("123456", null) } coAnswers { delay(1_000) }
        val vm = viewModel()
        vm.openTurnOff()
        vm.onTurnOffValueChange("123456")

        vm.submitTurnOff(onMeUpdated)
        runCurrent()
        assertEquals("busy while the request runs", true, vm.turnOff?.busy)
        vm.submitTurnOff(onMeUpdated)
        advanceUntilIdle()

        coVerify(exactly = 1) { repository.twoStepDisable(any(), any()) }
        assertNull("succeeded once", vm.turnOff)
        assertEquals(listOf(meAfter), updates)
    }

    @Test
    fun `TP-4_41x another ApiError (INTERNAL) - formError F-220's text for a write, busy false`() = runTest {
        val internal = ApiError.Defined("INTERNAL", 500, null)
        coEvery { repository.twoStepDisable("123456", null) } throws ApiException(internal)
        val vm = viewModel()

        turnOffWith(vm, "123456")

        val form = vm.turnOff!!
        assertEquals(IdentityErrorMessages.forError(internal, Operation.Mutation), form.formError)
        assertEquals(false, form.busy)
    }

    @Test
    fun `TP-4_41x toggleTurnOffRecovery after a rate limit - useRecovery flips, value, error, formError and the hint cleared`() = runTest {
        val limited = ApiError.Defined("RATE_LIMITED", 429, null)
        coEvery { repository.twoStepDisable("111111", null) } throws ApiException(limited)
        val vm = viewModel()
        turnOffWith(vm, "111111")
        val before = vm.turnOff!!
        assertNotNull(before.formError)
        assertTrue(before.showRecoveryHint)

        vm.toggleTurnOffRecovery()

        assertEquals(TurnOffFormState(useRecovery = true), vm.turnOff)
    }

    @Test
    fun `TP-4_41x dismissTurnOff - turnOff null, ignored while busy`() = runTest {
        coEvery { repository.twoStepDisable("123456", null) } coAnswers { delay(1_000) }
        val vm = viewModel()
        vm.openTurnOff()
        vm.dismissTurnOff()
        assertNull(vm.turnOff)

        vm.openTurnOff()
        vm.onTurnOffValueChange("123456")
        vm.submitTurnOff(onMeUpdated)
        runCurrent()
        vm.dismissTurnOff()

        assertEquals("ignored while busy", true, vm.turnOff?.busy)
        advanceUntilIdle()
    }

    // ---- (c) Create new codes ----

    @Test
    fun `TP-4_41 (c) createNewCodes with ten codes - newCodes the ten codes, acknowledged false`() = runTest {
        val vm = viewModel()

        vm.createNewCodes()
        advanceUntilIdle()

        assertEquals(codes, vm.state.value.newCodes)
        assertEquals(false, vm.state.value.acknowledged)
        assertEquals(false, vm.state.value.busy)
        coVerify(exactly = 1) { repository.regenerateRecoveryCodes() }
    }

    @Test
    fun `TP-4_41 (c) createNewCodes needing confirmation, then cancelled - newCodes null, one regenerate call`() = runTest {
        coEvery { repository.regenerateRecoveryCodes() } throws
            failure("CONFIRMATION_REQUIRED", 403, buildJsonObject { put("factor", "password") })
        val vm = viewModel()

        vm.createNewCodes()
        advanceUntilIdle()
        assertEquals(ConfirmFactor.Password, coordinator.request.value)
        coordinator.cancel()
        advanceUntilIdle()

        assertNull(vm.state.value.newCodes)
        assertNull(vm.state.value.message)
        assertEquals(false, vm.state.value.busy)
        coVerify(exactly = 1) { repository.regenerateRecoveryCodes() }
    }

    @Test
    fun `TP-4_41x createNewCodes failing with INTERNAL - message F-220's text for a write, newCodes null`() = runTest {
        val internal = ApiError.Defined("INTERNAL", 500, null)
        coEvery { repository.regenerateRecoveryCodes() } throws ApiException(internal)
        val vm = viewModel()

        vm.createNewCodes(onMeUpdated)
        advanceUntilIdle()

        assertEquals(IdentityErrorMessages.forError(internal, Operation.Mutation), vm.state.value.message)
        assertNull(vm.state.value.newCodes)
        assertEquals(false, vm.state.value.busy)
        coVerify(exactly = 0) { repository.getMe() }
        assertTrue("no refresh for other errors", updates.isEmpty())
    }

    @Test
    fun `TP-4_41x createNewCodes failing with TWO_STEP_NOT_ENABLED - message F-220's text for a write, then refresh, onMeUpdated(me) (A-102)`() =
        runTest {
            val notEnabled = ApiError.Defined("TWO_STEP_NOT_ENABLED", 409, null)
            coEvery { repository.regenerateRecoveryCodes() } throws ApiException(notEnabled)
            val vm = viewModel()

            vm.createNewCodes(onMeUpdated)
            advanceUntilIdle()

            assertEquals(IdentityErrorMessages.forError(notEnabled, Operation.Mutation), vm.state.value.message)
            assertNull(vm.state.value.newCodes)
            coVerify(exactly = 1) { repository.getMe() }
            assertEquals(listOf(meAfter), updates)
        }

    @Test
    fun `TP-4_41x createNewCodes twice while busy - one regenerate call`() = runTest {
        coEvery { repository.regenerateRecoveryCodes() } coAnswers {
            delay(1_000)
            codes
        }
        val vm = viewModel()

        vm.createNewCodes()
        runCurrent()
        assertTrue("busy while the request runs", vm.state.value.busy)
        vm.createNewCodes()
        advanceUntilIdle()

        coVerify(exactly = 1) { repository.regenerateRecoveryCodes() }
        assertEquals(codes, vm.state.value.newCodes)
    }

    // ---- (d) finishNewCodes, leaveNewCodes ----

    @Test
    fun `TP-4_41 (d) finishNewCodes unticked - no acknowledge call, codes still shown`() = runTest {
        val vm = viewModel()
        showNewCodes(vm)

        vm.finishNewCodes(onMeUpdated)
        advanceUntilIdle()

        coVerify(exactly = 0) { repository.acknowledgeRecoveryCodes() }
        assertEquals(codes, vm.state.value.newCodes)
        assertTrue(updates.isEmpty())
    }

    @Test
    fun `TP-4_41 (d) finishNewCodes ticked, acknowledge succeeding - newCodes null, acknowledged false, onMeUpdated(me), no message`() =
        runTest {
            val vm = viewModel()
            showNewCodes(vm)
            vm.onAcknowledgedChange(true)
            assertTrue(vm.state.value.acknowledged)

            vm.finishNewCodes(onMeUpdated)
            advanceUntilIdle()

            coVerify(exactly = 1) { repository.acknowledgeRecoveryCodes() }
            assertNull(vm.state.value.newCodes)
            assertEquals(false, vm.state.value.acknowledged)
            assertEquals(listOf(meAfter), updates)
            assertNull(vm.state.value.message)
        }

    @Test
    fun `TP-4_41 (d) finishNewCodes ticked, acknowledge failing - newCodes kept, message the error's text`() = runTest {
        coEvery { repository.acknowledgeRecoveryCodes() } throws ApiException(ApiError.Network)
        val vm = viewModel()
        showNewCodes(vm)
        vm.onAcknowledgedChange(true)

        vm.finishNewCodes(onMeUpdated)
        advanceUntilIdle()

        assertEquals(codes, vm.state.value.newCodes)
        // Network reads error_unavailable for every operation (F-253).
        assertEquals(UiText(R.string.error_unavailable), vm.state.value.message)
        assertEquals(false, vm.state.value.busy)
        assertTrue(updates.isEmpty())
    }

    @Test
    fun `TP-4_41 (d) leaveNewCodes - newCodes null, no acknowledge call`() = runTest {
        val vm = viewModel()
        showNewCodes(vm)

        vm.leaveNewCodes()
        advanceUntilIdle()

        assertNull(vm.state.value.newCodes)
        coVerify(exactly = 0) { repository.acknowledgeRecoveryCodes() }
    }

    @Test
    fun `TP-4_41x finishNewCodes twice while busy - one acknowledge call`() = runTest {
        coEvery { repository.acknowledgeRecoveryCodes() } coAnswers { delay(1_000) }
        val vm = viewModel()
        showNewCodes(vm)
        vm.onAcknowledgedChange(true)

        vm.finishNewCodes(onMeUpdated)
        runCurrent()
        assertTrue("busy while the request runs", vm.state.value.busy)
        vm.finishNewCodes(onMeUpdated)
        advanceUntilIdle()

        coVerify(exactly = 1) { repository.acknowledgeRecoveryCodes() }
        assertEquals(listOf(meAfter), updates)
    }

    // ---- (e) refresh; messageShown ----

    @Test
    fun `TP-4_41 (e) refresh with getMe failing - onMeUpdated not called, no message`() = runTest {
        coEvery { repository.getMe() } throws ApiException(ApiError.Network)
        val vm = viewModel()

        vm.refresh(onMeUpdated)
        advanceUntilIdle()

        assertTrue(updates.isEmpty())
        assertNull(vm.state.value.message)
    }

    @Test
    fun `TP-4_41x refresh with getMe answering - onMeUpdated(me) once`() = runTest {
        val vm = viewModel()

        vm.refresh(onMeUpdated)
        advanceUntilIdle()

        assertEquals(listOf(meAfter), updates)
    }

    @Test
    fun `TP-4_41x messageShown after a turn-off - message null`() = runTest {
        val vm = viewModel()
        turnOffWith(vm, "123456")
        assertEquals(UiText(R.string.twostep_off_done), vm.state.value.message)

        vm.messageShown()

        assertNull(vm.state.value.message)
        assertFalse(vm.state.value.busy)
    }
}

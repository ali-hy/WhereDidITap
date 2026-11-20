// F-215 TwoStepSetupViewModel (identity LLD §8.2's S-4 signatures, F-165's flow, A-99). TP-4.34x:
// TP-4.34 renders the route with this view model; these pin start(replace) as §8.2 states it
// (withConfirmation around twoStepSetup / twoStepReplaceStart; ALREADY_ENABLED → Done) and the
// enable step (code → twoStepEnable → the codes, F-165/F-215).
// The S-4 review's branches (TP-4.34x; source per line):
// - the code rule (F-156's 6 digits, the form F-165 shares): twostep_code_invalid, no request;
// - a wrong code: HLD J-7's twostep_setup_clock_hint, the field cleared (F-156, A-102);
// - TWO_STEP_SETUP_EXPIRED: the Expired step; Start again: a new secret (HLD J-7, S-11, A-102);
// - replace: twoStepReplaceConfirm, then Done with no codes step (A-104, F-165's replace mode);
// - finish: acknowledgeRecoveryCodes only when ticked; a failure keeps the codes (F-165, as
//   F-214's finishNewCodes).
// Setup: a MockK AuthRepository, the real ConfirmationCoordinator around it,
// Dispatchers.setMain(StandardTestDispatcher). `settle` advances virtual time until a condition
// holds, since the LLD doesn't say which scope the coordinator's submit uses.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
package com.budmon.app.identity

import com.budmon.app.R
import com.budmon.app.core.network.ApiError
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
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
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.time.Instant

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class TwoStepSetupViewModelTest {
    private val secret = TwoStepSecret(
        secret = "JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP",
        otpauthUri = "otpauth://totp/x:mona%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
        expiresAt = Instant.parse("2026-11-15T10:10:00Z"),
    )
    private val codes = "ABCDEFGHJK".map { "7KQ2-M3XD-4TR$it" }
    private val repository = mockk<AuthRepository> {
        coEvery { twoStepSetup() } returns secret
        coEvery { twoStepReplaceStart() } returns secret
        coEvery { twoStepEnable("123456") } returns codes
        coEvery { confirm(any(), any(), any()) } returns Instant.parse("2026-11-15T10:20:00Z")
        coEvery { twoStepReplaceConfirm("123456") } returns Unit
        coEvery { acknowledgeRecoveryCodes() } returns Unit
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun TestScope.subject(): Pair<TwoStepSetupViewModel, ConfirmationCoordinator> {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        val coordinator = ConfirmationCoordinator(repository)
        return TwoStepSetupViewModel(repository, coordinator) to coordinator
    }

    private fun TestScope.settle(
        what: String,
        condition: () -> Boolean,
    ) = eventually(what, step = { advanceUntilIdle() }, condition = condition)

    @Test
    fun `TP-4_34x start(false) - twoStepSetup once, step Scan with the secret`() = runTest {
        val (vm, _) = subject()

        vm.start(false)
        advanceUntilIdle()

        coVerify(exactly = 1) { repository.twoStepSetup() }
        coVerify(exactly = 0) { repository.twoStepReplaceStart() }
        assertEquals(SetupStep.Scan, vm.state.step)
        assertEquals(secret, vm.state.secret)
    }

    @Test
    fun `TP-4_34x start(true) - twoStepReplaceStart once, never twoStepSetup, step Scan`() = runTest {
        val (vm, _) = subject()

        vm.start(true)
        advanceUntilIdle()

        coVerify(exactly = 1) { repository.twoStepReplaceStart() }
        coVerify(exactly = 0) { repository.twoStepSetup() }
        assertEquals(SetupStep.Scan, vm.state.step)
        assertEquals(secret, vm.state.secret)
    }

    @Test
    fun `TP-4_34x start(false) answered TWO_STEP_ALREADY_ENABLED - step Done`() = runTest {
        coEvery { repository.twoStepSetup() } throws ApiException(ApiError.Defined("TWO_STEP_ALREADY_ENABLED", 409, null))
        val (vm, _) = subject()

        vm.start(false)
        advanceUntilIdle()

        assertEquals(SetupStep.Done, vm.state.step)
    }

    @Test
    fun `TP-4_34x start(false) needing confirmation - the coordinator asks for the factor, then a confirmed password reruns twoStepSetup`() =
        runTest {
            var calls = 0
            coEvery { repository.twoStepSetup() } answers {
                calls += 1
                if (calls == 1) {
                    throw ApiException(ApiError.Defined("CONFIRMATION_REQUIRED", 403, buildJsonObject { put("factor", "password") }))
                }
                secret
            }
            val (vm, coordinator) = subject()

            vm.start(false)
            advanceUntilIdle()
            assertEquals(ConfirmFactor.Password, coordinator.request.value)
            coordinator.onValueChange("violet staircase umbrella")
            coordinator.submit()
            settle("step Scan") { vm.state.step == SetupStep.Scan }

            coVerify(exactly = 1) { repository.confirm("violet staircase umbrella", null, null) }
            assertEquals(2, calls)
            assertEquals(secret, vm.state.secret)
        }

    @Test
    fun `TP-4_34x setup, then code 123456 submitted - twoStepEnable(123456), step Codes with the 10 codes`() = runTest {
        val (vm, _) = subject()
        vm.start(false)
        advanceUntilIdle()

        vm.onCodeChange("123456")
        vm.submit()
        settle("step Codes") { vm.state.step == SetupStep.Codes }

        coVerify(exactly = 1) { repository.twoStepEnable("123456") }
        assertEquals(codes, vm.state.codes)
    }

    // ---- the S-4 review's branches ----

    private fun defined(key: String, status: Int) = ApiException(ApiError.Defined(key, status, null))

    /** A view model on the Scan step (setup unless [replace]). */
    private fun TestScope.scanning(replace: Boolean = false): TwoStepSetupViewModel {
        val (vm, _) = subject()
        vm.start(replace)
        advanceUntilIdle()
        assertEquals(SetupStep.Scan, vm.state.step)
        return vm
    }

    /** A view model on the Codes step, after 123456 was accepted. */
    private fun TestScope.onCodes(): TwoStepSetupViewModel {
        val vm = scanning()
        vm.onCodeChange("123456")
        vm.submit()
        settle("step Codes") { vm.state.step == SetupStep.Codes }
        return vm
    }

    /** Types [code], submits it and waits until the request has finished. */
    private fun TestScope.send(vm: TwoStepSetupViewModel, code: String) {
        vm.onCodeChange(code)
        vm.submit()
        advanceUntilIdle()
        settle("busy reset") { !vm.state.busy }
    }

    @Test
    fun `TP-4_34x submit with 5 digits - error twostep_code_invalid, no twoStepEnable, step Scan`() = runTest {
        val vm = scanning()

        send(vm, "12345")

        assertEquals(R.string.twostep_code_invalid, vm.state.error)
        assertEquals(SetupStep.Scan, vm.state.step)
        coVerify(exactly = 0) { repository.twoStepEnable(any()) }
    }

    @Test
    fun `TP-4_34x submit with 6 characters and a letter - error twostep_code_invalid, no twoStepEnable`() = runTest {
        val vm = scanning()

        send(vm, "12345a")

        assertEquals(R.string.twostep_code_invalid, vm.state.error)
        coVerify(exactly = 0) { repository.twoStepEnable(any()) }
    }

    @Test
    fun `TP-4_34x replace mode, submit with 5 digits - error twostep_code_invalid, no twoStepReplaceConfirm`() = runTest {
        val vm = scanning(replace = true)

        send(vm, "12345")

        assertEquals(R.string.twostep_code_invalid, vm.state.error)
        coVerify(exactly = 0) { repository.twoStepReplaceConfirm(any()) }
    }

    @Test
    fun `TP-4_34x twoStepEnable answered TWO_STEP_CODE_INVALID - error twostep_setup_clock_hint, code cleared, step Scan`() = runTest {
        coEvery { repository.twoStepEnable("111111") } throws defined("TWO_STEP_CODE_INVALID", 400)
        val vm = scanning()

        send(vm, "111111")

        coVerify(exactly = 1) { repository.twoStepEnable("111111") }
        assertEquals(R.string.twostep_setup_clock_hint, vm.state.error)
        assertEquals("", vm.state.code)
        assertEquals(SetupStep.Scan, vm.state.step)
        assertEquals(secret, vm.state.secret)
    }

    @Test
    fun `TP-4_34x replace mode, twoStepReplaceConfirm answered TWO_STEP_CODE_INVALID - error twostep_setup_clock_hint, code cleared`() =
        runTest {
            coEvery { repository.twoStepReplaceConfirm("111111") } throws defined("TWO_STEP_CODE_INVALID", 400)
            val vm = scanning(replace = true)

            send(vm, "111111")

            assertEquals(R.string.twostep_setup_clock_hint, vm.state.error)
            assertEquals("", vm.state.code)
            assertEquals(SetupStep.Scan, vm.state.step)
        }

    @Test
    fun `TP-4_34x twoStepEnable answered TWO_STEP_SETUP_EXPIRED - step Expired, busy false`() = runTest {
        coEvery { repository.twoStepEnable("123456") } throws defined("TWO_STEP_SETUP_EXPIRED", 410)
        val vm = scanning()

        send(vm, "123456")

        assertEquals(SetupStep.Expired, vm.state.step)
        assertFalse(vm.state.busy)
    }

    @Test
    fun `TP-4_34x replace mode, twoStepReplaceConfirm answered TWO_STEP_SETUP_EXPIRED - step Expired`() = runTest {
        coEvery { repository.twoStepReplaceConfirm("123456") } throws defined("TWO_STEP_SETUP_EXPIRED", 410)
        val vm = scanning(replace = true)

        send(vm, "123456")

        assertEquals(SetupStep.Expired, vm.state.step)
    }

    @Test
    fun `TP-4_34x Expired, then startAgain - twoStepSetup called again, step Scan with the new secret`() = runTest {
        val second = TwoStepSecret(
            secret = "KRSX G5DS NFXG OIDB KRSX G5DS NFXG OIDB",
            otpauthUri = "otpauth://totp/x:mona%40example.com?secret=KRSXG5DSNFXGOIDBKRSXG5DSNFXGOIDB",
            expiresAt = Instant.parse("2026-11-15T10:30:00Z"),
        )
        coEvery { repository.twoStepSetup() } returnsMany listOf(secret, second)
        coEvery { repository.twoStepEnable("123456") } throws defined("TWO_STEP_SETUP_EXPIRED", 410)
        val vm = scanning()
        send(vm, "123456")
        assertEquals(SetupStep.Expired, vm.state.step)

        vm.startAgain()
        settle("step Scan") { vm.state.step == SetupStep.Scan }

        coVerify(exactly = 2) { repository.twoStepSetup() }
        coVerify(exactly = 0) { repository.twoStepReplaceStart() }
        assertEquals(second, vm.state.secret)
    }

    @Test
    fun `TP-4_34x replace mode, Expired, then startAgain - twoStepReplaceStart called again, never twoStepSetup`() = runTest {
        coEvery { repository.twoStepReplaceConfirm("123456") } throws defined("TWO_STEP_SETUP_EXPIRED", 410)
        val vm = scanning(replace = true)
        send(vm, "123456")
        assertEquals(SetupStep.Expired, vm.state.step)

        vm.startAgain()
        settle("step Scan") { vm.state.step == SetupStep.Scan }

        coVerify(exactly = 2) { repository.twoStepReplaceStart() }
        coVerify(exactly = 0) { repository.twoStepSetup() }
    }

    @Test
    fun `TP-4_34x replace mode, code 123456 - twoStepReplaceConfirm(123456), step Done, no codes, never twoStepEnable`() = runTest {
        val vm = scanning(replace = true)

        vm.onCodeChange("123456")
        vm.submit()
        settle("step Done") { vm.state.step == SetupStep.Done }

        coVerify(exactly = 1) { repository.twoStepReplaceConfirm("123456") }
        coVerify(exactly = 0) { repository.twoStepEnable(any()) }
        assertEquals(emptyList<String>(), vm.state.codes)
    }

    @Test
    fun `TP-4_34x replace mode, code typed as 123 456 - twoStepReplaceConfirm(123456)`() = runTest {
        val vm = scanning(replace = true)

        vm.onCodeChange("123 456")
        vm.submit()
        settle("step Done") { vm.state.step == SetupStep.Done }

        coVerify(exactly = 1) { repository.twoStepReplaceConfirm("123456") }
    }

    @Test
    fun `TP-4_34x Codes, ticked, finish - acknowledgeRecoveryCodes once, step Done, the codes cleared`() = runTest {
        val vm = onCodes()

        vm.onAcknowledgedChange(true)
        vm.finish()
        settle("step Done") { vm.state.step == SetupStep.Done && !vm.state.busy }

        coVerify(exactly = 1) { repository.acknowledgeRecoveryCodes() }
        assertEquals(emptyList<String>(), vm.state.codes)
    }

    @Test
    fun `TP-4_34x Codes, ticked, finish answered 503 - the codes kept, step Codes, formError set, busy false`() = runTest {
        coEvery { repository.acknowledgeRecoveryCodes() } throws ApiException(ApiError.Unavailable)
        val vm = onCodes()

        vm.onAcknowledgedChange(true)
        vm.finish()
        settle("formError") { vm.state.formError != null && !vm.state.busy }

        coVerify(exactly = 1) { repository.acknowledgeRecoveryCodes() }
        assertEquals(SetupStep.Codes, vm.state.step)
        assertEquals(codes, vm.state.codes)
        assertNotNull(vm.state.formError)
    }

    @Test
    fun `TP-4_34x Codes, not ticked, finish - ignored, no acknowledgeRecoveryCodes, step Codes`() = runTest {
        val vm = onCodes()

        vm.finish()
        advanceUntilIdle()

        coVerify(exactly = 0) { repository.acknowledgeRecoveryCodes() }
        assertEquals(SetupStep.Codes, vm.state.step)
        assertEquals(codes, vm.state.codes)
        assertNull(vm.state.formError)
    }

    @Test
    fun `TP-4_34x Codes, ticked then unticked, finish - ignored, no acknowledgeRecoveryCodes`() = runTest {
        val vm = onCodes()

        vm.onAcknowledgedChange(true)
        vm.onAcknowledgedChange(false)
        vm.finish()
        advanceUntilIdle()

        coVerify(exactly = 0) { repository.acknowledgeRecoveryCodes() }
        assertEquals(SetupStep.Codes, vm.state.step)
    }
}

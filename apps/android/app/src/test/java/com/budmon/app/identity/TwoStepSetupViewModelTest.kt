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
// TP-4.47 (a) to (d), A-105's rules (§8.2): a failed start → Failed with the read text; replace
// mode's TWO_STEP_NOT_ENABLED → Done; submit's errors; finish(). SetupStep.Failed is looked up by
// name, so while it's missing only the tests that use it fail, not the build.
// TP-4.48 (a), A-106: replaced is true only after a confirmed replacement.
// TP-4.47x: startAgain() is ignored while a load is in flight (A-105, "ignored while busy").
// Setup: a MockK AuthRepository, the real ConfirmationCoordinator around it,
// Dispatchers.setMain(StandardTestDispatcher). `settle` advances virtual time until a condition
// holds, since the LLD doesn't say which scope the coordinator's submit uses.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
package com.budmon.app.identity

import com.budmon.app.R
import com.budmon.app.core.error.Operation
import com.budmon.app.core.network.ApiError
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
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
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.time.Instant
import java.util.concurrent.atomic.AtomicInteger

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
    fun `TP-4_47 (c) submit with 12345 - error twostep_code_invalid, no twoStepEnable, step Scan`() = runTest {
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
    fun `TP-4_47 (c) twoStepEnable answered TWO_STEP_SETUP_EXPIRED - step Expired, formError null, busy false`() = runTest {
        coEvery { repository.twoStepEnable("123456") } throws defined("TWO_STEP_SETUP_EXPIRED", 410)
        val vm = scanning()

        send(vm, "123456")

        assertEquals(SetupStep.Expired, vm.state.step)
        assertNull(vm.state.formError)
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
    fun `TP-4_47 (d) Codes, not ticked, finish - ignored, no acknowledgeRecoveryCodes, step Codes`() = runTest {
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

    // ---- TP-4.47, A-105 ----

    /** A-105's new step, by name (see the header). */
    private val failed: SetupStep
        get() = SetupStep.entries.firstOrNull { it.name == "Failed" } ?: error("SetupStep.Failed is missing (A-105)")

    private val unavailable = ApiException(ApiError.Unavailable)
    private val internal = ApiError.Defined("INTERNAL", 500, buildJsonObject { put("outcome", "not_applied") })
    private val notEnabled = defined("TWO_STEP_NOT_ENABLED", 409)

    /** Starts a view model whose first twoStepSetup throws [thrown]; later calls return the secret. */
    private fun TestScope.failedStart(thrown: Throwable): TwoStepSetupViewModel {
        var calls = 0
        coEvery { repository.twoStepSetup() } answers {
            calls += 1
            if (calls == 1) throw thrown
            secret
        }
        val (vm, _) = subject()
        vm.start(false)
        advanceUntilIdle()
        return vm
    }

    @Test
    fun `TP-4_47 (a) start(false), twoStepSetup answered 503 - step Failed, formError the read text, busy false`() = runTest {
        val vm = failedStart(unavailable)

        assertEquals(failed, vm.state.step)
        assertEquals(IdentityErrorMessages.forError(ApiError.Unavailable, Operation.Read), vm.state.formError)
        assertFalse(vm.state.busy)
    }

    @Test
    fun `TP-4_47 (a) start(false), twoStepSetup failing with Network - step Failed, formError the read text`() = runTest {
        val vm = failedStart(ApiException(ApiError.Network))

        assertEquals(failed, vm.state.step)
        assertEquals(IdentityErrorMessages.forError(ApiError.Network, Operation.Read), vm.state.formError)
    }

    @Test
    fun `TP-4_47 (a) start(false), twoStepSetup throwing IllegalStateException - step Failed with Unknown's read text, then startAgain - step Scan with the secret`() =
        runTest {
            val vm = failedStart(IllegalStateException("not an ApiException"))
            assertEquals(failed, vm.state.step)
            assertEquals(IdentityErrorMessages.forError(ApiError.Unknown, Operation.Read), vm.state.formError)

            vm.startAgain()
            settle("step Scan") { vm.state.step == SetupStep.Scan }

            coVerify(exactly = 2) { repository.twoStepSetup() }
            assertEquals(secret, vm.state.secret)
        }

    @Test
    fun `TP-4_47x start(false) answered INTERNAL not_applied - formError the read text, not the mutation text`() = runTest {
        val vm = failedStart(ApiException(internal))

        assertEquals(failed, vm.state.step)
        assertEquals(IdentityErrorMessages.forError(internal, Operation.Read), vm.state.formError)
        assertNotEquals(IdentityErrorMessages.forError(internal, Operation.Mutation), vm.state.formError)
    }

    @Test
    fun `TP-4_47x Failed, startAgain failing again - step Failed again`() = runTest {
        coEvery { repository.twoStepSetup() } throws unavailable
        val (vm, _) = subject()
        vm.start(false)
        advanceUntilIdle()
        assertEquals(failed, vm.state.step)

        vm.startAgain()
        advanceUntilIdle()
        settle("step Failed after the second call") { vm.state.step == failed && !vm.state.busy }

        coVerify(exactly = 2) { repository.twoStepSetup() }
        assertEquals(IdentityErrorMessages.forError(ApiError.Unavailable, Operation.Read), vm.state.formError)
    }

    @Test
    fun `TP-4_47x replace mode, twoStepReplaceStart answered 503 - step Failed, then startAgain calls twoStepReplaceStart again, never twoStepSetup`() =
        runTest {
            var calls = 0
            coEvery { repository.twoStepReplaceStart() } answers {
                calls += 1
                if (calls == 1) throw unavailable
                secret
            }
            val (vm, _) = subject()
            vm.start(true)
            advanceUntilIdle()
            assertEquals(failed, vm.state.step)

            vm.startAgain()
            settle("step Scan") { vm.state.step == SetupStep.Scan }

            coVerify(exactly = 2) { repository.twoStepReplaceStart() }
            coVerify(exactly = 0) { repository.twoStepSetup() }
        }

    @Test
    fun `TP-4_47 (b) start(true), twoStepReplaceStart answered TWO_STEP_NOT_ENABLED - step Done, no formError`() = runTest {
        coEvery { repository.twoStepReplaceStart() } throws notEnabled
        val (vm, _) = subject()

        vm.start(true)
        advanceUntilIdle()

        assertEquals(SetupStep.Done, vm.state.step)
        assertNull(vm.state.formError)
    }

    @Test
    fun `TP-4_47 (b) replace mode, twoStepReplaceConfirm answered TWO_STEP_NOT_ENABLED - step Done, no formError, busy false`() = runTest {
        coEvery { repository.twoStepReplaceConfirm("123456") } throws notEnabled
        val vm = scanning(replace = true)

        send(vm, "123456")

        coVerify(exactly = 1) { repository.twoStepReplaceConfirm("123456") }
        assertEquals(SetupStep.Done, vm.state.step)
        assertNull(vm.state.formError)
        assertFalse(vm.state.busy)
    }

    @Test
    fun `TP-4_47 (c) code 123 456 answered TWO_STEP_CODE_INVALID - twoStepEnable(123456), error twostep_setup_clock_hint, code cleared`() =
        runTest {
            coEvery { repository.twoStepEnable("123456") } throws defined("TWO_STEP_CODE_INVALID", 400)
            val vm = scanning()

            send(vm, "123 456")

            coVerify(exactly = 1) { repository.twoStepEnable("123456") }
            assertEquals(R.string.twostep_setup_clock_hint, vm.state.error)
            assertEquals("", vm.state.code)
            assertEquals(SetupStep.Scan, vm.state.step)
        }

    @Test
    fun `TP-4_47 (c) twoStepEnable answered 503 - formError the mutation text, step Scan, the code kept`() = runTest {
        coEvery { repository.twoStepEnable("123456") } throws unavailable
        val vm = scanning()

        send(vm, "123456")

        assertEquals(IdentityErrorMessages.forError(ApiError.Unavailable, Operation.Mutation), vm.state.formError)
        assertEquals(SetupStep.Scan, vm.state.step)
        assertEquals("123456", vm.state.code)
        assertNull(vm.state.error)
    }

    @Test
    fun `TP-4_47x twoStepEnable answered INTERNAL not_applied - formError the mutation text, not the read text`() = runTest {
        coEvery { repository.twoStepEnable("123456") } throws ApiException(internal)
        val vm = scanning()

        send(vm, "123456")

        assertEquals(IdentityErrorMessages.forError(internal, Operation.Mutation), vm.state.formError)
        assertNotEquals(IdentityErrorMessages.forError(internal, Operation.Read), vm.state.formError)
    }

    @Test
    fun `TP-4_47 (d) Codes, ticked, finish failing then succeeding - the codes kept with formError, then Done with the codes empty`() =
        runTest {
            var calls = 0
            coEvery { repository.acknowledgeRecoveryCodes() } answers {
                calls += 1
                if (calls == 1) throw unavailable
            }
            val vm = onCodes()
            vm.onAcknowledgedChange(true)

            vm.finish()
            settle("formError after the failure") { vm.state.formError != null && !vm.state.busy }
            assertEquals(SetupStep.Codes, vm.state.step)
            assertEquals(codes, vm.state.codes)
            assertEquals(IdentityErrorMessages.forError(ApiError.Unavailable, Operation.Mutation), vm.state.formError)

            vm.finish()
            settle("step Done") { vm.state.step == SetupStep.Done && !vm.state.busy }

            coVerify(exactly = 2) { repository.acknowledgeRecoveryCodes() }
            assertEquals(emptyList<String>(), vm.state.codes)
        }

    // ---- TP-4.48 (a), A-106: replaced ----

    private val passwordStepUp =
        ApiException(ApiError.Defined("CONFIRMATION_REQUIRED", 403, buildJsonObject { put("factor", "password") }))

    @Test
    fun `TP-4_48 (a) a new view model - replaced false`() = runTest {
        val (vm, _) = subject()

        assertFalse(vm.replaced)
    }

    @Test
    fun `TP-4_48 (a) start(false) and an enable - step Codes, replaced false`() = runTest {
        val vm = onCodes()

        assertFalse(vm.replaced)
    }

    @Test
    fun `TP-4_48 (a) start(true) with the step-up cancelled - step Done, replaced false`() = runTest {
        coEvery { repository.twoStepReplaceStart() } throws passwordStepUp
        val (vm, coordinator) = subject()
        vm.start(true)
        advanceUntilIdle()
        assertEquals(ConfirmFactor.Password, coordinator.request.value)

        coordinator.cancel()
        settle("step Done") { vm.state.step == SetupStep.Done }

        assertFalse(vm.replaced)
        coVerify(exactly = 0) { repository.twoStepReplaceConfirm(any()) }
    }

    @Test
    fun `TP-4_48 (a) start(true) and a confirm answered TWO_STEP_NOT_ENABLED - step Done, replaced false`() = runTest {
        coEvery { repository.twoStepReplaceConfirm("123456") } throws defined("TWO_STEP_NOT_ENABLED", 409)
        val vm = scanning(replace = true)

        send(vm, "123456")

        coVerify(exactly = 1) { repository.twoStepReplaceConfirm("123456") }
        assertFalse(vm.replaced)
    }

    @Test
    fun `TP-4_48 (a) start(true) and a successful confirm - step Done, replaced true`() = runTest {
        val vm = scanning(replace = true)
        assertFalse(vm.replaced)

        vm.onCodeChange("123456")
        vm.submit()
        settle("step Done") { vm.state.step == SetupStep.Done && !vm.state.busy }

        assertTrue(vm.replaced)
    }

    @Test
    fun `TP-4_48x replace confirm whose step-up is cancelled - still Scan, replaced false`() = runTest {
        coEvery { repository.twoStepReplaceConfirm("123456") } throws passwordStepUp
        val (vm, coordinator) = subject()
        vm.start(true)
        advanceUntilIdle()
        vm.onCodeChange("123456")
        vm.submit()
        advanceUntilIdle()
        assertEquals(ConfirmFactor.Password, coordinator.request.value)

        coordinator.cancel()
        settle("busy reset") { !vm.state.busy }

        assertEquals(SetupStep.Scan, vm.state.step)
        assertFalse(vm.replaced)
    }

    @Test
    fun `TP-4_48x replace confirm answered 503 - still Scan, replaced false`() = runTest {
        coEvery { repository.twoStepReplaceConfirm("123456") } throws unavailable
        val vm = scanning(replace = true)

        send(vm, "123456")

        assertEquals(SetupStep.Scan, vm.state.step)
        assertFalse(vm.replaced)
    }

    // ---- TP-4.47x, A-105: startAgain is ignored while a load is in flight ----

    /**
     * A view model on Failed (the first call answered 503) whose later calls wait on [gate];
     * [calls] counts every twoStepSetup (or twoStepReplaceStart when [replace]).
     */
    private fun TestScope.failedThenHeld(
        replace: Boolean,
        gate: CompletableDeferred<Unit>,
        calls: AtomicInteger,
    ): TwoStepSetupViewModel {
        val answer: suspend () -> TwoStepSecret = {
            if (calls.incrementAndGet() == 1) throw unavailable
            gate.await()
            secret
        }
        if (replace) {
            coEvery { repository.twoStepReplaceStart() } coAnswers { answer() }
        } else {
            coEvery { repository.twoStepSetup() } coAnswers { answer() }
        }
        val (vm, _) = subject()
        vm.start(replace)
        advanceUntilIdle()
        assertEquals(failed, vm.state.step)
        return vm
    }

    @Test
    fun `TP-4_47x startAgain twice while the load is in flight - one more twoStepSetup, then Scan`() = runTest {
        val gate = CompletableDeferred<Unit>()
        val calls = AtomicInteger(0)
        val vm = failedThenHeld(replace = false, gate = gate, calls = calls)

        vm.startAgain()
        runCurrent()
        assertEquals(SetupStep.Loading, vm.state.step)
        vm.startAgain()
        runCurrent()

        assertEquals("one call for start, one for the first startAgain", 2, calls.get())
        gate.complete(Unit)
        settle("step Scan") { vm.state.step == SetupStep.Scan }
        coVerify(exactly = 2) { repository.twoStepSetup() }
    }

    @Test
    fun `TP-4_47x replace mode, startAgain twice while the load is in flight - one more twoStepReplaceStart`() = runTest {
        val gate = CompletableDeferred<Unit>()
        val calls = AtomicInteger(0)
        val vm = failedThenHeld(replace = true, gate = gate, calls = calls)

        vm.startAgain()
        runCurrent()
        vm.startAgain()
        runCurrent()

        assertEquals(2, calls.get())
        gate.complete(Unit)
        settle("step Scan") { vm.state.step == SetupStep.Scan }
        coVerify(exactly = 2) { repository.twoStepReplaceStart() }
        coVerify(exactly = 0) { repository.twoStepSetup() }
    }

    @Test
    fun `TP-4_47x startAgain twice in a row, before anything runs - one more twoStepSetup`() = runTest {
        val gate = CompletableDeferred<Unit>()
        val calls = AtomicInteger(0)
        val vm = failedThenHeld(replace = false, gate = gate, calls = calls)

        vm.startAgain()
        vm.startAgain()
        advanceUntilIdle()

        assertEquals(2, calls.get())
        gate.complete(Unit)
        settle("step Scan") { vm.state.step == SetupStep.Scan }
    }
}

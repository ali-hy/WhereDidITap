// F-215 TwoStepSetupViewModel (identity LLD §8.2's S-4 signatures, F-165's flow, A-99). TP-4.34x:
// TP-4.34 renders the route with this view model; these pin start(replace) as §8.2 states it
// (withConfirmation around twoStepSetup / twoStepReplaceStart; ALREADY_ENABLED → Done) and the
// enable step (code → twoStepEnable → the codes, F-165/F-215).
// Setup: a MockK AuthRepository, the real ConfirmationCoordinator around it,
// Dispatchers.setMain(StandardTestDispatcher). `settle` advances virtual time until a condition
// holds, since the LLD doesn't say which scope the coordinator's submit uses.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
package com.budmon.app.identity

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
            coordinator.submit(password = "violet staircase umbrella")
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
}

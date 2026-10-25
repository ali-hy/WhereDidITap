// C-2 (§8.2 State): PlatformStatusViewModel's `syncing` is true while either outbox work is
// RUNNING (S-13 review B-2, re-review 5636303270 B-1). TP-13.7x.
//
// Fakes: UpdateRepository, OutboxDao and ConnectivityMonitor as mocks with fixed flows; WorkManager
// as a mock whose getWorkInfosForUniqueWorkFlow(name) returns one controllable flow per name.
package com.budmon.app.ui.platform

import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.budmon.app.core.network.ConnectivityMonitor
import com.budmon.app.core.outbox.OutboxCounts
import com.budmon.app.core.outbox.OutboxDao
import com.budmon.app.core.update.UpdateRepository
import com.budmon.app.core.update.UpdateState
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PlatformStatusViewModelTest {
    private val syncNow = MutableStateFlow<List<WorkInfo>>(emptyList())
    private val periodic = MutableStateFlow<List<WorkInfo>>(emptyList())

    @Before
    fun setMain() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun resetMain() {
        Dispatchers.resetMain()
    }

    private fun work(state: WorkInfo.State): WorkInfo = mockk { every { this@mockk.state } returns state }

    private fun viewModel(): PlatformStatusViewModel {
        val updates = mockk<UpdateRepository> {
            every { state } returns MutableStateFlow<UpdateState>(UpdateState.None)
            every { downloadUrl } returns MutableStateFlow<String?>(null)
            coEvery { refresh() } returns Unit
        }
        val dao = mockk<OutboxDao> { every { observeCounts() } returns MutableStateFlow(OutboxCounts(2, 0, 0)) }
        val connectivity = mockk<ConnectivityMonitor> { every { isOnline } returns MutableStateFlow(true) }
        val workManager = mockk<WorkManager> {
            every { getWorkInfosForUniqueWorkFlow("outbox-sync-now") } returns syncNow
            every { getWorkInfosForUniqueWorkFlow("outbox-sync") } returns periodic
        }
        return PlatformStatusViewModel(updates, dao, connectivity, workManager)
    }

    @Test
    fun `TP-13_7x syncing follows RUNNING on either outbox work and clears for ENQUEUED or SUCCEEDED`() = runTest {
        val vm = viewModel()
        // WhileSubscribed: keep one collector so the combined flow is live.
        val collector = backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { vm.status.collect {} }

        assertEquals("no work", false, vm.status.value.syncing)
        assertEquals(OutboxCounts(2, 0, 0), vm.status.value.counts)

        syncNow.value = listOf(work(WorkInfo.State.RUNNING))
        assertEquals("outbox-sync-now RUNNING", true, vm.status.first().syncing)

        syncNow.value = listOf(work(WorkInfo.State.ENQUEUED))
        assertEquals("outbox-sync-now ENQUEUED", false, vm.status.value.syncing)

        periodic.value = listOf(work(WorkInfo.State.RUNNING))
        assertEquals("only outbox-sync RUNNING", true, vm.status.value.syncing)

        periodic.value = listOf(work(WorkInfo.State.SUCCEEDED))
        assertEquals("outbox-sync SUCCEEDED", false, vm.status.value.syncing)

        syncNow.value = listOf(work(WorkInfo.State.SUCCEEDED))
        assertEquals("both finished", false, vm.status.value.syncing)
        collector.cancel()
    }
}

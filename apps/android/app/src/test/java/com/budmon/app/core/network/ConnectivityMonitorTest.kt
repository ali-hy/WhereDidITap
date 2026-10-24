// F-259 ConnectivityMonitor. TP-13.15.
package com.budmon.app.core.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import androidx.test.core.app.ApplicationProvider
import app.cash.turbine.test
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadows.ShadowNetwork
import org.robolectric.shadows.ShadowNetworkCapabilities

@RunWith(RobolectricTestRunner::class)
class ConnectivityMonitorTest {
    @Test
    fun `TP-13_15 isOnline emits true, false, true as the default network is validated, lost and validated again`() = runTest {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val cm = context.getSystemService(ConnectivityManager::class.java)
        val shadow = shadowOf(cm)
        val network = ShadowNetwork.newInstance(1)
        val validated = ShadowNetworkCapabilities.newInstance().also {
            shadowOf(it).addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            shadowOf(it).addCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
        }
        val monitor = ConnectivityMonitor(context)

        monitor.isOnline.test {
            for (cb in shadow.networkCallbacks) cb.onCapabilitiesChanged(network, validated)
            assertEquals(true, expectMostRecentItem())
            for (cb in shadow.networkCallbacks) cb.onLost(network)
            assertEquals(false, awaitItem())
            for (cb in shadow.networkCallbacks) cb.onCapabilitiesChanged(network, validated)
            assertEquals(true, awaitItem())
            cancelAndIgnoreRemainingEvents()
        }
    }
}

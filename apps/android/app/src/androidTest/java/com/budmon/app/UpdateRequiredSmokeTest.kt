// Emulator smoke (release candidates: connectedDebugAndroidTest on API 34). TP-13.13 (A-349). The base
// URL binding (ApiBaseUrlModule, @Named("apiBaseUrl") HttpUrl) is replaced by an in-process
// MockWebServer on 127.0.0.1 answering meta/client-config with minimumVersionCode = versionCode + 1.
//
// Assumed: ApiBaseUrlModule lives in com.budmon.app.core.network.
package com.budmon.app

import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.budmon.app.core.network.ApiBaseUrlModule
import dagger.Module
import dagger.Provides
import dagger.hilt.android.testing.HiltAndroidRule
import dagger.hilt.android.testing.HiltAndroidTest
import dagger.hilt.components.SingletonComponent
import dagger.hilt.testing.TestInstallIn
import javax.inject.Named
import javax.inject.Singleton
import okhttp3.HttpUrl
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith

/** The stub API, started once per process before Hilt builds the graph. */
object StubApi {
    val server: MockWebServer by lazy {
        MockWebServer().apply {
            dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse =
                    if (request.path?.endsWith("api/v1/meta/client-config") == true) {
                        val minimum = BuildConfig.VERSION_CODE + 1
                        MockResponse().setHeader("Content-Type", "application/json").setBody(
                            """{"apiVersion":"1.0","android":{"minimumVersionCode":$minimum,"latestVersionCode":$minimum,"downloadUrl":null},"web":{"minimumBuild":0}}""",
                        )
                    } else {
                        MockResponse().setResponseCode(404)
                    }
            }
            start(java.net.InetAddress.getByName("127.0.0.1"), 0)
        }
    }
}

@Module
@TestInstallIn(components = [SingletonComponent::class], replaces = [ApiBaseUrlModule::class])
object StubApiBaseUrlModule {
    @Provides
    @Singleton
    @Named("apiBaseUrl")
    fun apiBaseUrl(): HttpUrl = StubApi.server.url("/")
}

@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class UpdateRequiredSmokeTest {
    private val hilt = HiltAndroidRule(this)
    private val compose = createAndroidComposeRule<MainActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(hilt).around(compose)

    @Before
    fun inject() {
        hilt.inject()
    }

    @Test
    fun tp_13_13_launch_with_a_raised_minimum_shows_UpdateRequiredScreen() {
        compose.waitUntil(15_000) {
            compose.onAllNodes(hasText("Update Budmon to continue")).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Update Budmon to continue").assertExists()
    }
}

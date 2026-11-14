// F-264, A-349: the API base URL is a binding, so the instrumented smoke test can replace it; and
// the API root every request resolves against (A-474).
package com.budmon.app.core.network

import com.budmon.app.BuildConfig
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import javax.inject.Named
import javax.inject.Singleton

/** A-474: the API root, `api/v1/` under the base URL, so a base-URL path prefix is kept. */
fun apiRoot(baseUrl: HttpUrl): HttpUrl {
    require(baseUrl.encodedPath.endsWith("/")) { "the API base URL must end with /" }
    return baseUrl.resolve("api/v1/")!!
}

@Module
@InstallIn(SingletonComponent::class)
object ApiBaseUrlModule {
    @Provides
    @Singleton
    @Named("apiBaseUrl")
    fun apiBaseUrl(): HttpUrl = BuildConfig.API_BASE_URL.toHttpUrl()
}

// F-264, A-349: the API base URL is a binding, so the instrumented smoke test can replace it.
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

@Module
@InstallIn(SingletonComponent::class)
object ApiBaseUrlModule {
    @Provides
    @Singleton
    @Named("apiBaseUrl")
    fun apiBaseUrl(): HttpUrl = BuildConfig.API_BASE_URL.toHttpUrl()
}

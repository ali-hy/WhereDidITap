// F-202: adds the stored access token to requests for this API, and nowhere else.
package com.budmon.app.identity.net

import com.budmon.app.core.network.apiRoot
import com.budmon.app.identity.store.TokenStore
import kotlinx.coroutines.runBlocking
import okhttp3.HttpUrl
import okhttp3.Interceptor
import okhttp3.Response
import javax.inject.Inject
import javax.inject.Named

class AuthInterceptor
    @Inject
    constructor(
        private val tokenStore: TokenStore,
        @Named("apiBaseUrl") private val baseUrl: HttpUrl,
    ) : Interceptor {
        private val root = apiRoot(baseUrl).encodedPath

        override fun intercept(chain: Interceptor.Chain): Response {
            val request = chain.request()
            if (!carriesToken(request.url)) return chain.proceed(request)
            // Interceptors run on OkHttp's threads. The server decides whether an expired token is still good.
            val session = runBlocking { tokenStore.read() } ?: return chain.proceed(request)
            return chain.proceed(request.newBuilder().header("Authorization", "Bearer ${session.accessToken}").build())
        }

        /** The same origin, under the API root, and not an `auth/` path other than sign-out. */
        private fun carriesToken(url: HttpUrl): Boolean {
            if (url.scheme != baseUrl.scheme || url.host != baseUrl.host || url.port != baseUrl.port) return false
            val path = url.encodedPath
            if (!path.startsWith(root)) return false
            return !(path.startsWith(root + "auth/") && path != root + "auth/sign-out")
        }
    }

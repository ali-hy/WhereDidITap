// F-203: on a 401 UNAUTHENTICATED, refreshes the session once (single flight) and retries the request.
package com.budmon.app.identity.net

import com.budmon.app.core.network.ApiError
import com.budmon.app.core.network.ApiErrorParser
import com.budmon.app.core.network.apiRoot
import com.budmon.app.identity.SessionEvent
import com.budmon.app.identity.SessionEvents
import com.budmon.app.identity.store.StoredSession
import com.budmon.app.identity.store.TokenStore
import com.budmon.app.identity.toStoredSession
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import okhttp3.Authenticator
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.Route
import java.io.IOException
import java.net.SocketTimeoutException
import javax.inject.Inject
import javax.inject.Named
import javax.inject.Singleton

/** A refresh that failed for a reason other than a refused token; the session is kept. */
class RefreshFailedException(val error: ApiError) :
    IOException("refresh failed: ${if (error is ApiError.Defined) error.key else error::class.simpleName}")

@Singleton
class TokenRefreshAuthenticator
    @Inject
    constructor(
        private val tokenStore: TokenStore,
        @Named("refreshClient") private val refreshClient: OkHttpClient,
        @Named("apiBaseUrl") baseUrl: HttpUrl,
        private val sessionEvents: SessionEvents,
    ) : Authenticator {
        private val root: HttpUrl = apiRoot(baseUrl)
        private val mutex = Mutex()
        private val json = Json { ignoreUnknownKeys = true }

        override fun authenticate(
            route: Route?,
            response: Response,
        ): Request? {
            if (response.priorResponse != null || response.code != HTTP_UNAUTHORIZED) return null
            if (!refreshable(response.request.url)) return null
            val error = ApiErrorParser.parse(response.code, response.peekBody(PEEK_MAX).bytes())
            if (error !is ApiError.Defined || error.key != "UNAUTHENTICATED") return null
            val used = response.request.header("Authorization")
            val signOut = response.request.url.encodedPath == root.encodedPath + "auth/sign-out"
            return runBlocking { mutex.withLock { retry(response.request, used, signOut) } }
        }

        /** Under the API root; `auth/` paths other than sign-out are excluded. */
        private fun refreshable(url: HttpUrl): Boolean {
            if (url.scheme != root.scheme || url.host != root.host || url.port != root.port) return false
            val path = url.encodedPath
            if (!path.startsWith(root.encodedPath)) return false
            val auth = root.encodedPath + "auth/"
            return !path.startsWith(auth) || path == auth + "sign-out"
        }

        private suspend fun retry(
            request: Request,
            used: String?,
            signOut: Boolean,
        ): Request? {
            val stored = tokenStore.read() ?: return null
            // Another call refreshed while this one waited.
            if (used != "Bearer ${stored.accessToken}") return withToken(request, stored.accessToken)
            val fresh = refresh(stored, signOut) ?: return null
            return withToken(request, fresh.accessToken)
        }

        private fun withToken(
            request: Request,
            token: String,
        ): Request = request.newBuilder().header("Authorization", "Bearer $token").build()

        /**
         * The new session, or null when the refresh token was refused: the session is cleared, and
         * announced as ended unless the refresh was for a sign-out.
         */
        private suspend fun refresh(
            stored: StoredSession,
            signOut: Boolean,
        ): StoredSession? {
            val body =
                buildJsonObject {
                    put("tokenDelivery", "body")
                    put("refreshToken", stored.refreshToken)
                }
            val request =
                Request.Builder()
                    .url(root.resolve("auth/refresh")!!)
                    .post(body.toString().toRequestBody("application/json".toMediaType()))
                    .build()
            val (code, bytes) =
                try {
                    refreshClient.newCall(request).execute().use { it.code to it.body.bytes() }
                } catch (_: SocketTimeoutException) {
                    throw RefreshFailedException(ApiError.Timeout)
                } catch (_: IOException) {
                    throw RefreshFailedException(ApiError.Network)
                }
            if (code !in HTTP_OK_RANGE) {
                val error = ApiErrorParser.parse(code, bytes)
                if (error is ApiError.Defined && error.key == "REFRESH_INVALID") {
                    tokenStore.clear()
                    if (!signOut) sessionEvents.emit(SessionEvent.Ended)
                    return null
                }
                throw RefreshFailedException(error)
            }
            val tokens =
                try {
                    json.parseToJsonElement(bytes.toString(Charsets.UTF_8)).jsonObject["tokens"] as? JsonObject
                } catch (_: IllegalArgumentException) {
                    null
                } ?: throw RefreshFailedException(ApiError.Unknown)
            val session =
                try {
                    tokens.toStoredSession(stored.userId)
                } catch (_: java.time.format.DateTimeParseException) {
                    throw RefreshFailedException(ApiError.Unknown)
                }
            tokenStore.save(session)
            val device = (tokens["deviceToken"] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
            val email = tokenStore.lastEmail()
            if (device != null && email != null) tokenStore.saveDeviceToken(email, device)
            return session
        }

        private companion object {
            const val HTTP_UNAUTHORIZED = 401
            const val PEEK_MAX = 64L * 1024
            val HTTP_OK_RANGE = 200..299
        }
    }

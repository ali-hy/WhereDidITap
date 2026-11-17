// F-204: suspend wrappers for me.get, auth.signUpOptions, invitations.preview and accept (S-1),
// and sign-in and sign-out (S-3).
package com.budmon.app.identity

import android.os.Build
import com.budmon.app.core.network.ApiError
import com.budmon.app.core.network.ApiErrorParser
import com.budmon.app.core.network.apiRoot
import com.budmon.app.core.update.UpdateRepository
import com.budmon.app.identity.net.RefreshFailedException
import com.budmon.app.identity.store.StoredSession
import com.budmon.app.identity.store.TokenStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.net.SocketTimeoutException
import java.time.Instant
import javax.inject.Inject
import javax.inject.Named
import javax.inject.Singleton

/** A failed call, as P-F-252's [ApiError]. */
class ApiException(val error: ApiError) :
    Exception("ApiError ${if (error is ApiError.Defined) error.key else error::class.simpleName}")

data class Me(
    val id: String,
    val email: String,
    val displayName: String,
    val locale: String,
    val timeZone: String,
    val baseCurrency: String,
    val status: String,
    val isOwner: Boolean,
)

/** A sign-in the server accepted, held until the outbox owner check lets it be stored (A-69). */
data class PendingSignIn(
    val session: StoredSession,
    val deviceToken: String?,
    val me: Me,
)

sealed interface SignInOutcome {
    data class Ready(val pending: PendingSignIn) : SignInOutcome

    data class TwoStepRequired(val challengeToken: String, val expiresAt: Instant) : SignInOutcome
}

/** The session in a `tokens` object. */
internal fun JsonObject.toStoredSession(userId: String): StoredSession {
    fun text(key: String) = (this[key] as? JsonPrimitive)?.contentOrNull ?: ""
    return StoredSession(
        accessToken = text("accessToken"),
        refreshToken = text("refreshToken"),
        accessExpiresAt = Instant.parse(text("accessExpiresAt")),
        refreshExpiresAt = Instant.parse(text("refreshExpiresAt")),
        userId = userId,
    )
}

data class SignUpOptions(val currencies: List<String>, val locales: List<String>)

data class InvitationPreview(
    val email: String,
    val inviterName: String?,
    val expiresAt: Instant,
    val origin: String,
)

@Singleton
class AuthRepository
@Inject
constructor(
    private val client: OkHttpClient,
    @Named("apiBaseUrl") private val baseUrl: HttpUrl,
    private val tokenStore: TokenStore,
    private val updates: UpdateRepository,
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val jsonType = "application/json".toMediaType()

    private fun url(path: String): HttpUrl = apiRoot(baseUrl).resolve(path)!!

    /** Runs [request]; a 2xx body is returned as JSON, anything else throws [ApiException]. */
    private suspend fun call(request: Request): JsonObject {
        val (code, body) =
            try {
                withContext(Dispatchers.IO) {
                    client.newCall(request).execute().use { it.code to it.body.bytes() }
                }
            } catch (e: RefreshFailedException) {
                throw ApiException(e.error)
            } catch (_: SocketTimeoutException) {
                throw ApiException(ApiError.Timeout)
            } catch (_: IOException) {
                throw ApiException(ApiError.Network)
            }
        if (code in 200..299) {
            return try {
                json.parseToJsonElement(body.toString(Charsets.UTF_8)).jsonObject
            } catch (_: IllegalArgumentException) {
                throw ApiException(ApiError.Unknown)
            }
        }
        val error = ApiErrorParser.parse(code, body)
        if (error is ApiError.Defined && error.key == "CLIENT_UPDATE_REQUIRED") {
            val min = (error.data?.get("minimumVersion") as? JsonPrimitive)?.contentOrNull?.toIntOrNull()
            updates.markRequired(min)
        }
        throw ApiException(error)
    }

    private fun post(
        path: String,
        body: JsonObject,
    ): Request = Request.Builder().url(url(path)).post(body.toString().toRequestBody(jsonType)).build()

    private fun JsonObject.str(key: String): String = (this[key] as? JsonPrimitive)?.contentOrNull ?: ""

    private fun JsonObject.strOrNull(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.contentOrNull

    private fun JsonObject.flag(key: String): Boolean = (this[key] as? JsonPrimitive)?.booleanOrNull ?: false

    private fun JsonElement.strings(): List<String> =
        (this as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull } ?: emptyList()

    /** [accessToken], when given, authorises this call instead of the stored session. */
    suspend fun getMe(accessToken: String? = null): Me {
        val request = Request.Builder().url(url("me")).get()
        if (accessToken != null) request.header("Authorization", "Bearer $accessToken")
        val o = call(request.build())
        return Me(
            id = o.str("id"),
            email = o.str("email"),
            displayName = o.str("displayName"),
            locale = o.str("locale"),
            timeZone = o.str("timeZone"),
            baseCurrency = o.str("baseCurrency"),
            status = o.str("status"),
            isOwner = o.flag("isOwner"),
        )
    }

    suspend fun signUpOptions(): SignUpOptions {
        val o = call(Request.Builder().url(url("auth/sign-up-options")).get().build())
        val currencies = o["currencies"]?.jsonArray?.mapNotNull { (it as? JsonObject)?.str("code") } ?: emptyList()
        return SignUpOptions(currencies, o["locales"]?.strings() ?: emptyList())
    }

    suspend fun previewInvitation(token: String): InvitationPreview {
        val o = call(post("invitations/preview", buildJsonObject { put("token", token) }))
        return InvitationPreview(
            email = o.str("email"),
            inviterName = o.strOrNull("inviterName"),
            expiresAt = Instant.parse(o.str("expiresAt")),
            origin = o.str("origin"),
        )
    }

    /**
     * Creates the account with a password. Nothing is stored: the result is held until
     * [commitSignIn]. Null when the account exists but its user couldn't be read.
     */
    suspend fun acceptInvitation(
        token: String,
        email: String,
        displayName: String,
        locale: String,
        timeZone: String,
        baseCurrency: String,
        password: String,
    ): PendingSignIn? {
        val body =
            buildJsonObject {
                put("token", token)
                put("displayName", displayName)
                put("locale", locale)
                put("timeZone", timeZone)
                put("baseCurrency", baseCurrency)
                put(
                    "method",
                    buildJsonObject {
                        put("kind", "password")
                        put("password", password)
                    },
                )
                put("tokenDelivery", "body")
                put("deviceModel", Build.MODEL.take(MODEL_MAX))
            }
        val result = call(post("invitations/accept", body))
        val tokens = result["tokens"] as? JsonObject ?: throw ApiException(ApiError.Unknown)
        return try {
            pendingFrom(tokens)
        } catch (_: ApiException) {
            null
        }
    }

    /** `me` with the new access token, as a [PendingSignIn]; a failure ends the new session and rethrows. */
    private suspend fun pendingFrom(tokens: JsonObject): PendingSignIn {
        val session =
            try {
                tokens.toStoredSession(userId = "")
            } catch (_: java.time.format.DateTimeParseException) {
                throw ApiException(ApiError.Unknown)
            }
        val me =
            try {
                getMe(session.accessToken)
            } catch (e: ApiException) {
                abandon(session.accessToken)
                throw e
            }
        return PendingSignIn(session.copy(userId = me.id), tokens.strOrNull("deviceToken"), me)
    }

    /** Signs in with a password; nothing is stored until [commitSignIn]. */
    suspend fun signIn(
        email: String,
        password: String,
    ): SignInOutcome {
        val trimmed = email.trim()
        val body =
            buildJsonObject {
                put("email", trimmed)
                put("password", password)
                put("tokenDelivery", "body")
                put("deviceModel", Build.MODEL.take(MODEL_MAX))
                tokenStore.deviceTokenFor(trimmed)?.let { put("deviceToken", it) }
            }
        val result = call(post("auth/sign-in", body))
        return when (result.strOrNull("status")) {
            "signed_in" -> {
                val tokens = result["tokens"] as? JsonObject ?: throw ApiException(ApiError.Unknown)
                SignInOutcome.Ready(pendingFrom(tokens))
            }

            "two_step_required" ->
                try {
                    SignInOutcome.TwoStepRequired(result.str("challengeToken"), Instant.parse(result.str("expiresAt")))
                } catch (_: java.time.format.DateTimeParseException) {
                    throw ApiException(ApiError.Unknown)
                }

            else -> throw ApiException(ApiError.Unknown)
        }
    }

    /** Stores the session, the device token and the email, once the owner check allowed it. */
    suspend fun commitSignIn(pending: PendingSignIn) {
        tokenStore.save(pending.session)
        pending.deviceToken?.let { tokenStore.saveDeviceToken(pending.me.email, it) }
        tokenStore.saveLastEmail(pending.me.email)
    }

    /** Ends a sign-in that won't be stored; a failure is ignored. */
    suspend fun abandonSignIn(pending: PendingSignIn) {
        abandon(pending.session.accessToken)
    }

    private suspend fun abandon(accessToken: String) {
        try {
            call(signOutRequest(accessToken))
        } catch (_: ApiException) {
            // Best effort: the session expires on its own.
        }
    }

    private fun signOutRequest(accessToken: String?): Request {
        val request = Request.Builder().url(url("auth/sign-out")).post("{}".toRequestBody(jsonType))
        if (accessToken != null) request.header("Authorization", "Bearer $accessToken")
        return request.build()
    }

    /** Ends the stored session on the server and clears it; any other failure keeps it. */
    suspend fun signOut() {
        try {
            call(signOutRequest(null))
        } catch (e: ApiException) {
            val error = e.error
            if (!(error is ApiError.Defined && error.key == "UNAUTHENTICATED")) throw e
        }
        tokenStore.clear()
    }

    private companion object {
        const val MODEL_MAX = 100
    }
}

// F-204 (S-1): suspend wrappers for me.get, auth.signUpOptions, invitations.preview and accept.
package com.budmon.app.identity

import android.os.Build
import com.budmon.app.core.network.ApiError
import com.budmon.app.core.network.ApiErrorParser
import com.budmon.app.core.network.apiRoot
import com.budmon.app.core.update.UpdateRepository
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
class ApiException(val error: ApiError) : Exception(error.toString())

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

    private fun JsonElement.strings(): List<String> = (this as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull } ?: emptyList()

    suspend fun getMe(): Me {
        val o = call(Request.Builder().url(url("me")).get().build())
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

    /** Creates the account with a password, stores the session and returns the new user. */
    suspend fun acceptInvitation(
        token: String,
        displayName: String,
        locale: String,
        timeZone: String,
        baseCurrency: String,
        password: String,
    ): Me? {
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
        val session = tokens.toSession(userId = "")
        tokenStore.save(session)
        // The access token is stored, so this call carries it and tells who signed in.
        val me =
            try {
                getMe()
            } catch (_: ApiException) {
                null
            }
        if (me != null) {
            tokenStore.save(session.copy(userId = me.id))
            tokens.strOrNull("deviceToken")?.let { tokenStore.saveDeviceToken(me.email, it) }
            tokenStore.saveLastEmail(me.email)
        }
        return me
    }

    private fun JsonObject.toSession(userId: String) =
        StoredSession(
            accessToken = str("accessToken"),
            refreshToken = str("refreshToken"),
            accessExpiresAt = Instant.parse(str("accessExpiresAt")),
            refreshExpiresAt = Instant.parse(str("refreshExpiresAt")),
            userId = userId,
        )

    private companion object {
        const val MODEL_MAX = 100
    }
}

// F-211 (S-1): the invitation token from pasted text.
package com.budmon.app.identity

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

sealed interface ParseResult {
    data class Token(val value: String) : ParseResult

    data object NotAnInvitation : ParseResult

    data object OtherServer : ParseResult
}

object InvitationLinkParser {
    private val token = Regex("^bmi_[A-Za-z0-9_-]{43}$")
    private val link = Regex("https?://\\S+")

    /** A bare token, or the first link in [text] that points at this server's `invite` page. */
    fun parse(
        text: String,
        apiBaseUrl: HttpUrl,
    ): ParseResult {
        val trimmed = text.trim()
        if (token.matches(trimmed)) return ParseResult.Token(trimmed)
        val url = link.find(trimmed)?.value?.toHttpUrlOrNull() ?: return ParseResult.NotAnInvitation
        if (url.scheme != apiBaseUrl.scheme || url.host != apiBaseUrl.host || url.port != apiBaseUrl.port) {
            return ParseResult.OtherServer
        }
        if (url.encodedPath != apiBaseUrl.encodedPath + "invite") return ParseResult.NotAnInvitation
        val value =
            url.fragment
                ?.split("&")
                ?.map { it.split("=", limit = 2) }
                ?.firstOrNull { it.size == 2 && it[0] == "t" }
                ?.get(1)
        return if (value != null && token.matches(value)) ParseResult.Token(value) else ParseResult.NotAnInvitation
    }
}

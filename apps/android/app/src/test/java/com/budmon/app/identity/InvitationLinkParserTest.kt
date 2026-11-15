// F-211 InvitationLinkParser (identity LLD §4.15, A-37). TP-1.34's parser rows, plus TP-1.34x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
package com.budmon.app.identity

import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Test

class InvitationLinkParserTest {
    private val base = "https://budmon.com/".toHttpUrl()
    private val token = "bmi_" + "Ab-_cdEFghIJklMNopQRstUVwxYZ0123456789-_abc"

    private fun parse(text: String) = InvitationLinkParser.parse(text, base)

    @Test
    fun `TP-1_34 a full link gives the token`() {
        assertEquals(ParseResult.Token(token), parse("https://budmon.com/invite#t=$token"))
    }

    @Test
    fun `TP-1_34 a link with text around it gives the token`() {
        assertEquals(
            ParseResult.Token(token),
            parse("Join me: https://budmon.com/invite#t=$token see you there"),
        )
    }

    @Test
    fun `TP-1_34 a bare token gives the token`() {
        assertEquals(ParseResult.Token(token), parse("  $token \n"))
    }

    @Test
    fun `TP-1_34 another server's invite link is OtherServer`() {
        assertEquals(ParseResult.OtherServer, parse("https://other.ts.net/invite#t=$token"))
    }

    @Test
    fun `TP-1_34 this server's other path is NotAnInvitation`() {
        assertEquals(ParseResult.NotAnInvitation, parse("https://budmon.com/x"))
    }

    @Test
    fun `TP-1_34 a malformed token in the fragment is NotAnInvitation`() {
        assertEquals(ParseResult.NotAnInvitation, parse("https://budmon.com/invite#t=bmi_short"))
    }

    @Test
    fun `TP-1_34x another port or scheme is OtherServer`() {
        assertEquals(ParseResult.OtherServer, parse("https://budmon.com:8443/invite#t=$token"))
        assertEquals(ParseResult.OtherServer, parse("http://budmon.com/invite#t=$token"))
    }

    @Test
    fun `TP-1_34x the first t= of the fragment counts, and text without a link or token is NotAnInvitation`() {
        assertEquals(ParseResult.Token(token), parse("https://budmon.com/invite#x=1&t=$token&t=other"))
        assertEquals(ParseResult.NotAnInvitation, parse("hello there"))
        assertEquals(ParseResult.NotAnInvitation, parse("https://budmon.com/invite"))
    }

    @Test
    fun `TP-1_34x a base URL with a path needs that path plus invite`() {
        val prefixed = "https://h.example/app/".toHttpUrl()

        assertEquals(
            ParseResult.Token(token),
            InvitationLinkParser.parse("https://h.example/app/invite#t=$token", prefixed),
        )
        assertEquals(
            ParseResult.NotAnInvitation,
            InvitationLinkParser.parse("https://h.example/invite#t=$token", prefixed),
        )
    }
}

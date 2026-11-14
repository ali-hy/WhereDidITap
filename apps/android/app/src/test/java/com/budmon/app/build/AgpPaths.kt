// AGP intermediate paths read by the TestKit cases (A-348), tied to the pinned AGP version: an AGP
// bump changes this one file.
package com.budmon.app.build

import java.io.File

object AgpPaths {
    private fun cap(variant: String) = variant.replaceFirstChar { it.uppercase() }

    fun buildConfig(root: File, variant: String): File =
        File(root, "app/build/generated/source/buildConfig/$variant/com/budmon/app/BuildConfig.java")

    fun mergedManifest(root: File, variant: String): File =
        File(root, "app/build/intermediates/merged_manifest/$variant/process${cap(variant)}MainManifest/AndroidManifest.xml")

    fun networkSecurityConfig(root: File, variant: String): File =
        File(root, "app/build/intermediates/packaged_res/$variant/package${cap(variant)}Resources/xml/network_security_config.xml")
}

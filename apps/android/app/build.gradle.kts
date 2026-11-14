// The Budmon Android app (S-13): F-250 to F-265 and the generated API client.
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
    alias(libs.plugins.openapi.generator)
}

// F-264, F-265: build properties come from Gradle properties, or from ~/.budmon/android.properties
// on the stage-0 laptop (never committed).
val laptopProperties =
    Properties().apply {
        val file = File(System.getProperty("user.home"), ".budmon/android.properties")
        if (file.isFile) file.inputStream().use { load(it) }
    }

fun buildProperty(name: String): String? = providers.gradleProperty(name).orNull ?: laptopProperties.getProperty(name)

/**
 * F-264: debug builds reach only the development stack through the emulator's alias (checked below).
 * Only a Gradle property changes it, never the laptop file, which holds the release URL (review B-1).
 */
val debugApiBaseUrl: String = providers.gradleProperty("budmon.apiBaseUrl").orNull ?: "http://10.0.2.2:5173/"

/** F-264: release builds need an https:// URL ending in `/` (checked when a release is built). */
val releaseApiBaseUrl: String? = buildProperty("budmon.apiBaseUrl")

/** F-265 (A-3): optional; when present it must be a Google OAuth web client id. */
val googleServerClientId: String =
    (buildProperty("budmon.googleServerClientId") ?: "").also { id ->
        require(id.isEmpty() || Regex("""^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$""").matches(id)) {
            "budmon.googleServerClientId must look like <number>-<id>.apps.googleusercontent.com"
        }
    }

/** F-250: Sentry is on only when a DSN is configured. */
val sentryDsn: String = buildProperty("budmon.sentryDsn") ?: ""

fun quoted(value: String): String = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

android {
    namespace = "com.budmon.app"
    // OkHttp 5.5.0's AAR metadata requires compiling against API 37 (targetSdk is separate).
    compileSdk = 37

    defaultConfig {
        applicationId = "com.budmon.app"
        minSdk = 26
        targetSdk = 35
        versionCode = (buildProperty("budmon.versionCode") ?: "1").toInt()
        versionName = buildProperty("budmon.versionName") ?: "0.0.0"
        testInstrumentationRunner = "com.budmon.app.HiltTestRunner"
        buildConfigField("String", "SENTRY_DSN", quoted(sentryDsn))
        buildConfigField("String", "GOOGLE_SERVER_CLIENT_ID", quoted(googleServerClientId))
    }

    buildTypes {
        debug {
            buildConfigField("String", "API_BASE_URL", quoted(debugApiBaseUrl))
            // F-263: pseudo-locales in debug builds.
            isPseudoLocalesEnabled = true
        }
        release {
            buildConfigField("String", "API_BASE_URL", quoted(releaseApiBaseUrl ?: ""))
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    sourceSets {
        // AGP 9 takes no Provider here: the generator's output directory, resolved once and created
        // up front so the source set sees it before openApiGenerate has run.
        val generatedApi =
            layout.buildDirectory
                .dir("generated/openapi/src/main/kotlin")
                .get()
                .asFile
                .apply { mkdirs() }
        getByName("main").kotlin.directories += generatedApi.path
        // TP-13.9: the shared money vectors (F-313).
        getByName("test").resources.directories += "$rootDir/../../packages/shared/test-vectors"
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
        unitTests.isReturnDefaultValues = true
    }

    lint {
        // F-263: RTL and hard-coded text are errors; accessibility stays non-fatal (D-39).
        error += setOf("RtlHardcoded", "RtlCompat", "RtlEnabled", "HardcodedText", "SetTextI18n")
        abortOnError = true
        checkDependencies = false
    }
}

kotlin {
    jvmToolchain(21)
    compilerOptions {
        optIn.add("kotlinx.serialization.ExperimentalSerializationApi")
    }
}

ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
    arg("room.generateKotlin", "true")
}

// The generated client (§4.19): Retrofit, kotlinx.serialization, coroutines; never committed.
openApiGenerate {
    generatorName.set("kotlin")
    library.set("jvm-retrofit2")
    inputSpec.set("$rootDir/../../packages/contract/openapi.json")
    outputDir.set(
        layout.buildDirectory
            .dir("generated/openapi")
            .get()
            .asFile.path,
    )
    packageName.set("com.budmon.api")
    configOptions.set(
        mapOf(
            "serializationLibrary" to "kotlinx_serialization",
            "useCoroutines" to "true",
            "omitGradleWrapper" to "true",
        ),
    )
    // A-344: one MetaApi with metaClientConfig(), and the ClientConfig* model names.
    openapiNormalizer.set(mapOf("SET_TAGS_FOR_ALL_OPERATIONS" to "Meta"))
    inlineSchemaNameMappings.set(
        mapOf(
            "meta_clientConfig_200_response" to "ClientConfig",
            "meta_clientConfig_200_response_android" to "ClientConfigAndroid",
            "meta_clientConfig_200_response_web" to "ClientConfigWeb",
        ),
    )
    // URLs stay strings, so no contextual serializer is needed.
    typeMappings.set(mapOf("URI" to "kotlin.String"))
    generateApiTests.set(false)
    generateModelTests.set(false)
    generateApiDocumentation.set(false)
    generateModelDocumentation.set(false)
}

tasks.named("preBuild") { dependsOn("openApiGenerate") }
tasks.matching { it.name.startsWith("ksp") || it.name.startsWith("runKtlint") }.configureEach {
    dependsOn("openApiGenerate")
}

// F-264: each build type checks its own URL when it's built, so a release property never fails a
// debug build (or the reverse).
val checkDebugApiBaseUrl = tasks.register("checkDebugApiBaseUrl") {
    val url = debugApiBaseUrl
    doLast {
        val port = Regex("""^http://10\.0\.2\.2:(\d+)/$""").matchEntire(url)?.groupValues?.get(1)
        require(port != null && port != "8080") {
            "budmon.apiBaseUrl for debug builds must be http://10.0.2.2:<port>/ with a port other than 8080, not $url"
        }
    }
}

/** F-264: a release build fails without an https:// base URL ending in `/`. */
val checkReleaseApiBaseUrl = tasks.register("checkReleaseApiBaseUrl") {
    val url = releaseApiBaseUrl
    doLast {
        require(url != null && url.startsWith("https://") && url.endsWith("/")) {
            "Release builds need budmon.apiBaseUrl = an https:// URL ending in /"
        }
    }
}
tasks.matching { it.name == "preDebugBuild" }.configureEach { dependsOn(checkDebugApiBaseUrl) }
tasks.matching { it.name == "preReleaseBuild" }.configureEach { dependsOn(checkReleaseApiBaseUrl) }

// A-348: gradleTestKit() puts the running Gradle's own kotlin-stdlib (newer metadata than Kotlin
// 2.2.20 reads) on the unit-test classpath; only the unit-test compilation skips that check.
tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
    if (name.endsWith("UnitTestKotlin")) {
        compilerOptions.freeCompilerArgs.add("-Xskip-metadata-version-check")
    }
}

// A-348: the TestKit cases build a copy of this project.
tasks.withType<Test>().configureEach {
    systemProperty("budmon.androidRoot", rootDir.path)
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.browser)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)
    implementation(libs.compose.ui.tooling.preview)

    implementation(libs.room.runtime)
    implementation(libs.room.ktx)
    ksp(libs.room.compiler)
    implementation(libs.work.runtime)
    implementation(libs.datastore.preferences)

    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.androidx.hilt.work)
    ksp(libs.androidx.hilt.compiler)

    implementation(libs.okhttp)
    // compile-only need: the generated ApiClient imports HttpLoggingInterceptor; the app never installs it.
    implementation(libs.okhttp.logging)
    implementation(libs.retrofit)
    implementation(libs.retrofit.kotlinx.serialization)
    implementation(libs.retrofit.scalars)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.sentry.android)

    lintChecks(project(":lint-rules"))

    testImplementation(libs.junit)
    testImplementation(gradleTestKit())
    testImplementation(libs.robolectric)
    testImplementation(libs.mockk)
    testImplementation(libs.turbine)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.retrofit.jakewharton.kotlinx)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.androidx.test.ext.junit)
    testImplementation(libs.work.testing)
    testImplementation(platform(libs.compose.bom))
    testImplementation(libs.compose.ui.test.junit4)
    debugImplementation(libs.compose.ui.test.manifest)

    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation(libs.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.hilt.android.testing)
    androidTestImplementation(libs.okhttp.mockwebserver)
    kspAndroidTest(libs.hilt.compiler)
}

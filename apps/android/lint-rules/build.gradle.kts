// F-261: Budmon's custom lint checks, run on the app through `lintChecks`.
plugins {
    alias(libs.plugins.kotlin.jvm)
}

kotlin { jvmToolchain(21) }

dependencies {
    compileOnly(libs.lint.api)
    compileOnly(libs.lint.checks)
    testImplementation(libs.lint.api)
    testImplementation(libs.lint.tests)
    testImplementation(libs.junit)
}

tasks.jar {
    manifest { attributes("Lint-Registry-v2" to "com.budmon.lint.BudmonIssueRegistry") }
}

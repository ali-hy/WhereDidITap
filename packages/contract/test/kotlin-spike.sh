#!/usr/bin/env bash
# TP-4.3 (S-4): the spike contract's OpenAPI document, generated into Kotlin with §4.19's
# configuration (org.openapi.generator 7.14.0, generatorName "kotlin", library "jvm-retrofit2",
# serializationLibrary "kotlinx_serialization", packageName "com.budmon.api"), compiles, and the
# `amount` property is `kotlin.Long`. Builds a throwaway Gradle project in a temporary directory.
# Needs a JDK, Gradle and network access to the Gradle plugin portal and Maven Central.
#
# Usage: packages/contract/test/kotlin-spike.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
package_dir="$(cd "$here/.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/budmon-kotlin-spike.XXXXXX")"
trap 'rm -rf "$work"' EXIT

echo "TP-4.3: emitting the spike OpenAPI document"
(cd "$package_dir" && pnpm exec tsx test/kotlin-spike/emitSpike.ts "$work/spike.json")

cat >"$work/settings.gradle.kts" <<'GRADLE'
pluginManagement { repositories { gradlePluginPortal(); mavenCentral() } }
rootProject.name = "kotlin-spike"
GRADLE

cat >"$work/build.gradle.kts" <<'GRADLE'
plugins {
  kotlin("jvm") version "2.2.20"
  kotlin("plugin.serialization") version "2.2.20"
  id("org.openapi.generator") version "7.14.0"
}
repositories { mavenCentral() }
dependencies {
  implementation("com.squareup.retrofit2:retrofit:3.0.0")
  implementation("com.squareup.okhttp3:okhttp:5.5.0")
  implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
  implementation("com.squareup.retrofit2:converter-kotlinx-serialization:3.0.0")
  implementation("com.squareup.retrofit2:converter-scalars:3.0.0")
}
openApiGenerate {
  generatorName.set("kotlin")
  library.set("jvm-retrofit2")
  inputSpec.set("$rootDir/spike.json")
  outputDir.set(layout.buildDirectory.dir("generated/openapi").get().asFile.path)
  packageName.set("com.budmon.api")
  configOptions.set(mapOf("serializationLibrary" to "kotlinx_serialization"))
}
kotlin { sourceSets["main"].kotlin.srcDir(layout.buildDirectory.dir("generated/openapi/src/main/kotlin")) }
tasks.named("compileKotlin") { dependsOn("openApiGenerate") }
GRADLE

echo "TP-4.3: generating and compiling"
(cd "$work" && gradle --no-daemon --quiet compileKotlin)

models="$work/build/generated/openapi/src/main/kotlin/com/budmon/api/models"
if ! grep -rqE 'val amount: kotlin\.Long' "$models"; then
  echo "TP-4.3: no generated model declares amount as kotlin.Long" >&2
  grep -rn 'amount' "$models" >&2 || true
  exit 1
fi
if grep -rqE 'val amount: kotlin\.(Int|Double|Float|java\.math\.BigDecimal)|val amount: java\.math' "$models"; then
  echo "TP-4.3: a generated model declares amount with another type" >&2
  exit 1
fi
echo "TP-4.3: passed (compiles; amount is kotlin.Long)"

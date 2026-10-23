plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.vortex.pos"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.vortex.pos"
        minSdk = 24 // Android 7: cubre prácticamente todas las tabletas de caja en uso.
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
    }

    // La APK se firma con la llave de release si está configurada (CI o local); si no, con la de
    // depuración, que igual se instala directo en la tableta ("orígenes desconocidos").
    val llave = System.getenv("VORTEX_KEYSTORE")
    signingConfigs {
        if (llave != null) {
            create("release") {
                storeFile = file(llave)
                storePassword = System.getenv("VORTEX_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("VORTEX_KEY_ALIAS")
                keyPassword = System.getenv("VORTEX_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (llave != null) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.11.0")
    testImplementation("junit:junit:4.13.2")
}

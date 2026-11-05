# App Setup & File Structure

## Full Core Layer File Structure

```
MyApp/
│
├── App/
│   ├── MyApp.swift                         # Composition root — all wiring here
│   └── RootView.swift                      # Entry point view (auth gate / tab bar)
│
├── Core/
│   ├── Config/
│   │   └── AppEnvironment.swift            # dev / staging / production URLs and flags
│   │
│   ├── Networking/
│   │   ├── NetworkClientProtocol.swift     # protocol NetworkClientProtocol: Sendable
│   │   ├── LiveNetworkClient.swift         # URLSession + signposts + 401 retry
│   │   ├── HTTPMethod.swift                # RawRepresentable wrapper over String
│   │   ├── APIEndpoint.swift               # protocol + default extensions
│   │   ├── RequestBuilder.swift            # builds URLRequest, injects auth token
│   │   └── URLSession+Configuration.swift  # makeProduction(), makeImageLoading()
│   │
│   ├── Auth/
│   │   ├── TokenProviderProtocol.swift     # validToken() + refreshToken()
│   │   └── LiveTokenProvider.swift         # actor with refresh coalescing
│   │
│   ├── Errors/
│   │   ├── AppError.swift                  # enum AppError + sub-enums
│   │   └── AppError+LocalizedError.swift   # user-facing messages and recovery
│   │
│   ├── Logging/
│   │   └── AppLogger.swift                 # enum AppLogger with per-category Logger
│   │
│   ├── DI/
│   │   ├── EnvironmentValues+Dependencies.swift  # @Entry keys for all protocols
│   │   └── Placeholders.swift              # placeholder implementations for defaults
│   │
│   └── Presentation/
│       └── View+AppErrorAlert.swift        # .appErrorAlert(error:retryAction:) modifier
│
├── Features/
│   └── Articles/                           # One folder per feature
│       ├── Domain/
│       │   └── Article.swift
│       ├── Data/
│       │   ├── ArticleDTO.swift
│       │   ├── ArticleEntity.swift
│       │   ├── ArticleMapper.swift
│       │   ├── ArticleRepository.swift     # protocol
│       │   └── LiveArticleRepository.swift # @ModelActor implementation
│       ├── Store/
│       │   └── ArticleStore.swift          # @Observable @MainActor
│       └── Views/
│           ├── ArticleListView.swift
│           └── ArticleDetailView.swift
│
└── Tests/
    ├── ArticleStoreTests.swift
    ├── LiveNetworkClientTests.swift
    └── Mocks/
        ├── MockArticleRepository.swift
        └── MockNetworkClient.swift
```

---

## `MyApp.swift` — Full Composition Root

```swift
// App/MyApp.swift
import SwiftUI
import SwiftData
import os

@main
struct MyApp: App {
    @State private var articleStore: ArticleStore
    @State private var authStore: AuthStore

    private let container: ModelContainer
    private let networkClient: LiveNetworkClient
    private let tokenProvider: LiveTokenProvider

    init() {
        AppLogger.lifecycle.notice(
            "App launching — v\(AppVersion.current, privacy: .public)"
        )

        // 1. ModelContainer — must succeed or crash with a clear log
        let modelContainer = Self.makeModelContainer()

        // 2. URLCache — configure before any requests
        URLCache.shared = URLCache(
            memoryCapacity: 20 * 1024 * 1024,
            diskCapacity: 100 * 1024 * 1024
        )

        // 3. Auth & Network stack
        let liveToken = LiveTokenProvider()
        let builder = RequestBuilder(
            baseURL: AppEnvironment.current.baseURL,
            tokenProvider: liveToken
        )
        let liveClient = LiveNetworkClient(
            session: .makeProduction(),
            requestBuilder: builder,
            tokenProvider: liveToken
        )

        // 4. Repositories
        let articleRepo = LiveArticleRepository(
            networkClient: liveClient,
            modelContext: modelContainer.mainContext
        )
        let authRepo = LiveAuthRepository(
            networkClient: liveClient,
            tokenProvider: liveToken
        )

        // 5. Stores
        let aStore = ArticleStore(repository: articleRepo)
        let auStore = AuthStore(repository: authRepo)

        // 6. Assign
        self.container = modelContainer
        self.networkClient = liveClient
        self.tokenProvider = liveToken
        _articleStore = State(initialValue: aStore)
        _authStore = State(initialValue: auStore)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .modelContainer(container)
                .environment(articleStore)
                .environment(authStore)
                .environment(\.networkClient, networkClient)
                .environment(\.tokenProvider, tokenProvider)
        }
    }

    // MARK: - ModelContainer Factory

    private static func makeModelContainer() -> ModelContainer {
        let schema = Schema([
            ArticleEntity.self,
            // Add all @Model types here
        ])

        let config = ModelConfiguration(
            schema: schema,
            isStoredInMemoryOnly: false,
            cloudKitDatabase: .none     // change to .automatic for CloudKit
        )

        do {
            return try ModelContainer(for: schema, configurations: [config])
        } catch {
            // Recovery: fall back to in-memory (data will be lost)
            AppLogger.lifecycle.fault(
                "ModelContainer failed: \(error, privacy: .public). Falling back to in-memory."
            )
            do {
                return try ModelContainer(
                    for: schema,
                    configurations: [ModelConfiguration(isStoredInMemoryOnly: true)]
                )
            } catch {
                AppLogger.lifecycle.fault(
                    "ModelContainer recovery failed: \(error, privacy: .public)"
                )
                fatalError("Cannot create ModelContainer: \(error)")
            }
        }
    }
}
```

---

## `AppVersion`

```swift
// Core/Config/AppVersion.swift
import Foundation

public enum AppVersion {
    public static var current: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"
        return "\(version) (\(build))"
    }
}
```

---

## `RootView` — Auth Gate

```swift
// App/RootView.swift
import SwiftUI

struct RootView: View {
    @Environment(AuthStore.self) private var authStore

    var body: some View {
        Group {
            if authStore.isAuthenticated {
                MainTabView()
            } else {
                AuthFlowView()
            }
        }
        .task { await authStore.restoreSession() }
    }
}
```

---

## Testing: In-Memory Container

For SwiftData tests, always use an in-memory `ModelContainer`. Instantiate it fresh per test suite to prevent state leaking between tests.

```swift
// Tests/Helpers/TestContainer.swift
import SwiftData
import Testing

extension ModelContainer {
    static func makeTestContainer() throws -> ModelContainer {
        let schema = Schema([ArticleEntity.self])
        let config = ModelConfiguration(isStoredInMemoryOnly: true)
        return try ModelContainer(for: schema, configurations: [config])
    }
}

// Usage:
@Suite("ArticleRepository")
struct ArticleRepositoryTests {
    let container: ModelContainer
    let repository: LiveArticleRepository

    init() throws {
        container = try .makeTestContainer()
        repository = LiveArticleRepository(
            networkClient: MockNetworkClient(),
            modelContext: container.mainContext
        )
    }

    @Test("fetchAll returns empty when no data")
    func fetchAllEmpty() async throws {
        let articles = try await repository.fetchAll()
        #expect(articles.isEmpty)
    }
}
```

---

## Dependency Injection in UI Tests

For `XCUITest` targets, use `launchEnvironment` to signal which mock configuration to use:

```swift
// UITests/ArticleUITests.swift
import XCTest

final class ArticleUITests: XCTestCase {
    func testArticleListAppears() throws {
        let app = XCUIApplication()
        app.launchEnvironment["USE_MOCK_DATA"] = "1"
        app.launch()

        XCTAssertTrue(app.staticTexts["Test Article"].waitForExistence(timeout: 5))
    }
}

// App/MyApp.swift — check the env variable
init() {
    #if DEBUG
    if ProcessInfo.processInfo.environment["USE_MOCK_DATA"] == "1" {
        // Wire mock repositories instead of live ones
    }
    #endif
    // ... rest of init
}
```

---

## Rules

- `App.init` is the only composition root — all `Live*` types are instantiated there
- `ModelContainer` creation must have a recovery path before `fatalError` — log the failure at `.fault` level
- Configure `URLCache.shared` in `App.init` before any views appear
- `@State` on `App` for stores gives them app lifetime — equivalent to a singleton but testable
- `RootView` reads `AuthStore` to gate between auth and main flows — it never contains business logic
- All `@Model` types must be registered in the `Schema` array — missing types cause silent data loss
- In-memory `ModelContainer` per test suite — never share a container between test suites

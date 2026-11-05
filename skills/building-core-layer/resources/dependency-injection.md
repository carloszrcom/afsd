# Dependency Injection

## Strategy

All dependencies are instantiated once at the **composition root** (`App.init`) and distributed through two mechanisms:

1. **`@Observable` stores** — injected via `.environment(store)`, accessed with `@Environment(StoreType.self)`
2. **Protocol dependencies** — injected via environment keys (`@Entry` macro or manual `EnvironmentKey`), accessed with `@Environment(\.key)`

No singletons. No service locators. The dependency graph is explicit and visible at the root.

There are two ways to declare environment keys. **The canonical one is whatever the project's CLAUDE.md dictates** — e.g. Hootara (OST) uses the manual `EnvironmentKey` pattern with optional stores. Use `@Entry` only where the project has no established convention.

---

## Manual `EnvironmentKey` — the OST optional-store pattern

In projects following the Observable Store Pattern (e.g. Hootara), stores are registered with a **private `EnvironmentKey` whose default is `nil`**, all grouped in `DI/EnvironmentKeys.swift`. Stores are `Optional` because they are created in `.task {}` after launch (they need `@MainActor` and `ModelContext.mainContext`), so views consume them with optional chaining and never force-unwrap:

```swift
// DI/EnvironmentKeys.swift
private struct StorageStoreKey: EnvironmentKey {
    static let defaultValue: StorageStore? = nil
}

extension EnvironmentValues {
    var storageStore: StorageStore? {
        get { self[StorageStoreKey.self] }
        set { self[StorageStoreKey.self] = newValue }
    }
}

// View
@Environment(\.storageStore) private var store: StorageStore?
// ...
store?.refresh()
```

---

## `@Entry` Macro — Environment Keys without Boilerplate

The `@Entry` macro eliminates the `EnvironmentKey` protocol boilerplate entirely. The property's initial value becomes the default (used in previews and tests that don't configure the full graph):

```swift
// Core/DI/EnvironmentValues+Dependencies.swift
import SwiftUI

extension EnvironmentValues {
    // Network
    @Entry var networkClient: any NetworkClientProtocol = PlaceholderNetworkClient()

    // Repositories
    @Entry var articleRepository: any ArticleRepository = PlaceholderArticleRepository()
    @Entry var authRepository: any AuthRepository = PlaceholderAuthRepository()
    @Entry var userRepository: any UserRepository = PlaceholderUserRepository()

    // Auth
    @Entry var tokenProvider: any TokenProviderProtocol = PlaceholderTokenProvider()
}
```

Placeholder types do the minimum to avoid crashing in uninitialised contexts:

```swift
// Core/DI/Placeholders.swift
struct PlaceholderNetworkClient: NetworkClientProtocol {
    func fetch<T: Decodable & Sendable>(_ endpoint: some APIEndpoint) async throws(AppError) -> T {
        throw AppError.network(.invalidResponse)
    }
}

struct PlaceholderArticleRepository: ArticleRepository {
    func fetchAll() async throws(AppError) -> [Article] { [] }
    func fetch(id: Article.ID) async throws(AppError) -> Article {
        throw AppError.network(.notFound("placeholder"))
    }
    func save(_ article: Article) async throws(AppError) {}
    func delete(id: Article.ID) async throws(AppError) {}
}
```

---

## Composition Root — `App.init`

The composition root is the **only** place where concrete types are instantiated. Every other layer receives abstractions (protocols).

```swift
// App/MyApp.swift
@main
struct MyApp: App {
    // Stores — @State gives them app lifetime
    @State private var articleStore: ArticleStore
    @State private var authStore: AuthStore

    // Infrastructure — held to keep alive (actors/classes)
    private let container: ModelContainer
    private let networkClient: LiveNetworkClient
    private let tokenProvider: LiveTokenProvider

    init() {
        // 1. Persistence
        let modelContainer = Self.makeModelContainer()

        // 2. URLCache
        URLCache.shared = URLCache(
            memoryCapacity: 20 * 1024 * 1024,
            diskCapacity: 100 * 1024 * 1024
        )

        // 3. Auth & Network
        let liveTokenProvider = LiveTokenProvider()
        let requestBuilder = RequestBuilder(
            baseURL: AppEnvironment.current.baseURL,
            tokenProvider: liveTokenProvider
        )
        let liveClient = LiveNetworkClient(
            session: .makeProduction(),
            requestBuilder: requestBuilder,
            tokenProvider: liveTokenProvider
        )

        // 4. Repositories
        let articleRepo = LiveArticleRepository(
            networkClient: liveClient,
            modelContext: modelContainer.mainContext
        )
        let authRepo = LiveAuthRepository(
            networkClient: liveClient,
            tokenProvider: liveTokenProvider
        )

        // 5. Stores
        let aStore = ArticleStore(repository: articleRepo)
        let auStore = AuthStore(repository: authRepo)

        // 6. Assign
        self.container = modelContainer
        self.networkClient = liveClient
        self.tokenProvider = liveTokenProvider
        _articleStore = State(initialValue: aStore)
        _authStore = State(initialValue: auStore)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .modelContainer(container)
                // Observable stores — accessed via @Environment(StoreType.self)
                .environment(articleStore)
                .environment(authStore)
                // Protocol dependencies — accessed via @Environment(\.key)
                .environment(\.networkClient, networkClient)
                .environment(\.tokenProvider, tokenProvider)
        }
    }
}
```

---

## Two Injection Patterns

### Pattern A: `@Observable` store injection (preferred for feature state)

```swift
// App.swift
.environment(articleStore)

// View
struct ArticleListView: View {
    @Environment(ArticleStore.self) private var store

    var body: some View {
        @Bindable var store = store
        List(store.articles) { article in ArticleRow(article: article) }
            .task { await store.load() }
            .appErrorAlert(error: $store.appError)
    }
}
```

### Pattern B: `@Entry` key injection (preferred for infrastructure)

```swift
// App.swift
.environment(\.networkClient, networkClient)

// View that needs raw client access (rare — prefer going through a store)
struct DebugNetworkView: View {
    @Environment(\.networkClient) private var client
    // ...
}

// Store init — repository injected, not the client directly
struct ArticleDetailView: View {
    @Environment(\.articleRepository) private var repository
    @State private var store: ArticleDetailStore?

    var body: some View {
        Group {
            if let store { ArticleDetailContent(store: store) }
        }
        .onAppear {
            if store == nil {
                store = ArticleDetailStore(repository: repository)
            }
        }
    }
}
```

---

## SwiftUI Previews — Injecting Mocks

```swift
// Feature/Mocks/MockArticleRepository.swift
struct MockArticleRepository: ArticleRepository {
    var articles: [Article] = Article.previewData
    var shouldFail = false

    func fetchAll() async throws(AppError) -> [Article] {
        if shouldFail { throw AppError.network(.serverError(500)) }
        return articles
    }
    func fetch(id: Article.ID) async throws(AppError) -> Article {
        guard let a = articles.first(where: { $0.id == id }) else {
            throw AppError.network(.notFound(id.uuidString))
        }
        return a
    }
    func save(_ article: Article) async throws(AppError) {}
    func delete(id: Article.ID) async throws(AppError) {}
}

// Previews
#Preview("Loaded") {
    let store = ArticleStore(repository: MockArticleRepository())
    ArticleListView()
        .environment(store)
}

#Preview("Empty") {
    let store = ArticleStore(repository: MockArticleRepository(articles: []))
    ArticleListView()
        .environment(store)
}

#Preview("Error") {
    let store = ArticleStore(repository: MockArticleRepository(shouldFail: true))
    ArticleListView()
        .environment(store)
}
```

---

## Unit Tests — Injecting Mocks

```swift
// Tests/ArticleStoreTests.swift
import Testing
@testable import MyApp

@MainActor
struct ArticleStoreTests {

    @Test("load populates articles on success")
    func loadSuccess() async throws {
        let mock = MockArticleRepository(articles: [.fixture()])
        let store = ArticleStore(repository: mock)

        await store.load()

        #expect(store.articles.count == 1)
        #expect(store.appError == nil)
        #expect(store.isLoading == false)
    }

    @Test("load sets appError on network failure")
    func loadFailure() async throws {
        let mock = MockArticleRepository(shouldFail: true)
        let store = ArticleStore(repository: mock)

        await store.load()

        #expect(store.articles.isEmpty)
        #expect(store.appError != nil)
    }

    @Test("load sets appError to .network(.serverError) on 500")
    func loadServerError() async throws {
        let mock = MockArticleRepository(shouldFail: true)
        let store = ArticleStore(repository: mock)

        await store.load()

        #expect(store.appError == .network(.serverError(500)))
    }
}

// Test fixtures
extension Article {
    static func fixture(
        id: UUID = .init(),
        title: String = "Test Article",
        body: String = "Body"
    ) -> Article {
        Article(id: id, title: title, body: body)
    }
}
```

---

## `AppEnvironment` — Multi-Environment Config

```swift
// Core/Config/AppEnvironment.swift
public enum AppEnvironment: Sendable {
    case development
    case staging
    case production

    public static var current: AppEnvironment {
        #if DEBUG
        return ProcessInfo.processInfo.environment["APP_ENV"] == "staging"
            ? .staging : .development
        #else
        return .production
        #endif
    }

    public var baseURL: URL {
        switch self {
        case .development: URL(string: "https://api-dev.company.com/v1")!
        case .staging:     URL(string: "https://api-staging.company.com/v1")!
        case .production:  URL(string: "https://api.company.com/v1")!
        }
    }

    public var isDebug: Bool {
        self != .production
    }
}
```

---

## Rules

- **Composition root only** — concrete types are instantiated exclusively in `App.init`; everything else receives protocols
- **No singletons** — `NetworkClient.shared`, `Repository.shared`, etc. make testing impossible and hide dependencies
- Environment keys for infrastructure dependencies (network client, token provider, repositories) — `@Entry` or manual `EnvironmentKey`, following the project's CLAUDE.md; in OST projects the manual optional-store pattern is canonical
- `.environment(store)` for `@Observable` stores — avoids the environment-key pattern for frequently-accessed feature state
- Placeholder implementations in `EnvironmentValues` defaults — prevent crashes in uninitialised contexts (isolated tests, micro-previews)
- Every store, repository, and client must be constructable with just its dependencies (no global state access in `init`)
- `@MainActor` stores are `@State` on `App` — this gives them app lifetime without using a singleton

# AppError — Typed Error Hierarchy

## Design Goals

- One canonical error type for the whole app — no `any Error` boxing at layer boundaries
- Typed throws `throws(AppError)` — exhaustive catch without casting
- `LocalizedError` in a separate extension — keeps the definition clean
- Propagates cleanly from Repository → Store → View without coupling layers

---

## Error Hierarchy

```swift
// Core/Errors/AppError.swift
import Foundation

public enum AppError: Error, Sendable {
    case network(NetworkError)
    case persistence(PersistenceError)
    case auth(AuthError)
    case validation(ValidationError)
}

// MARK: - NetworkError
public enum NetworkError: Error, Sendable {
    case invalidURL(String)
    case urlError(URLError)
    case invalidResponse
    case unexpectedStatusCode(Int)
    case notFound(String)
    case rateLimited
    case serverError(Int)
    case decodingFailed(any Error)
    case encodingFailed(any Error)
    case unknown(any Error)
}

// MARK: - PersistenceError
public enum PersistenceError: Error, Sendable {
    case saveFailed(any Error)
    case fetchFailed(any Error)
    case deleteFailed(any Error)
    case migrationFailed(any Error)
    case containerNotFound
}

// MARK: - AuthError
public enum AuthError: Error, Sendable {
    case sessionExpired
    case forbidden
    case invalidCredentials
    case biometricFailed
    case tokenRefreshFailed
}

// MARK: - ValidationError
public enum ValidationError: Error, Sendable {
    case required(field: String)
    case tooShort(field: String, minimum: Int)
    case tooLong(field: String, maximum: Int)
    case invalidFormat(field: String, reason: String)
    case outOfRange(field: String, range: String)
}
```

> The two-level hierarchy (`AppError.network(.notFound(...))`) avoids deep nesting while keeping the namespace clean. Callers can match at the outer level (`case .network`) or drill into specifics (`case .network(.notFound(let path))`).

---

## `LocalizedError` Conformance

Keep this in a separate file — the definition above stays concise and the localisation logic is isolated:

```swift
// Core/Errors/AppError+LocalizedError.swift
import Foundation

extension AppError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .network(let e):      return e.errorDescription
        case .persistence(let e):  return e.errorDescription
        case .auth(let e):         return e.errorDescription
        case .validation(let e):   return e.errorDescription
        }
    }

    public var recoverySuggestion: String? {
        switch self {
        case .network(let e):             return e.recoverySuggestion
        case .auth(.sessionExpired):      return "Please sign in again to continue."
        case .auth(.forbidden):           return "Contact support if you believe this is an error."
        default:                          return nil
        }
    }
}

extension NetworkError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .invalidURL:            return "The request URL is invalid."
        case .urlError(let e):
            switch e.code {
            case .notConnectedToInternet: return "No internet connection."
            case .timedOut:               return "The request timed out."
            default:                      return e.localizedDescription
            }
        case .invalidResponse:       return "An unexpected response was received."
        case .notFound:              return "The requested resource was not found."
        case .rateLimited:           return "Too many requests. Please try again shortly."
        case .serverError(let code): return "Server error (\(code)). Please try again later."
        case .decodingFailed:        return "Failed to process the server response."
        default:                     return "A network error occurred."
        }
    }

    public var recoverySuggestion: String? {
        switch self {
        case .urlError(let e) where e.code == .notConnectedToInternet:
            return "Check your internet connection and try again."
        case .rateLimited:
            return "Wait a moment before retrying."
        case .serverError:
            return "Try again in a few minutes."
        default:
            return nil
        }
    }
}

extension AuthError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .sessionExpired:     return "Your session has expired."
        case .forbidden:          return "You don't have permission to perform this action."
        case .invalidCredentials: return "Incorrect email or password."
        case .biometricFailed:    return "Biometric authentication failed."
        case .tokenRefreshFailed: return "Unable to refresh your session."
        }
    }
}

extension ValidationError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .required(let f):             return "\(f) is required."
        case .tooShort(let f, let min):    return "\(f) must be at least \(min) characters."
        case .tooLong(let f, let max):     return "\(f) cannot exceed \(max) characters."
        case .invalidFormat(let f, let r): return "\(f) is invalid: \(r)."
        case .outOfRange(let f, let r):    return "\(f) must be in the range \(r)."
        }
    }
}
```

---

## Propagation: Repository → Store → View

### Repository — throws(AppError)

Typed throws means the compiler knows the exact error type at every call site:

```swift
// Feature/Data/ArticleRepositoryImpl.swift
@ModelActor
final class ArticleRepositoryImpl: ArticleRepository {
    func fetchAll() async throws(AppError) -> [Article] {
        do {
            let dtos: [ArticleDTO] = try await networkClient.fetch(ArticlesEndpoint.list(page: 1, limit: 20))
            return dtos.map(ArticleMapper.domain)
        } catch let e as AppError {
            throw e
        } catch {
            throw AppError.persistence(.fetchFailed(error))
        }
    }
}
```

### Store — catches and publishes

The store catches `AppError` (already the concrete type) and exposes it as observable state:

```swift
// Feature/Store/ArticleStore.swift
@Observable @MainActor
final class ArticleStore {
    private(set) var articles: [Article] = []
    private(set) var isLoading = false
    var appError: AppError?

    private let repository: any ArticleRepository

    init(repository: any ArticleRepository) {
        self.repository = repository
    }

    func load() async {
        isLoading = true
        appError = nil
        defer { isLoading = false }

        do {
            articles = try await repository.fetchAll()
        } catch {
            // `error` is AppError — no cast needed thanks to typed throws
            appError = error
            AppLogger.repository.error(
                "Failed to load articles: \(error.localizedDescription, privacy: .public)"
            )
        }
    }
}
```

### View — reads error via modifier, no coupling to concrete error types

```swift
// Shared/Presentation/View+AppErrorAlert.swift
import SwiftUI

extension View {
    func appErrorAlert(
        error: Binding<AppError?>,
        retryAction: (() async -> Void)? = nil
    ) -> some View {
        self.alert(
            "Something went wrong",
            isPresented: Binding(
                get: { error.wrappedValue != nil },
                set: { if !$0 { error.wrappedValue = nil } }
            ),
            presenting: error.wrappedValue
        ) { appError in
            Button("Dismiss", role: .cancel) {
                error.wrappedValue = nil
            }
            if let retry = retryAction {
                Button("Retry") {
                    Task { await retry() }
                }
            }
        } message: { appError in
            VStack(alignment: .leading, spacing: 4) {
                if let description = appError.errorDescription {
                    Text(description)
                }
                if let suggestion = appError.recoverySuggestion {
                    Text(suggestion)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}

// Feature/Views/ArticleListView.swift
struct ArticleListView: View {
    @Environment(ArticleStore.self) private var store

    var body: some View {
        @Bindable var store = store
        List(store.articles) { article in
            ArticleRow(article: article)
        }
        .task { await store.load() }
        .appErrorAlert(error: $store.appError, retryAction: store.load)
    }
}
```

The view never imports or references `NetworkError`, `PersistenceError`, or any concrete error case. It only knows `AppError` via the store's published property.

---

## Equatable Conformance for Testing

Add `Equatable` to `AppError` for use in test assertions:

```swift
// Core/Errors/AppError+Equatable.swift
// (Only compile in test targets if you prefer)
extension AppError: Equatable {
    public static func == (lhs: AppError, rhs: AppError) -> Bool {
        switch (lhs, rhs) {
        case (.network(let l), .network(let r)):         return l == r
        case (.auth(let l), .auth(let r)):               return l == r
        case (.validation(let l), .validation(let r)):   return l == r
        default: return false
        }
    }
}

extension AuthError: Equatable {}
extension ValidationError: Equatable {}
extension NetworkError: Equatable {
    public static func == (lhs: NetworkError, rhs: NetworkError) -> Bool {
        switch (lhs, rhs) {
        case (.invalidResponse, .invalidResponse):       return true
        case (.rateLimited, .rateLimited):               return true
        case (.notFound(let l), .notFound(let r)):       return l == r
        case (.serverError(let l), .serverError(let r)): return l == r
        default: return false
        }
    }
}

// Test usage:
#expect(store.appError == .auth(.sessionExpired))
```

---

## Rules

- `throws(AppError)` at every layer — never `throws` (untyped) at internal boundaries
- `LocalizedError` in a separate extension file — keeps the enum definition scannable
- Stores expose `var appError: AppError?` — views read it via `appErrorAlert(error:)` view modifier
- Views never import or switch on concrete error cases — they only present via `errorDescription` and `recoverySuggestion`
- Add `Equatable` conformance in a separate extension (or test target only) — needed for `#expect` assertions
- `URLError` cases are preserved inside `NetworkError.urlError` — never flatten them into a generic message
- `CancellationError` must be caught before `AppError` at the top level — task cancellation is not a user-facing error

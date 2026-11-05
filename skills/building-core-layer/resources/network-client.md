# NetworkClient

## Architecture

```
APIEndpoint (protocol)          ← defines what to request
    ↓
RequestBuilder                  ← builds URLRequest, injects auth token
    ↓
LiveNetworkClient               ← executes, validates, decodes, retries on 401
    ↓
TokenProvider (actor)           ← refreshes token; coalesces concurrent refresh calls
```

---

## `HTTPMethod`

Foundation exposes `URLRequest.httpMethod` as `String?` with no type safety. Define a `RawRepresentable` wrapper so callers can extend it without modifying the core module:

```swift
// Core/Networking/HTTPMethod.swift
public struct HTTPMethod: RawRepresentable, Sendable, Hashable {
    public let rawValue: String
    public init(rawValue: String) { self.rawValue = rawValue }

    public static let get    = HTTPMethod(rawValue: "GET")
    public static let post   = HTTPMethod(rawValue: "POST")
    public static let put    = HTTPMethod(rawValue: "PUT")
    public static let patch  = HTTPMethod(rawValue: "PATCH")
    public static let delete = HTTPMethod(rawValue: "DELETE")
}
```

---

## `APIEndpoint` Protocol

Each feature defines its endpoints as an enum conforming to `APIEndpoint`. The protocol is `Sendable` so endpoints can cross actor boundaries safely.

```swift
// Core/Networking/APIEndpoint.swift
public protocol APIEndpoint: Sendable {
    var path: String { get }
    var method: HTTPMethod { get }
    var queryItems: [URLQueryItem] { get }
    var body: (any Encodable & Sendable)? { get }
    var requiresAuth: Bool { get }
    var headers: [String: String] { get }
}

public extension APIEndpoint {
    var queryItems: [URLQueryItem] { [] }
    var body: (any Encodable & Sendable)? { nil }
    var requiresAuth: Bool { true }
    var headers: [String: String] { [:] }
}

// Feature usage:
enum ArticlesEndpoint: APIEndpoint {
    case list(page: Int, limit: Int)
    case detail(id: String)
    case create(body: CreateArticleRequest)

    var path: String {
        switch self {
        case .list:          return "/articles"
        case .detail(let id): return "/articles/\(id)"
        case .create:        return "/articles"
        }
    }

    var method: HTTPMethod {
        switch self {
        case .list, .detail: return .get
        case .create:        return .post
        }
    }

    var queryItems: [URLQueryItem] {
        switch self {
        case .list(let page, let limit):
            return [.init(name: "page", value: "\(page)"),
                    .init(name: "limit", value: "\(limit)")]
        default: return []
        }
    }

    var body: (any Encodable & Sendable)? {
        switch self {
        case .create(let b): return b
        default: return nil
        }
    }
}
```

---

## `NetworkClientProtocol`

The protocol is `Sendable` — it can be stored in actors and injected through the SwiftUI environment under strict concurrency.

```swift
// Core/Networking/NetworkClientProtocol.swift
public protocol NetworkClientProtocol: Sendable {
    func fetch<T: Decodable & Sendable>(
        _ endpoint: some APIEndpoint
    ) async throws(AppError) -> T
}
```

---

## `RequestBuilder`

Builds `URLRequest` from an `APIEndpoint`. Injects the auth token and encodes the body. Separate from `LiveNetworkClient` so it can be tested in isolation and swapped (e.g., for multipart uploads).

```swift
// Core/Networking/RequestBuilder.swift
public struct RequestBuilder: Sendable {
    let baseURL: URL
    let tokenProvider: any TokenProviderProtocol
    let encoder: JSONEncoder

    public init(
        baseURL: URL,
        tokenProvider: any TokenProviderProtocol,
        encoder: JSONEncoder = .init()
    ) {
        self.baseURL = baseURL
        self.tokenProvider = tokenProvider
        self.encoder = encoder
    }

    func build(from endpoint: some APIEndpoint) async throws(AppError) -> URLRequest {
        var components = URLComponents(
            url: baseURL.appending(path: endpoint.path),
            resolvingAgainstBaseURL: true
        )
        if !endpoint.queryItems.isEmpty {
            components?.queryItems = endpoint.queryItems
        }

        guard let url = components?.url else {
            throw AppError.network(.invalidURL(endpoint.path))
        }

        var request = URLRequest(url: url)
        request.httpMethod = endpoint.method.rawValue
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        for (key, value) in endpoint.headers {
            request.setValue(value, forHTTPHeaderField: key)
        }

        if endpoint.requiresAuth {
            let token = try await tokenProvider.validToken()
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        if let body = endpoint.body {
            do {
                request.httpBody = try encoder.encode(body)
            } catch {
                throw AppError.network(.encodingFailed(error))
            }
        }

        return request
    }
}
```

---

## `LiveNetworkClient`

Executes requests, validates HTTP status codes, decodes responses, and handles 401 with a single retry after token refresh.

### Sendable note on `JSONDecoder`

`JSONDecoder` does not conform to `Sendable` in the standard library. `LiveNetworkClient` stores it as a `let` constant written once in `init` and never mutated after that — so it is safe to access from any concurrency context. Mark the class `@unchecked Sendable` and annotate `decoder` with `nonisolated(unsafe)` to communicate this to the compiler:

```swift
// Core/Networking/LiveNetworkClient.swift
import Foundation
import os

// @unchecked Sendable: all stored properties are either Sendable or write-once
// in init and never mutated. `decoder` is nonisolated(unsafe) for this reason.
public final class LiveNetworkClient: NetworkClientProtocol, @unchecked Sendable {
    private let session: URLSession                        // Sendable ✓
    private let requestBuilder: RequestBuilder             // Sendable ✓
    private let tokenProvider: any TokenProviderProtocol   // Sendable ✓
    private let signposter: OSSignposter                   // Sendable ✓
    // Write-once in init, never mutated — safe to access from any context
    nonisolated(unsafe) private let decoder: JSONDecoder

    public init(
        session: URLSession,
        decoder: JSONDecoder = .isoDecoder,
        requestBuilder: RequestBuilder,
        tokenProvider: any TokenProviderProtocol
    ) {
        self.session = session
        self.decoder = decoder
        self.requestBuilder = requestBuilder
        self.tokenProvider = tokenProvider
        self.signposter = OSSignposter(logger: AppLogger.network)
    }

    public func fetch<T: Decodable & Sendable>(
        _ endpoint: some APIEndpoint
    ) async throws(AppError) -> T {
        let id = signposter.makeSignpostID()
        let state = signposter.beginInterval(
            "fetch", id: id,
            "\(endpoint.method.rawValue, privacy: .public) \(endpoint.path, privacy: .public)"
        )
        defer { signposter.endInterval("fetch", state) }

        // Build request and execute once
        let request = try await requestBuilder.build(from: endpoint)
        let (data, statusCode) = try await send(request, path: endpoint.path)

        // 401 — refresh token and retry once (linear, no recursion)
        if statusCode == 401 {
            do { try await tokenProvider.refreshToken() }
            catch { throw AppError.auth(.sessionExpired) }

            let retryRequest = try await requestBuilder.build(from: endpoint)
            let (retryData, retryStatus) = try await send(retryRequest, path: endpoint.path)

            guard retryStatus != 401 else { throw AppError.auth(.sessionExpired) }
            return try decode(retryData, as: T.self)
        }

        return try decode(data, as: T.self)
    }

    // MARK: - Private: HTTP execution + status validation

    /// Sends a request and validates the HTTP status code.
    /// Returns (body data, status code) on success range 200-299.
    /// Throws AppError for all other status codes.
    private func send(_ request: URLRequest, path: String) async throws(AppError) -> (Data, Int) {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let e as URLError {
            AppLogger.network.error("URLError: \(e.localizedDescription, privacy: .public)")
            throw AppError.network(.urlError(e))
        } catch {
            throw AppError.network(.unknown(error))
        }

        guard let http = response as? HTTPURLResponse else {
            throw AppError.network(.invalidResponse)
        }

        AppLogger.network.debug("\(http.statusCode, privacy: .public) \(path, privacy: .public)")

        switch http.statusCode {
        case 200..<300: return (data, http.statusCode)
        case 401:       return (data, 401)   // Caller handles retry
        case 403:       throw AppError.auth(.forbidden)
        case 404:       throw AppError.network(.notFound(path))
        case 429:       throw AppError.network(.rateLimited)
        case 500..<600: throw AppError.network(.serverError(http.statusCode))
        default:        throw AppError.network(.unexpectedStatusCode(http.statusCode))
        }
    }

    // MARK: - Private: Decoding

    private func decode<T: Decodable>(_ data: Data, as type: T.Type) throws(AppError) -> T {
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            AppLogger.network.error(
                "Decoding \(String(describing: T.self), privacy: .public) failed: \(error, privacy: .public)"
            )
            throw AppError.network(.decodingFailed(error))
        }
    }
}

// MARK: - JSONDecoder convenience
extension JSONDecoder {
    static var isoDecoder: JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }
}
```

---

## `URLSession` Production Configuration

```swift
// Core/Networking/URLSession+Configuration.swift
import Foundation

extension URLSession {
    /// General API session — respects server Cache-Control headers.
    static func makeProduction() -> URLSession {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 300
        config.waitsForConnectivity = true      // Queue, don't fail, when offline
        config.urlCache = URLCache.shared
        config.requestCachePolicy = .useProtocolCachePolicy
        config.httpMaximumConnectionsPerHost = 6
        return URLSession(configuration: config)
    }

    /// Dedicated image session with its own larger disk cache.
    static func makeImageLoading() -> URLSession {
        let config = URLSessionConfiguration.default
        config.urlCache = URLCache(
            memoryCapacity: 50 * 1024 * 1024,
            diskCapacity: 200 * 1024 * 1024,
            directory: nil
        )
        config.requestCachePolicy = .returnCacheDataElseLoad
        config.timeoutIntervalForRequest = 15
        config.waitsForConnectivity = true
        return URLSession(configuration: config)
    }
}
```

---

## `TokenProvider` — Actor with Refresh Coalescing

An `actor` prevents the thundering-herd problem: if 10 requests fire simultaneously with an expired token, only one refresh network call is made. The other 9 await the same `Task`.

```swift
// Core/Auth/TokenProviderProtocol.swift
public protocol TokenProviderProtocol: Sendable {
    func validToken() async throws(AppError) -> String
    func refreshToken() async throws(AppError)
}

// Core/Auth/LiveTokenProvider.swift
public actor LiveTokenProvider: TokenProviderProtocol {
    private var accessToken: String?
    private var expiresAt: Date?
    private var refreshTask: Task<Void, any Error>?

    public func validToken() async throws(AppError) -> String {
        if let token = accessToken, let exp = expiresAt, exp > .now {
            return token
        }
        try await refreshToken()
        guard let token = accessToken else {
            throw AppError.auth(.tokenRefreshFailed)
        }
        return token
    }

    public func refreshToken() async throws(AppError) {
        // Coalesce concurrent refresh attempts
        if let existing = refreshTask {
            do { try await existing.value }
            catch { throw AppError.auth(.tokenRefreshFailed) }
            return
        }

        let task = Task<Void, any Error> {
            // Perform actual token refresh network call
            // self.accessToken = newToken
            // self.expiresAt = newExpiry
        }
        refreshTask = task
        defer { refreshTask = nil }

        do { try await task.value }
        catch { throw AppError.auth(.tokenRefreshFailed) }
    }

    /// Called at sign-in to store the initial tokens.
    public func store(accessToken: String, expiresAt: Date) {
        self.accessToken = accessToken
        self.expiresAt = expiresAt
    }

    public func clear() {
        accessToken = nil
        expiresAt = nil
        refreshTask = nil
    }
}
```

---

## Rules

- `NetworkClientProtocol: Sendable` — required for actor-safe injection and environment storage
- `throws(AppError)` on `fetch` — eliminates `any Error` boxing; callers get exhaustive catch
- `LiveNetworkClient` is `@unchecked Sendable` — all properties are `Sendable` except `JSONDecoder`, which is `nonisolated(unsafe)` (write-once in `init`, never mutated)
- 401 handling is **linear, not recursive** — `send()` returns `(Data, 401)`, `fetch()` refreshes and calls `send()` a second time directly; no self-call risk
- `send()` and `decode()` are extracted private methods — each has a single responsibility and is independently testable
- `RequestBuilder` is separate from `LiveNetworkClient` — testable independently, swappable for multipart
- `JSONDecoder.keyDecodingStrategy = .convertFromSnakeCase` centralised — DTOs use camelCase in Swift, snake_case on wire
- `waitsForConnectivity = true` — Apple's recommendation for production; queues requests during offline transitions
- `TokenProvider` must be an `actor` — prevents concurrent refresh thundering-herd without manual locking
- Never log auth tokens with `.public` privacy — they are `.private` by default and must stay that way

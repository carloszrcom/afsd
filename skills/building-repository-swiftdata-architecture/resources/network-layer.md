# Network Layer

## 5. NetworkManager

```swift
import Foundation
import OSLog

final class NetworkManager: Sendable {
    static let shared = NetworkManager()
    private init() {}

    func fetchWithRetry<T: Codable>(
        from endpoint: APIEndpoint,
        maxRetries: Int = 3
    ) async throws -> T {
        var lastError: Error?

        for attempt in 1...maxRetries {
            do {
                let (data, response) = try await URLSession.shared.data(from: endpoint.url)

                guard let httpResponse = response as? HTTPURLResponse else {
                    throw NetworkError.invalidResponse
                }
                guard (200...299).contains(httpResponse.statusCode) else {
                    throw NetworkError.httpError(statusCode: httpResponse.statusCode)
                }

                return try JSONDecoder().decode(T.self, from: data)

            } catch {
                lastError = error
                Logger.network.warning("Attempt \(attempt)/\(maxRetries) failed: \(error)")
                if attempt < maxRetries {
                    try await Task.sleep(for: .seconds(1))
                }
            }
        }
        throw lastError ?? NetworkError.unknown
    }
}
```

---

## 6. APIEndpoint

```swift
enum APIEndpoint {
    case gamesList
    case gameDetail(id: Int)

    var url: URL {
        let base = "https://api.example.com"
        switch self {
        case .gamesList:
            return URL(string: "\(base)/games")!
        case .gameDetail(let id):
            return URL(string: "\(base)/game?id=\(id)")!
        }
    }
}
```

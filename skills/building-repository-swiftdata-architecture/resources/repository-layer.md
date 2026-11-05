# Repository Layer

## 7. Repository Protocol

```swift
protocol GameRepositoryProtocol: Sendable {
    func fetchGames(forceRefresh: Bool) async throws(AppError) -> [Game]
    func fetchGameDetail(id: Int, forceRefresh: Bool) async throws(AppError) -> GameDetail
}
```

- `Sendable` para uso seguro en concurrencia
- `throws(AppError)` para typed throws (Swift 6)
- Permite inyección de mocks en tests

---

## 8. Repository Implementation (caché-first)

```swift
import SwiftData
import OSLog

@Observable
@MainActor
final class GameRepositoryImpl: GameRepositoryProtocol {

    private let modelContext: ModelContext
    private let networkManager: NetworkManager

    // Swift 6.2: los valores por defecto de parámetros se evalúan en contexto
    // nonisolated, aunque el init sea @MainActor. Por eso NO se puede usar
    // `= .shared` directamente — hay que resolverlo dentro del cuerpo del init.
    init(modelContext: ModelContext, networkManager: NetworkManager? = nil) {
        self.modelContext = modelContext
        self.networkManager = networkManager ?? .shared
    }

    func fetchGames(forceRefresh: Bool = false) async throws(AppError) -> [Game] {
        if !forceRefresh {
            let cached = try fetchGamesFromCache()
            if !cached.isEmpty && !isCacheExpired(cached.first?.cachedAt) {
                return cached.map { GameMapper.toModel(from: $0) }
            }
        }

        do {
            let dtos: [GameDTO] = try await networkManager.fetchWithRetry(from: .gamesList)
            let games = dtos.map { GameMapper.toModel(from: $0) }
            saveGamesToCache(games)
            return games
        } catch {
            throw AppError.from(error)
        }
    }

    // MARK: - Cache

    private func fetchGamesFromCache() throws(AppError) -> [GameEntity] {
        let descriptor = FetchDescriptor<GameEntity>(sortBy: [SortDescriptor(\.title)])
        do {
            return try modelContext.fetch(descriptor)
        } catch {
            throw AppError.database("Error al obtener datos del cache")
        }
    }

    private func saveGamesToCache(_ games: [Game]) {
        for game in games {
            let gameId = game.id
            let predicate = #Predicate<GameEntity> { $0.id == gameId }
            let descriptor = FetchDescriptor<GameEntity>(predicate: predicate)

            do {
                if let existing = try modelContext.fetch(descriptor).first {
                    // Upsert: actualizar existente
                    existing.title = game.title
                    existing.thumbnail = game.thumbnail
                    existing.cachedAt = Date()
                } else {
                    // Insertar nuevo
                    modelContext.insert(GameMapper.toEntity(from: game))
                }
            } catch {
                Logger.database.error("Error upserting game \(game.id): \(error)")
            }
        }
        try? modelContext.save()
    }

    private func isCacheExpired(_ cachedDate: Date?) -> Bool {
        guard let cachedDate else { return true }
        return Date().timeIntervalSince(cachedDate) > 86400 // 24h TTL
    }
}
```

**Flujo caché-first:**
1. Buscar en SwiftData (< 100ms)
2. Validar TTL (24h por defecto)
3. Si válido → retornar sin red
4. Si expirado → fetch API → upsert en cache → retornar

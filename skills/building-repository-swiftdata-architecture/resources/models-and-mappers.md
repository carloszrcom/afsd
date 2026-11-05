# Models y Mappers

## 1. Domain Model

Modelo limpio usado en TODA la app:

```swift
struct Game: Identifiable, Codable, Hashable {
    let id: Int
    let title: String
    let thumbnail: String
    let shortDescription: String
    let gameUrl: String
    let genre: String
    let platform: String
    let publisher: String
    let developer: String
    let releaseDate: Date
    let profileUrl: String
}
```

- `struct` inmutable (value type)
- Nombres en `camelCase`
- `Identifiable` para SwiftUI
- `Codable` para serialización opcional
- `Hashable` para NavigationPath
- Sin dependencias de frameworks externos

---

## 2. DTO (Data Transfer Object)

Estructura EXACTA del JSON del servidor:

```swift
struct GameDTO: Codable {
    let id: Int
    let title: String
    let thumbnail: String
    let short_description: String       // snake_case del servidor
    let game_url: String
    let genre: String
    let platform: String
    let publisher: String
    let developer: String
    let release_date: String            // String, se convierte en Mapper
    let freetogame_profile_url: String
}

// Cuando los nombres no coinciden exactamente:
struct GameDTO: Codable {
    let id: Int
    let profileUrl: String

    enum CodingKeys: String, CodingKey {
        case id
        case profileUrl = "freetogame_profile_url"
    }
}
```

- Solo `Codable` (no Identifiable, no Hashable)
- Tipos primitivos (String, Int)
- Solo se usa en NetworkManager
- Vida útil < 1 segundo (se convierte a Domain Model inmediatamente)

---

## 3. Entity (Modelo de Persistencia SwiftData)

```swift
import SwiftData

@Model
final class GameEntity {
    @Attribute(.unique) var id: Int
    var title: String
    var thumbnail: String
    var shortDescription: String
    var gameUrl: String
    var genre: String
    var platform: String
    var publisher: String
    var developer: String
    var releaseDate: Date
    var profileUrl: String
    var cachedAt: Date  // Metadata para control de TTL

    init(id: Int, title: String, thumbnail: String,
         shortDescription: String, gameUrl: String,
         genre: String, platform: String, publisher: String,
         developer: String, releaseDate: Date, profileUrl: String,
         cachedAt: Date = Date()) {
        self.id = id; self.title = title; self.thumbnail = thumbnail
        self.shortDescription = shortDescription; self.gameUrl = gameUrl
        self.genre = genre; self.platform = platform; self.publisher = publisher
        self.developer = developer; self.releaseDate = releaseDate
        self.profileUrl = profileUrl; self.cachedAt = cachedAt
    }
}
```

- `@Model` macro de SwiftData
- `class` (requerido por SwiftData)
- `@Attribute(.unique)` para clave primaria
- `cachedAt` para control de TTL

---

## 4. Mappers

Conversión centralizada entre capas:

```swift
enum GameMapper {

    // DTO → Domain Model
    static func toModel(from dto: GameDTO) -> Game {
        Game(
            id: dto.id,
            title: dto.title,
            thumbnail: dto.thumbnail,
            shortDescription: dto.short_description,
            gameUrl: dto.game_url,
            genre: dto.genre,
            platform: dto.platform,
            publisher: dto.publisher,
            developer: dto.developer,
            releaseDate: ISO8601DateFormatter().date(from: dto.release_date) ?? Date(),
            profileUrl: dto.freetogame_profile_url
        )
    }

    // Domain Model → Entity
    static func toEntity(from model: Game) -> GameEntity {
        GameEntity(
            id: model.id, title: model.title, thumbnail: model.thumbnail,
            shortDescription: model.shortDescription, gameUrl: model.gameUrl,
            genre: model.genre, platform: model.platform, publisher: model.publisher,
            developer: model.developer, releaseDate: model.releaseDate,
            profileUrl: model.profileUrl, cachedAt: Date()
        )
    }

    // Entity → Domain Model
    static func toModel(from entity: GameEntity) -> Game {
        Game(
            id: entity.id, title: entity.title, thumbnail: entity.thumbnail,
            shortDescription: entity.shortDescription, gameUrl: entity.gameUrl,
            genre: entity.genre, platform: entity.platform, publisher: entity.publisher,
            developer: entity.developer, releaseDate: entity.releaseDate,
            profileUrl: entity.profileUrl
        )
    }
}
```

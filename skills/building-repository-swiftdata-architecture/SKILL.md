---
name: building-repository-swiftdata-architecture
description: Implements a full Repository pattern with SwiftData caching, network layer, and @Observable stores. Covers Domain Model, DTO, Entity separation, Mappers, cache-first strategy with TTL, typed throws, and Environment-based dependency injection. Use when building data layers, implementing offline-first caching, connecting APIs to SwiftData, or creating stores for SwiftUI views.
---

# Arquitectura Repository + SwiftData

## Contexto
- iOS 26+ / macOS 26+, Swift 6.2, SwiftData (no Core Data)
- Arquitectura: Vista → Store → Repository → (Cache | Network)
- @MainActor en Repository y Stores para thread-safety con ModelContext

## Diagrama de capas

```
Vista (SwiftUI)
    ↓
Store (@Observable @MainActor)
    ↓
Repository (Protocol + Impl @MainActor)
    ↓         ↘
Cache          Network
(SwiftData)   (URLSession)
    ↓               ↓
Entity            DTO
    ↘           ↙
     Domain Model
```

## Reglas absolutas

### ❌ NUNCA:
- Usar `ObservableObject` (usar `@Observable`)
- Mezclar Domain Models con DTOs o Entities
- Poner lógica de negocio en las vistas
- Acceder a SwiftData desde múltiples threads
- Borrar todo el cache en cada actualización (usar upsert)
- Usar `@unchecked Sendable` en Repository
- Crear stores en cada vista (usar compartidos cuando tenga sentido)

### ✅ SIEMPRE:
- 3 modelos distintos: Domain Model / DTO / Entity
- Repository con protocolo (para mocks en tests)
- Estrategia caché-first con TTL
- Typed throws (Swift 6): `throws(AppError)`
- `@MainActor` en Repository e Implementation

## Capas de la arquitectura

Cada capa tiene su propia referencia con código completo y reglas:

- Para **Domain Model, DTO, Entity y Mappers**, consultar [resources/models-and-mappers.md](resources/models-and-mappers.md)
- Para **NetworkManager y APIEndpoint**, consultar [resources/network-layer.md](resources/network-layer.md)
- Para **Repository Protocol e Implementation** con cache-first, consultar [resources/repository-layer.md](resources/repository-layer.md)
- Para **ObservableStore, AppError y Store**, consultar [resources/store-and-errors.md](resources/store-and-errors.md)
- Para **Vista, Environment Keys y App entry point**, consultar [resources/view-and-app-entry.md](resources/view-and-app-entry.md)

## Flujo completo de datos

### Primer lanzamiento (con internet):
```
loadGames() → fetchGames(forceRefresh: false)
→ SwiftData vacío → NetworkManager → JSON → [GameDTO]
→ Mapper → [Game] → saveGamesToCache() → UI actualizada
```

### Segundo lanzamiento (cache válido < 24h):
```
loadGames() → fetchGames(forceRefresh: false)
→ SwiftData → datos válidos → Mapper → [Game] → UI actualizada
⚡ Total: < 100ms, sin red
```

### Pull-to-refresh:
```
refresh() → fetchGames(forceRefresh: true)
→ Ignora cache → NetworkManager → datos frescos
→ Upsert en SwiftData → UI actualizada
```

## Checklist de implementación

### Modelos:
- [ ] Domain Model (struct, Codable, Identifiable, Hashable)
- [ ] DTO (struct, Codable, snake_case exacto del servidor)
- [ ] Entity (@Model, class, @Attribute(.unique), cachedAt)

### Conversión:
- [ ] Mapper con métodos estáticos (enum sin casos)
- [ ] DTO → Model, Model → Entity, Entity → Model

### Networking:
- [ ] NetworkManager Sendable con retry
- [ ] APIEndpoint enum tipado

### Repository:
- [ ] Protocol (Sendable, typed throws)
- [ ] Implementation (@MainActor, @Observable)
- [ ] fetchFromCache() + saveToCache() con upsert
- [ ] isCacheExpired() con TTL configurable

### Store:
- [ ] @Observable @MainActor
- [ ] Conforma ObservableStore
- [ ] loadData(), refresh()
- [ ] Computed properties para filtros/búsqueda

### SwiftData:
- [ ] ModelContainer en App
- [ ] FetchDescriptor para queries
- [ ] #Predicate para filtros tipados

### Vista:
- [ ] @Environment para Store
- [ ] 4 estados UI: loading, empty, error, success
- [ ] .refreshable() y .searchable()

### Errores:
- [ ] AppError con LocalizedError
- [ ] from() converter desde errores del sistema
- [ ] recoverySuggestion para cada caso

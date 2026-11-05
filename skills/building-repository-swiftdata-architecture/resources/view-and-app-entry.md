# Vista y App Entry Point

## 12. Vista SwiftUI

```swift
import SwiftUI

struct GamesListView: View {
    @Environment(\.gamesListStore) private var store

    var body: some View {
        NavigationStack {
            Group {
                if let store = store {
                    contentView(store: store)
                } else {
                    LoadingView(message: "Inicializando...")
                }
            }
            .navigationTitle("Juegos")
        }
    }

    @ViewBuilder
    private func contentView(store: GamesListStore) -> some View {
        if store.isLoading && store.games.isEmpty {
            LoadingView(message: "Cargando juegos...")

        } else if store.games.isEmpty && !store.isLoading {
            ContentUnavailableView(
                "No hay juegos",
                systemImage: "gamecontroller",
                description: Text("Intenta refrescar la lista")
            )

        } else {
            List(store.filteredGames) { game in
                GameRowView(game: game)
            }
            .searchable(
                text: Binding(get: { store.searchText },
                              set: { store.searchText = $0 })
            )
            .refreshable { await store.refresh() }
        }
    }
}
```

- Store inyectado vía `@Environment`
- Estados claros: loading / empty / success / error
- `.searchable()` + `.refreshable()` nativos

---

## 13. Environment Keys (Inyección de dependencias)

```swift
import SwiftUI

// Repository
private struct GameRepositoryKey: EnvironmentKey {
    static let defaultValue: GameRepositoryProtocol? = nil
}
extension EnvironmentValues {
    var gameRepository: GameRepositoryProtocol? {
        get { self[GameRepositoryKey.self] }
        set { self[GameRepositoryKey.self] = newValue }
    }
}

// Store compartido
private struct GamesListStoreKey: EnvironmentKey {
    static let defaultValue: GamesListStore? = nil
}
extension EnvironmentValues {
    var gamesListStore: GamesListStore? {
        get { self[GamesListStoreKey.self] }
        set { self[GamesListStoreKey.self] = newValue }
    }
}
```

> Alternativa con menos boilerplate: el macro `@Entry` (`extension EnvironmentValues { @Entry var gamesListStore: GamesListStore? = nil }`). Usa el patrón que dicte el CLAUDE.md del proyecto — en proyectos OST el manual con stores opcionales es el canónico.

---

## 14. App Entry Point

```swift
import SwiftUI
import SwiftData

@main
struct MyApp: App {

    let modelContainer: ModelContainer
    private let gameRepository: GameRepositoryProtocol
    @State private var gamesListStore: GamesListStore?

    init() {
        do {
            modelContainer = try ModelContainer(for: GameEntity.self, GameDetailEntity.self)
            gameRepository = GameRepositoryImpl(modelContext: modelContainer.mainContext)
        } catch {
            fatalError("Failed to configure SwiftData: \(error)")
        }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .modelContainer(modelContainer)
                .environment(\.gameRepository, gameRepository)
                .environment(\.gamesListStore, gamesListStore)
                .task {
                    if gamesListStore == nil {
                        let store = GamesListStore(repository: gameRepository)
                        gamesListStore = store
                        await store.loadGames()
                    }
                }
        }
    }
}
```

**Patrón de inyección:**
- `ModelContainer` → Singleton para toda la app
- `Repository` → Singleton (protocolo inyectado)
- `GamesListStore` → Shared (preserva estado entre pantallas)
- `GameDetailStore` → Local en la vista que lo necesite

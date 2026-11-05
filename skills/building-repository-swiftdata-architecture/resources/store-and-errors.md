# Store y Errores

## 9. ObservableStore Protocol (Base reutilizable)

```swift
import Foundation
import OSLog

protocol ObservableStore: AnyObject {
    associatedtype DataType
    var data: DataType? { get set }
    var isLoading: Bool { get set }
    var error: AppError? { get set }
}

extension ObservableStore {
    var hasError: Bool { error != nil }
    var errorMessage: String? { error?.errorDescription }
    var recoverySuggestion: String? { error?.recoverySuggestion }

    func clearError() {
        error = nil
        Logger.store.debug("Error cleared")
    }

    func setLoading(_ loading: Bool) {
        isLoading = loading
        if loading { error = nil }
    }

    func setError(_ error: Error) {
        self.error = AppError.from(error)
        isLoading = false
        Logger.store.error("Error set: \(error)")
    }

    func setData(_ data: DataType?) {
        self.data = data
        isLoading = false
        error = nil
    }
}
```

- `AnyObject` restringe a clases (compatible con @Observable)
- Default implementations (no duplicar código en cada Store)
- Sin `mutating` (no son structs)

---

## 10. AppError (Errores tipados)

```swift
import Foundation

enum AppError: Error, LocalizedError {
    case network(String)
    case database(String)
    case notFound
    case parsing(String)
    case unknown

    var errorDescription: String? {
        switch self {
        case .network(let msg):   return "Error de red: \(msg)"
        case .database(let msg):  return "Error de base de datos: \(msg)"
        case .notFound:           return "No se encontraron datos"
        case .parsing(let msg):   return "Error al procesar datos: \(msg)"
        case .unknown:            return "Error desconocido"
        }
    }

    var recoverySuggestion: String? {
        switch self {
        case .network:   return "Verifica tu conexión a internet e intenta de nuevo"
        case .database:  return "Intenta reiniciar la aplicación"
        case .notFound:  return "Intenta refrescar la lista"
        case .parsing:   return "Contacta con soporte si el problema persiste"
        case .unknown:   return "Intenta de nuevo más tarde"
        }
    }

    static func from(_ error: Error) -> AppError {
        if let appError = error as? AppError { return appError }

        if let urlError = error as? URLError {
            switch urlError.code {
            case .notConnectedToInternet: return .network("No hay conexión a internet")
            case .timedOut:               return .network("Tiempo de espera agotado")
            default:                      return .network(urlError.localizedDescription)
            }
        }

        if error is DecodingError { return .parsing("Error al decodificar respuesta") }

        return .unknown
    }
}
```

---

## 11. Store (ViewModel con @Observable)

```swift
import Foundation
import OSLog

@MainActor
@Observable
final class GamesListStore: ObservableStore {

    // Conformance ObservableStore
    var data: [Game]?
    var isLoading = false
    var error: AppError?

    // Propiedades específicas
    var searchText = ""

    private let repository: GameRepositoryProtocol

    // Computed
    var games: [Game] { data ?? [] }

    var filteredGames: [Game] {
        guard let games = data else { return [] }
        if searchText.isEmpty { return games }
        return games.filter {
            $0.title.localizedCaseInsensitiveContains(searchText) ||
            $0.genre.localizedCaseInsensitiveContains(searchText)
        }
    }

    init(repository: GameRepositoryProtocol) {
        self.repository = repository
    }

    func loadGames(forceRefresh: Bool = false) async {
        guard !isLoading else { return }

        setLoading(true)

        do {
            let fetchedGames = try await repository.fetchGames(forceRefresh: forceRefresh)
            if fetchedGames.isEmpty {
                setError(AppError.notFound)
            } else {
                setData(fetchedGames)
            }
        } catch {
            setError(error)
        }
    }

    func refresh() async {
        await loadGames(forceRefresh: true)
    }
}
```

- `@Observable`, nunca `ObservableObject`
- `@MainActor` para actualizaciones de UI
- Guard contra carga simultánea
- Búsqueda en computed property (no en vista)

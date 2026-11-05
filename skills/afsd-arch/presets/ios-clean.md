# Preset: ios-clean
App SwiftUI con Clean Architecture por capas en carpetas. `<App>` = carpeta de código de la app (la que contiene el `@main`).

## Objetivo (se copia adaptando rutas)
- Capas en carpetas: `<App>/App` (entrada y composición), `<App>/Presentation` (vistas y ViewModels por feature),
  `<App>/Domain` (entidades, casos de uso, protocolos de repositorio), `<App>/Data` (SwiftData, red, pagos, implementaciones).
- ViewModels con `@Observable` y `@MainActor`; dependencias inyectadas por `init` (protocolos de Domain), composición en `<App>/App`.
- Persistencia con SwiftData solo en Data; Domain usa structs propios y Data los mapea.
- Concurrencia con async/await; nada de callbacks nuevos.
- Tests con Swift Testing (`@Test`) para Domain y ViewModels.
- Mínimo iOS 26.0.

## Reglas (se copian adaptando `<App>`)
- R1 Domain no depende de frameworks de interfaz ni de persistencia · check: deny <App>/Domain `^import (SwiftUI|UIKit|SwiftData|RevenueCat|StoreKit)`
- R2 SwiftData solo en Data y en la composición · check: only <App>/Data,<App>/App `^import SwiftData`
- R3 Las vistas no acceden a la persistencia · check: deny <App>/Presentation `modelContext|ModelContext|@Query`
- R4 Pagos solo en Data · check: only <App>/Data `^import (RevenueCat|StoreKit)`
- R5 Toda dependencia externa nueva tiene su decisión en `decisions.md` · manual

## Preguntas que el preset deja abiertas (haz solo las que apliquen)
1. ¿Hay pagos? Recomendación: RevenueCat si hay suscripciones; si no, quita R4.
2. ¿Sincronización entre dispositivos? Recomendación: no al principio; si sí, SwiftData + CloudKit (limita el modelo: sin unique, relaciones opcionales).
3. ¿Navegación? Recomendación: `NavigationStack` con un router `@Observable` por flujo si hay más de 3 pantallas; si no, navegación directa.
4. ¿Proyecto existente con otra estructura? Mantén sus carpetas: adapta las rutas de las reglas a ellas en lugar de mover código.

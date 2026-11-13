# Aviso de licencia de las skills de Swift

Las skills `building-core-layer`, `building-repository-swiftdata-architecture`, `caching-remote-images`, `implementing-swiftui-navigation` y `using-swift-concurrency` forman el paquete "Swift AI Coding Skills", escrito por Carlos (autor de este plugin) y publicado aquí bajo licencia MIT.

Copyright (c) 2026 Carlos

Permission is hereby granted, free of charge, to any person obtaining a copy of these skills and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

README original del paquete:

---

# Swift AI Coding Skills

Professional coding skills for **Claude Code in Xcode**. Each skill teaches Claude the correct patterns, rules, and Apple-recommended approaches for a specific domain — so every suggestion follows Swift 6.2 strict concurrency, iOS 26+ / macOS 26+ APIs, and production-grade architecture.

## Skills

### [Swift Concurrency](./using-swift-concurrency/)
Async/await, actors, TaskGroup, Sendable, continuations, and cancellation. Covers the full Swift 6 isolation model including `#isolation`, `sending`, `nonisolated(unsafe)`, actor reentrancy, and the incremental migration path from GCD.

### [SwiftUI Navigation](./implementing-swiftui-navigation/)
`NavigationStack`, `NavigationSplitView`, and `@Observable` routers. Covers deep linking with cold-launch handling, state restoration via `SceneStorage`, iOS 18 `Tab {}` API, sheet management, and zoom transitions.

### [Repository + SwiftData Architecture](./building-repository-swiftdata-architecture/)
Offline-first data layer with `@ModelActor`, cache-first strategy with TTL, `@Attribute(.unique)` upsert, pagination, and typed throws. Separates Domain Model / DTO / Entity with explicit mappers.

### [Remote Image Caching](./caching-remote-images/)
Three-tier cache: `NSCache` (decoded images) → `URLCache` (HTTP layer) → Network. Covers `byPreparingForDisplay()` for off-thread decode, `SHA256` disk keys, request coalescing, and the `CachedAsyncImage` SwiftUI component.

## Requirements

- Xcode 26+
- iOS 26+ / macOS 26+ deployment target
- Swift 6.2 language mode
- Claude Code for Xcode

## Installation

Copy the skill folders into your Claude Code skills directory:

```
~/Library/Developer/Xcode/CodingAssistant/ClaudeAgentConfig/skills/
```

## Coverage

26 files · ~20,000 lines of documented patterns, rules, and annotated code examples.

## License

MIT

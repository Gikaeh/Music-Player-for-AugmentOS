# Music Player TPA - Architecture & Design Document

## 1. Overview

This document outlines the architecture and design principles for the Third-Party Application (TPA) that provides music player control (e.g., Spotify, Native Device Player) within the AugmentOS ecosystem. The primary goal is to enable users to manage music playback via voice commands and potentially other AR interactions.

## 2. Core Components & File Structure (Conceptual)

The application is structured into several key modules/files, each with distinct responsibilities:

*   **`MusicPlayerServer.ts` (e.g., `server.ts` or `MusicPlayerServer.ts`):**
    *   **Responsibility:** The main entry point and orchestrator of the TPA. Extends the SDK's `TpaServer`.
    *   Manages the overall server lifecycle (start, stop).
    *   Handles incoming webhook requests from AugmentOS to initiate and stop sessions.
    *   Manages a collection of *active user sessions*, typically mapping a `userId` to the current `TpaSession` object and its associated `sessionId`.
    *   Fetches user-specific settings (like preferred music source, voice command enablement) when a session starts.
    *   Coordinates cleanup of session resources when a session ends (either through explicit stop or disconnection).
    *   Exposes custom Express.js routes (e.g., for OAuth callbacks, settings updates, serving static JSON).

*   **`session-handler.ts` (or `handlers/session-handler.ts`):**
    *   **Responsibility:** Manages the *interaction logic* and *state* for individual user sessions. This is where the core voice command processing and state machine reside.
    *   Contains the `setupSessionHandlers` function, which is called by `MusicPlayerServer.onSession`.
    *   `setupSessionHandlers`:
        *   Initializes and manages a `sessionStates` map (keyed by `userId`) to store the `SessionState` for each active user.
        *   Attaches event listeners to the `TpaSession` object (`onTranscription`, `onHeadPosition`, `onError`, and critically, `onDisconnected`).
        *   Implements the state machine logic (using `SessionMode` and `SessionState`).
        *   Returns a cleanup function to the `MusicPlayerServer` (specifically, the cleanup for the `onDisconnected` listener itself).
    *   Contains handler functions for different states and commands (e.g., `handlePlayerCommand`, `handleShazamInput`, `handleDeviceSelectionInput`).
    *   Contains helper functions for state management (`getSessionState`, `setSessionMode`, `clearSessionState`).

*   **`auth-controller.ts` (or `controllers/auth-controller.ts`):**
    *   **Responsibility:** Handles the OAuth 2.0 authentication flow, primarily for services like Spotify.
    *   Defines Express.js routes (e.g., `/login/:userId`, `/callback`).
    *   Initiates the authorization redirect to the service provider.
    *   Processes the callback from the service provider, exchanging the authorization code for tokens.
    *   Uses a `token-service` to securely store and retrieve user tokens.
    *   Validates `userId` (e.g., email format) in incoming requests.

*   **`services/` directory:** Contains modules for interacting with external services.
    *   **`spotify-service.ts`:** Encapsulates all logic for interacting with the Spotify Web API (authentication, playback control, fetching devices, getting current track, saving tracks). Uses the `spotify-web-api-node` library.
    *   **`shazam-service.ts`:** Encapsulates logic for identifying songs using a Shazam-like API.
    *   **`token-service.ts`:** Manages the storage and retrieval of user authentication tokens (e.g., for Spotify). This might use in-memory storage for simplicity or a more persistent store.
    *   **(Future) `apple-music-service.ts`, `native-player-service.ts`, etc.:** Implementations for other music sources, ideally adhering to a common `MusicPlayerService` interface.
    *   **`index.ts` (in `services/`):** Potentially a factory function (`getMusicService`) to return the appropriate service instance based on the user's `musicSource` setting.

*   **`types/` directory (or `types.ts`):**
    *   **Responsibility:** Defines shared TypeScript interfaces and enums used across the application.
    *   `SessionState`, `SessionMode`, `PlayerCommand`, `SettingKey`, `ProcessedUserSettings`.
    *   `PlaybackInfo`, `DeviceInfo` (for Spotify/generic player data).
    *   `MusicPlayerService` interface (if using service abstraction).

*   **`utils/` directory:**
    *   **`logger.ts`:** Configures and exports a logging instance (e.g., using Winston or Pino) for structured and leveled logging.

*   **`config/` directory:**
    *   **`environment.ts`:** Manages environment variables and application configuration (API keys, ports, URLs).

## 3. Architecture & Key Concepts

### 3.1. Session Management

*   The `MusicPlayerServer` is responsible for the lifecycle of `TpaSession` objects provided by the SDK.
*   **User-Centric Tracking:** Our application primarily tracks active interactions using `userId`. The `MusicPlayerServer` maintains an `activeUserSessions` map (`Map<userId, {session, sessionId}>`) to know which `TpaSession` and `sessionId` correspond to an active user.
*   **Session State:** The `session-handler.ts` module maintains a separate `sessionStates` map (`Map<userId, SessionState>`). This `SessionState` object holds:
    *   `mode`: The current state of the user's interaction (e.g., `IDLE`, `AWAITING_DEVICE_SELECTION`).
    *   `timeoutId`: Reference to any active `setTimeout` for the current mode.
    *   `pendingCommand`: A command to be retried after a condition is met (e.g., device selection).
    *   `data`: An object holding contextual information relevant to the current `mode` and session, such as:
        *   `musicSource`: The user's selected player type (e.g., 'spotify', 'native_android'). This is crucial for dispatching commands.
        *   `deviceInfo`: List of devices when in device selection mode.
        *   `trackInfo`: Information about a Shazam'd song awaiting save confirmation.

### 3.2. Settings Handling

*   User-specific settings (e.g., `music_source`, `voice_commands`, `heads_up_display`) are fetched by `MusicPlayerServer.fetchUserSettings(userId)` when a session starts.
*   These settings are processed into a `ProcessedUserSettings` object.
*   The *full* `ProcessedUserSettings` object is passed to `setupSessionHandlers`.
*   `setupSessionHandlers` uses settings like `isVoiceCommands` to determine which SDK event listeners to attach.
*   Crucially, **operationally relevant settings** (like `musicSource`) are then stored within the `SessionState.data` object for that `userId`. This makes the current player choice readily available to runtime command handlers without needing to re-fetch or pass around the entire settings object.

### 3.3. State Machine

*   Located in `session-handler.ts`.
*   Uses `SessionMode` (enum) and the `SessionState` object.
*   Transitions are triggered by:
    *   Finalized transcriptions from `onTranscription`.
    *   `setTimeout` callbacks for mode-specific timeouts.
*   Actions involve:
    *   Calling appropriate service methods (e.g., `spotifyService.playTrack`).
    *   Showing text to the user via `session.layouts.showTextWall`.
    *   Modifying the `SessionState` (changing mode, setting/clearing `timeoutId`, `pendingCommand`, `data`).
    *   Providing feedback to the user.

### 3.4. Command Dispatch (Player Type Abstraction)

*   The `handlePlayerCommand` function (in `session-handler.ts`) is the central point for executing playback commands.
*   It retrieves the `musicSource` from the current `SessionState.data`.
*   Based on the `musicSource`, it will ideally dispatch the command to an appropriate service implementation (e.g., `spotifyService` or a future `nativePlayerService`).
*   **Service Abstraction (Recommended for >2 players):** Define a `MusicPlayerService` interface with common methods (`play`, `pause`, `getCurrentlyPlaying`). Each player type (Spotify, Apple Music, Android Native) would have a class implementing this interface. A factory function (`getMusicService(source)`) would return the correct service instance. This keeps `handlePlayerCommand` cleaner.

### 3.5. Session Cleanup (Critical for Preventing Leaks)

*   **Responsibility of `session-handler.ts` (via `setupSessionHandlers`):**
    *   When `setupSessionHandlers` is called, it attaches an `onDisconnected` listener to the provided `TpaSession`.
    *   This `onDisconnected` callback is responsible for:
        1.  Executing all cleanup functions for *other SDK listeners* it attached (e.g., `onTranscription`'s cleanup).
        2.  Clearing the session's entry from the `sessionStates` map (using `clearSessionState(userId)`).
        3.  Calling a `notifyServerMapCleanup` callback (passed from `MusicPlayerServer`) to inform the server that its local cleanup is done.
    *   `setupSessionHandlers` returns the cleanup function *for the `onDisconnected` listener itself*.
*   **Responsibility of `server.ts`:**
    *   In `onSession`:
        *   If a previous session entry exists for the `userId` in `activeUserSessions`, it's simply removed (the old session's `onDisconnected` handler is expected to manage its own full cleanup).
        *   It passes a `notifyServerMapCleanup` callback (bound to the current `userId` and `sessionId`) to `setupSessionHandlers`. This callback, when invoked, will remove the entry from `activeUserSessions`.
        *   It calls `this.addCleanupHandler()` with the cleanup function returned by `setupSessionHandlers` (which is the cleanup for the `onDisconnected` listener). This ensures the SDK properly detaches the `onDisconnected` listener if the session is stopped cleanly by the server (e.g., via `onStop` or during server shutdown).
    *   In `onStop`: Acts as a fallback. If the session being stopped is still tracked in `activeUserSessions`, it's removed. Primary cleanup is expected via `onDisconnected`.
    *   In the constructor (via `addCleanupHandler`): Ensures any remaining entries in `activeUserSessions` are cleared on server shutdown.

### 3.6. Authentication

*   The `/login/:userId` route (in `auth-controller.ts`) initiates the OAuth flow, passing the `userId` (expected to be an email) in the `state` parameter.
*   The `/callback` route handles the response, validates the `state` (checking if it's an email), exchanges the code for tokens, and stores them using `tokenService`.
*   `spotifyService.refreshTokenIfNeeded(userId)` is called before most Spotify API interactions.

## 4. Key Data Flows

1.  **Session Start:**
    *   AugmentOS Cloud -> TPA Server Webhook (`/webhook`) -> `handleSessionRequest` (SDK internal)
    *   `handleSessionRequest` -> `MusicPlayerServer.onSession(session, sessionId, userId)`
    *   `onSession` -> `fetchUserSettings(userId)`
    *   `onSession` -> `setupSessionHandlers(session, userId, userSettings, notifyServerMapCleanupCallback)`
    *   `setupSessionHandlers` -> Attaches SDK listeners (e.g., `onTranscription`), attaches its own `onDisconnected` comprehensive cleanup handler.
2.  **Voice Command:**
    *   User Speaks -> AugmentOS ASR -> `onTranscription` (in `session-handler.ts`)
    *   `onTranscription` -> `getSessionState(userId)`
    *   `onTranscription` -> (Based on state and transcript) -> `handlePlayerCommand`, `triggerShazam`, etc.
    *   `handlePlayerCommand` -> `getSessionState(userId)` (for `musicSource`) -> (Potentially) `getMusicService(musicSource)` -> Calls specific service method (e.g., `spotifyService.playTrack(userId)`).
3.  **Disconnection:**
    *   Client Disconnects -> `onDisconnected` (SDK listener attached in `setupSessionHandlers`)
    *   `onDisconnected` callback -> Executes SDK listener cleanups, clears `sessionStates` entry, calls `notifyServerMapCleanup` (server callback).
    *   `notifyServerMapCleanup` (executed in `MusicPlayerServer` context) -> Removes entry from `activeUserSessions`.
4.  **OAuth Callback:**
    *   User Authorizes on Spotify -> Spotify Redirects -> `/callback` (in `auth-controller.ts`)
    *   `/callback` -> Validates `state` (userId) -> `spotifyService.handleAuthorizationCallback(code, userId)`
    *   `handleAuthorizationCallback` -> `tokenService.setToken(userId, ...)`.
    *   `/callback` (Optional) -> `server.getActiveUserSession(userId)` -> Notify session.

## 5. Considerations for Future Development

*   **Adding More Music Services:** Follow the `MusicPlayerService` interface pattern. Each new service will require its own implementation and potentially its own authentication flow. The `musicSource` setting and the `getMusicService` factory will be key.
*   **Complex Multi-Step Interactions:** For more involved conversations (e.g., "add song X to playlist Y, then shuffle"), extend the `SessionMode` enum and add corresponding states and handlers.
*   **Error Handling Granularity:** Improve error handling to distinguish between different API errors from services and provide more specific feedback to the user.
*   **Native Player Control:** Implementing robust control for generic Android/iOS native players from a TPA can be challenging due to OS limitations and lack of standardized APIs accessible from the server context. This might require custom events or SDK features beyond simple media commands.
*   **Persistence:** For `tokenService` and potentially user settings (if not always fetched from cloud), consider using a persistent store (e.g., a database) instead of in-memory, especially if the TPA server restarts frequently.
*   **Settings Update Propagation:** If settings can be updated externally while a session is active, decide if/how these changes should propagate to the active `SessionState` and potentially alter behavior mid-session. This might involve a push mechanism or specific re-initialization logic.

This document provides a high-level understanding. The actual implementation will involve detailed coding of each function and careful management of asynchronous operations and error states.
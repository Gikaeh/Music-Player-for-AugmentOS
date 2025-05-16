import {TpaServer, TpaSession} from '@augmentos/sdk';
import {createExpressApp} from './app';
import {config} from './config/environment';
import {tokenService} from './services/token-service';
import {setupSessionHandlers, displayCurrentlyPlaying} from './handlers/session-handler';
import logger from './utils/logger';
import {SettingKey, UserSettings, ActiveSessionInfo} from './types/index'
import path from 'path';
import fs from 'fs'

const tpaConfig = JSON.parse(fs.readFileSync(path.join(__dirname, './public/tpa_config.json'), 'utf8'));

const defaultSettings: UserSettings = {
  musicPlayer: tpaConfig.settings.find((s: any) => s.key === SettingKey.MUSIC_PLAYER)?.defaultValue || 'spotify',
  isVoiceCommands: tpaConfig.settings.find((s: any) => s.key === SettingKey.VOICE_COMMANDS)?.defaultValue || true,
  isHeadsUpDisplay: tpaConfig.settings.find((s: any) => s.key === SettingKey.HEADS_UP_DISPLAY)?.defaultValue || false,
};

export class MusicPlayerServer extends TpaServer {
  private activeUserSessions = new Map<string, ActiveSessionInfo>();

  constructor() {
    super({
      packageName: config.augmentOS.packageName,
      apiKey: config.augmentOS.apiKey,
      port: config.server.port,
      publicDir: path.join(__dirname, './public')
    });

    // Get the Express app for adding custom routes
    const app = this.getExpressApp();

    // Merge with our app that has auth routes set up
    const customApp = createExpressApp();
    app.use(customApp);

    // Start auth server on separate port if provided
    if (config.server.authPort) {
      app.listen(config.server.authPort, () => {
        logger.info(`Authentication server running on port ${config.server.authPort}`, {
          authPort: config.server.authPort
        });
      });
    }

    this.addCleanupHandler(() => {
      logger.info("Running shutdown cleanup for activeUserSessions map.");
      this.activeUserSessions.forEach(sessionInfo => {
        if (sessionInfo.sessionHandlerCleanup) {
          try {
            sessionInfo.sessionHandlerCleanup();
          } catch (error) {
            logger.error(`Error during server shutdown cleanup for session ${sessionInfo.sessionId}`, {
              error: {
                message: error.message,
                stack: error.stack,
                responseStatus: error.response?.status,
                responseBody: error.response?.data 
              }
            });
          }
        }
      });
      this.activeUserSessions.clear();
    });
  }

  // Called when new user connects to app
  protected async onSession(session: TpaSession, sessionId: string, userId: string): Promise<void> {
    logger.info(`New session started: ${sessionId} for user: ${userId}`);

    if (this.activeUserSessions.has(userId)) {
      const oldSessionInfo = this.getActiveUserSession(userId);
      logger.warn(`[User ${userId}] New session ${sessionId} starting, replacing previous session ${oldSessionInfo?.sessionId} in tracking map.`);
      if (oldSessionInfo?.sessionHandlerCleanup) {
        logger.debug(`[User ${userId}] Cleaning up handlers from old session ${oldSessionInfo.sessionId}.`);
        try {
            oldSessionInfo.sessionHandlerCleanup();
        } catch (error) {
            logger.error(`Error cleaning up old session handlers for user ${userId}`, {
              session: session,
              sessionId: sessionId,
              userId: userId,
              error: {
                message: error.message,
                stack: error.stack,
                responseStatus: error.response?.status,
                responseBody: error.response?.data 
              }
            });
        }
      }
      this.removeActiveUserSession(userId); // remove old session info
    }
    
    // Store session to access it later
    const currentActiveSessionInfo: ActiveSessionInfo = {session, sessionId, sessionHandlerCleanup: null};
    this.setActiveUserSession(userId, currentActiveSessionInfo);

    this.setupUserSettings(session, sessionId, userId);

    // Set up event handlers for this session and get the cleanup handlers
    this.reapplySessionSettingsAndHandlers(userId)

    // Check if user is already authenticated with Spotify
    if (tokenService.hasToken(userId)) {
      // User is authenticated, start showing now playing info
      await displayCurrentlyPlaying(session, userId);
    } else {
      // User needs to authenticate
      const loginUrl = `${config.server.webUrl}/login/${userId}`;
      logger.info(loginUrl);
      session.layouts.showTextWall(
        `Please visit the following URL on your phone or computer to connect your Spotify account: ${loginUrl}`,
        {durationMs: 5000}
      );
    }
  }

  protected async onStop(sessionId: string, userId: string, reason: string): Promise<void> {  
    // Call the parent class's onStop method to ensure proper cleanup
    await super.onStop(sessionId, userId, reason);

    this.handleSessionCleanupComplete(userId, sessionId);
  }

  private handleSessionCleanupComplete(userId: string, sessionId: string): void {
    logger.info(`[User ${userId}] Received cleanup complete notification for session ${sessionId}.`);
    // Verify if the session being cleaned up is still the one we are tracking
    const trackedInfo = this.activeUserSessions.get(userId);
    if (trackedInfo?.sessionHandlerCleanup != null) {
      trackedInfo.sessionHandlerCleanup();
    }
    if (trackedInfo && trackedInfo.sessionId === sessionId) {
      logger.info(`[User ${userId}] Removing session ${sessionId} from active tracking map.`);
      this.removeActiveUserSession(userId);
    } else {
      logger.warn(`[User ${userId}] Cleanup complete notification for session ${sessionId}, but different session ${trackedInfo?.sessionId ?? 'none'} is tracked or user already removed.`);
    }
  }

  public getActiveUserSession(userId: string): ActiveSessionInfo | null {
    return this.activeUserSessions.get(userId) || null;
  }

  public setActiveUserSession(userId: string, data: ActiveSessionInfo): void {
    this.activeUserSessions.set(userId, data);
  }

  public removeActiveUserSession(userId: string): void {
    this.activeUserSessions.delete(userId);
  }

  private setupUserSettings(session: TpaSession, sessionId: string, userId: string): void {
    session.settings.onValueChange(SettingKey.MUSIC_PLAYER, (newValue, oldValue) => {
      logger.info(`Music player changed for user ${userId}: ${oldValue} -> ${newValue}`);
      this.reapplySessionSettingsAndHandlers(userId);
    });
    session.settings.onValueChange(SettingKey.VOICE_COMMANDS, (newValue, oldValue) => {
      logger.info(`Voice command changed for user ${userId}: ${oldValue} -> ${newValue}`);
      this.reapplySessionSettingsAndHandlers(userId);
    });
    session.settings.onValueChange(SettingKey.HEADS_UP_DISPLAY, (newValue, oldValue) => {
      logger.info(`Heads up command changed for user ${userId}: ${oldValue} -> ${newValue}`);
      this.reapplySessionSettingsAndHandlers(userId);
    });
  }

  public async sendUserSettings(session: TpaSession, sessionId: string, userId: string): Promise<any> {
    try {
      const settingsArray: any[] = session.settings.getAll();
      logger.debug(settingsArray);
      const processedSettings: UserSettings = defaultSettings;

      settingsArray.forEach(setting => {
        switch (setting.key) {
          case SettingKey.MUSIC_PLAYER:
            if (setting.value === 'android') {processedSettings.musicPlayer = 'android';}
            else if (setting.value === 'ios') {processedSettings.musicPlayer = 'ios';}
            else if (setting.value === 'spotify') {processedSettings.musicPlayer = 'spotify';}
            else {
              logger.warn(`[User ${userId}] Unknown music player value: ${setting.value}. Defaulting to spotify.`);
              processedSettings.musicPlayer = 'spotify';
            }
            break;

          case SettingKey.HEADS_UP_DISPLAY:
            processedSettings.isHeadsUpDisplay = !!setting.value;
            break;

          case SettingKey.VOICE_COMMANDS:
            processedSettings.isVoiceCommands = !!setting.value;
            break;

          default:
            logger.warn(`[User ${userId}] Encountered unknown setting key: ${setting.key}`);
            break;
        }
      });

      logger.info(`Applied settings for user ${userId}: headsUpDisplay=${processedSettings.isHeadsUpDisplay}, voiceCommands=${processedSettings.isVoiceCommands}`);
      return processedSettings;
    } catch (error){
      logger.error(`Error fetching settings for user ${userId}.`, {
        userId: userId,
        error: {
          message: error.message,
          stack: error.stack,
          responseStatus: error.response?.status,
          responseBody: error.response?.data 
        }
      });
      return defaultSettings;
    }
  }

  private async reapplySessionSettingsAndHandlers(userId: string): Promise<void> {
    const sessionInfo = this.getActiveUserSession(userId);
    if (!sessionInfo) {
      logger.warn(`[User ${userId}] Cannot re-apply settings and handlers: session not found.`);
      return;
    }

    const {session, sessionId} = sessionInfo;

    if (sessionInfo.sessionHandlerCleanup) {
      logger.debug(`[User ${userId}] Cleaning up existing session handlers before re-applying.`);
      try {
        sessionInfo.sessionHandlerCleanup();
      } catch (error) {
        logger.error(`Error cleaning up existing session handlers for user ${userId}`, {
          userId: userId,
          error: {
            message: error.message,
            stack: error.stack,
            responseStatus: error.response?.status,
            responseBody: error.response?.data 
          }
        });
      }
    }

    const userSettings = await this.sendUserSettings(session, sessionId,userId);
    const newCleanupHandler = setupSessionHandlers(session, sessionId, userId, userSettings);
    
    this.activeUserSessions.get(userId)!.sessionHandlerCleanup = newCleanupHandler;

    logger.info(`[User ${userId}] Session handlers re-applied with new settings.`);
  }
}

export const server = new MusicPlayerServer();

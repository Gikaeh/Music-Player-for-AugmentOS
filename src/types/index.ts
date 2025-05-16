import {SessionMode, PlayerCommand} from "../handlers/session-handler";
import {TpaSession} from "@augmentos/sdk";

export interface SpotifyCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export enum SettingKey {
  MUSIC_PLAYER = 'music_player',
  VOICE_COMMANDS = 'voice_commands',
  HEADS_UP_DISPLAY = 'heads_up_display'
}

export interface UserSettings {
  musicPlayer: 'spotify' | 'android' | 'ios',
  isVoiceCommands: boolean,
  isHeadsUpDisplay: boolean
}

export interface SessionState {
  mode: SessionMode;
  timeoutId: NodeJS.Timeout | null;
  data?: {
    musicPlayer: 'spotify' | 'android' | 'ios',
    deviceInfo: DeviceInfo[],
    shazamInfo: PlaybackInfo
  };
  pendingCommand?: PlayerCommand;
}

export interface PlaybackInfo {
  trackName?: string | null;
  artists?: string | null;
  albumName?: string | null;
  isPlaying?: boolean;
  trackId?: string | null; 
}

export interface DeviceInfo {
  name: string;
  type: string;
  id: string;
}

export interface MusicPlayerService {
  // Core Commands (should be supported by most)
  playTrack(userId: string): Promise<void>;
  pauseTrack(userId: string): Promise<void>;
  nextTrack(userId: string): Promise<void>;
  previousTrack(userId: string): Promise<void>;

  // State Retrieval (might not be supported by all)
  getCurrentlyPlaying?(userId: string): Promise<PlaybackInfo | null>;
  // Check if authenticated/ready for this service
  isReady?(userId: string): Promise<boolean>;

  // Extended Capabilities (optional methods)
  getDevices?(userId: string): Promise<DeviceInfo[]>;
  setDevice?(userId: string, deviceId: string[]): Promise<void>;
  saveTrackToLibrary?(userId: string, trackInfo: PlaybackInfo): Promise<void>;
}

export interface ActiveSessionInfo {
  session: TpaSession;
  sessionId: string;
  sessionHandlerCleanup: (() => void) | null;
}
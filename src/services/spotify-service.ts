import SpotifyWebApi from 'spotify-web-api-node';
import {tokenService} from './token-service';
import {config} from '../config/environment';
import logger from '../utils/logger'
import {PlaybackInfo, MusicPlayerService} from '../types/index'

export class SpotifyService implements MusicPlayerService{
  private spotifyApi: SpotifyWebApi;

  constructor() {
    // Initialize Spotify Api with app credentials
    this.spotifyApi = new SpotifyWebApi({
      clientId: config.spotify.clientId,
      clientSecret: config.spotify.clientSecret,
      redirectUri: config.spotify.redirectUri
    });
  }

  public createAuthorizationUrl(userId: string): string {
    // Generate auth URL with necessary scopes (Spotify web-api scopes)
    return this.spotifyApi.createAuthorizeURL([
      'user-read-currently-playing',
      'user-read-playback-state',
      'user-modify-playback-state'
    ], userId);
  }

  public async handleAuthorizationCallback(code: string, userId: string): Promise<void> {
    // Exchange authorization code for access token
    const data = await this.spotifyApi.authorizationCodeGrant(code);

    // Store user tokens for this session
    tokenService.setToken(userId, {
      accessToken: data.body.access_token,
      refreshToken: data.body.refresh_token,
      expiresIn: Date.now() + data.body.expires_in * 1000,
      scope: data.body.scope,
      tokenType: data.body.token_type
    });
  }

  public async refreshTokenIfNeeded(userId: string): Promise<boolean> {
    const credentials = tokenService.getToken(userId);
    if (!credentials) return false;

    // Check if token needs refreshing
    if (Date.now() > credentials.expiresIn - 60000) {
      try {
        // Set the refresh token and refresh access token
        this.spotifyApi.setRefreshToken(credentials.refreshToken);
        const data = await this.spotifyApi.refreshAccessToken();

        // Update stored credentials
        tokenService.setToken(userId, {
          accessToken: data.body.access_token,
          refreshToken: credentials.refreshToken,
          expiresIn: Date.now() + data.body.expires_in * 1000,
          scope: data.body.scope,
          tokenType: data.body.token_type
        });

        // Set the new access token
        this.spotifyApi.setAccessToken(data.body.access_token);
        return true;
      } catch (error) {
        logger.error('Token refresh error', {
          userId: userId,
          credentials: credentials,
          error: {
            message: error.message,
            stack: error.stack,
            responseStatus: error.response?.status,
            responseBody: error.response?.data 
          }
        });
        return false;
      }
    } else {
      // Set the access token for this request
      this.spotifyApi.setAccessToken(credentials.accessToken);
      return true;
    }
  }

  public async getCurrentlyPlaying(userId: string): Promise<PlaybackInfo | null> {
    const credentials = tokenService.getToken(userId)

    if (!credentials) {
      logger.warn(`No token found for user ${userId}`, {
        userId: userId
      });
      return {isPlaying: false};
    }

    this.spotifyApi.setAccessToken(credentials.accessToken);

    // Get the user's currently playing track
    const data = await this.spotifyApi.getMyCurrentPlaybackState();
    
    if (data.body && data.body.item) {
      const track = data.body.item;
      const artists = track.artists.map(artist => artist.name).join(', ');
      
      return {
        isPlaying: data.body.is_playing,
        trackName: track.name,
        artists,
        albumName: track.album.name
      };
    }
    
    return null;
  }

  public async playTrack(userId: string): Promise<void> {
    const credentials = tokenService.getToken(userId)

    if (!credentials) {
      logger.warn(`No token found for user ${userId}`, {
        userId: userId
      });
      return;
    }

    this.spotifyApi.setAccessToken(credentials.accessToken);
    await this.spotifyApi.play();
  }

  public async pauseTrack(userId: string): Promise<void> {
    const credentials = tokenService.getToken(userId)

    if (!credentials) {
      logger.warn(`No token found for user ${userId}`, {
        userId: userId
      });
      return;
    }

    this.spotifyApi.setAccessToken(credentials.accessToken);
    await this.spotifyApi.pause();
  }

  public async nextTrack(userId: string): Promise<void> {
    const credentials = tokenService.getToken(userId)

    if (!credentials) {
      logger.warn(`No token found for user ${userId}`, {
        userId: userId
      });
      return;
    }

    this.spotifyApi.setAccessToken(credentials.accessToken);
    await this.spotifyApi.skipToNext();
  }

  public async previousTrack(userId: string): Promise<void> {
    const credentials = tokenService.getToken(userId)

    if (!credentials) {
      logger.warn(`No token found for user ${userId}`, {
        userId: userId
      });
      return;
    }

    this.spotifyApi.setAccessToken(credentials.accessToken);
    await this.spotifyApi.skipToPrevious();
  }

  public async getDevice(userId: string): Promise<SpotifyApi.UserDevice[]> {
    const credentials = tokenService.getToken(userId);

    if (!credentials) {
      logger.warn(`No token found for user ${userId}`, {
        userId: userId
      });
    }

    this.spotifyApi.setAccessToken(credentials.accessToken);
    const devices = (await this.spotifyApi.getMyDevices()).body.devices;

    return devices;
  }

  public async setDevice(userId: string, deviceId: string[]): Promise<void> {
    const credentials = tokenService.getToken(userId);

    if (!credentials) {
      logger.warn(`No token found for user ${userId}`, {
        userId: userId
      });
    }

    this.spotifyApi.setAccessToken(credentials.accessToken);
    await this.spotifyApi.transferMyPlayback(deviceId);
  }
}

export const spotifyService = new SpotifyService();
import {TpaSession} from '@augmentos/sdk';
import {setTimeout as sleep} from 'timers/promises';
import logger from '../utils/logger'
import {DeviceInfo, SessionState} from '../types'
import {tokenService} from '../services/token-service';
import {spotifyService} from '../services/spotify-service';
import {shazamService} from '../services/shazam-service';
import {config} from '../config/environment'

// Player command actions
export enum PlayerCommand {
  CURRENT = 'current',
  NEXT = 'next',
  BACK = 'back',
  PLAY = 'play',
  PAUSE = 'pause',
  TRIGGER_SHAZAM = 'trigger_shazam',
  TRIGGER_DEVICE_LIST = 'trigger_device_list'
}

// Different modes for sessions
export enum SessionMode {
  IDLE,
  LISTENING_FOR_SHAZAM,
  AWAITING_DEVICE_SELECTION
}

// Map for holding states of the session
const sessionStates = new Map<string, SessionState>();
// Maps for voice commands
const playerCommandMappings = {
  [PlayerCommand.CURRENT]: ['current.', 'what\'s playing', 'now playing', 'current song'],
  [PlayerCommand.NEXT]: ['next.', 'next song', 'skip song'],
  [PlayerCommand.BACK]: ['back.', 'previous.', 'previous song'],
  [PlayerCommand.PLAY]: ['play.', 'play music', 'play song'],
  [PlayerCommand.PAUSE]: ['pause.', 'pause music', 'pause song']
};
const triggerPhases = {
  [PlayerCommand.TRIGGER_SHAZAM]: ['shazam', 'find song', 'what song is this', 'identify song'],
  [PlayerCommand.TRIGGER_DEVICE_LIST]: ['show devices', 'list devices', 'change device', 'select device']
}

// Set up session event handlers
export function setupSessionHandlers(session: TpaSession, sessionId: string, userId: string, userSettings: any): () => void {
  // Array for handler cleanup
  const cleanupHandlers: Array<() => void> = [];
  const settings = userSettings

  // Initialize base sessionState to idle
  sessionStates.set(userId, {mode: SessionMode.IDLE, timeoutId: null, pendingCommand: undefined});
  logger.info(`[User ${userId}] Initialized session state to IDLE.`);

  // Check if voice commands are enabled from settings
  if (settings.isVoiceCommands) {
    // Listen for user command via transcription
    const transcriptionHandler = session.events.onTranscription(async (data) => {
      logger.debug(`[User ${userId}] Received transcription data.`, {
        isFinal: data.isFinal, 
        textLength: data.text?.length, 
        userId: userId 
      });
      if (!data.isFinal) return;
      const lowerText = data.text.toLowerCase().trim()
      if (lowerText === '') return;
      const currentState = getSessionState(userId);
      logger.debug(`[User ${userId}] Processing final transcript in mode: ${SessionMode[currentState.mode]}`, { transcript: lowerText, state: currentState, userId: userId });

      // Switch case for mode of current state
      switch (currentState.mode) {
        case SessionMode.IDLE:
          // Loops through trigger phases to change states
          for (const [trigger, phases] of Object.entries(triggerPhases)) {
            for (const phrase of phases) {
              if (lowerText.includes(phrase)) {

                // Switch statement for trigger commands
                switch (trigger as PlayerCommand) {
                  case PlayerCommand.TRIGGER_SHAZAM:
                    await triggerShazam(session, userId);
                    break;

                  case PlayerCommand.TRIGGER_DEVICE_LIST:
                    await triggerDeviceList(session, userId);
                    break;
                }
                return;
              }
            }
          }
        
          // Loops through each phrase in 
          for (const [command, phrases] of Object.entries(playerCommandMappings)) {
            for (const phrase of phrases) {
              if (lowerText.includes(phrase)) {
                await handlePlayerCommand(session, userId, command as PlayerCommand);
                return;
              }
            }
          }

          break;

        case SessionMode.LISTENING_FOR_SHAZAM:
          await handleShazamInput(session, userId, data.text);
          break;

        case SessionMode.AWAITING_DEVICE_SELECTION:
          if (currentState.data?.deviceInfo && Array.isArray(currentState.data.deviceInfo)) {
            await handleDeviceSelectionInput(session, userId, lowerText, currentState.data.deviceInfo);
          } else {
            logger.warn(`[User ${userId}] Missing device data in AWAITING_DEVICE_SELECTION mode.`, {
              userId: userId,
              settings: settings,
              mode: currentState.mode,
              timeoutId: currentState.timeoutId,
              currentStateData: currentState.data?.deviceInfo
            });
            session.layouts.showTextWall('Internal error: Device list missing.', {durationMs: 5000});
            setSessionState(session, userId, SessionMode.IDLE);
          }

          break;

        default:
          logger.warn(`[User ${userId}] Unhandled session mode: ${currentState.mode}`, {
            userId: userId,
            modeValue: currentState.mode
          });
          setSessionState(session, userId, SessionMode.IDLE);
      }
    });

    cleanupHandlers.push(transcriptionHandler);
  }

  // Check if heads up display is enabled from settings
  if (settings.isHeadsUpDisplay) {
    // Head position events
    const headPositionHandler = session.events.onHeadPosition(async (data) => {
      if (data.position === 'up') {
        const currentState = getSessionState(userId);

        if (currentState.mode === SessionMode.IDLE) {
          await handlePlayerCommand(session, userId, PlayerCommand.CURRENT);
        }
      }
    });

    cleanupHandlers.push(headPositionHandler);
  }

  // Error handler
  const errorHandler = session.events.onError((error) => {
    logger.error(`Error`, {
      userId: userId,
      settings: settings,
      error: {
        message: error.message,
        stack: error.stack,
        responseStatus: error.response?.status,
        responseBody: error.response?.data 
      }
    });
    session.layouts.showTextWall(`Error: ${error.message}`);
  });

  // Add handlers to the cleanup array
  cleanupHandlers.push(errorHandler);

  const stateCleanup = () => {
    logger.info(`[User ${userId}] Running specific state map cleanup.`);
    clearSessionState(userId);
  };

  const disconnectHandler = session.events.onDisconnected((data) => {
    logger.warn(`[Session ${sessionId}] onDisconnected event triggered for User ${userId}. Running cleanup.`);

    logger.debug(`[User ${userId}] Running ${cleanupHandlers.length} cleanup functions.`);
    const cleanupsName = ['transcript', 'headPosition', 'error']
    cleanupHandlers.forEach((cleanup, index) => {
      try {
        cleanup();
      } catch (error){
        logger.error(`[User ${userId}] Error running listener cleanup #${index}.`, {
          userId: userId,
          cleanup: cleanupsName[index],
          error: {
            message: error.message,
            stack: error.stack,
            responseStatus: error.response?.status,
            responseBody: error.response?.data 
          }
        });
      }
    });

    try {
      stateCleanup();
    } catch (error){
      logger.error(`[User ${userId}] Error running state cleanup.`, {
        userId: userId,
        error: {
          message: error.message,
          stack: error.stack,
          responseStatus: error.response?.status,
          responseBody: error.response?.data 
        }
      });
    }
  });
  
  // Return all cleanup handlers
  return disconnectHandler;
}

// Handle player commands
async function handlePlayerCommand(session: TpaSession, userId: string, command: PlayerCommand): Promise<void> {
  logger.info(`[User ${userId}] Handling command ${command}`);

  // Check if user is authenticated
  if (!tokenService.hasToken(userId)) {
    logger.info(`Please connect your Spotify account first at ${config.server.webUrl}/login/${userId}`);
    session.layouts.showTextWall(`Please connect your Spotify account first. ${config.server.webUrl}/login/${userId}`, {durationMs: 5000});
    return;
  }

  // Refresh token if needed
  const tokenValid = await spotifyService.refreshTokenIfNeeded(userId);
  if (!tokenValid) {
    session.layouts.showTextWall('Error refreshing Spotify connection. Please reconnect your account.', {durationMs: 5000});
    return;
  }

  try {
    switch (command) {
      case PlayerCommand.CURRENT:
        await displayCurrentlyPlaying(session, userId);
        break;

      case PlayerCommand.NEXT:
        await spotifyService.nextTrack(userId);
        await displayCurrentlyPlaying(session, userId);
        break;
      
      case PlayerCommand.BACK:
        await spotifyService.previousTrack(userId);
        await displayCurrentlyPlaying(session, userId);
        break;
      
      case PlayerCommand.PLAY:
        await spotifyService.playTrack(userId);
        await displayCurrentlyPlaying(session, userId);
        break;

      case PlayerCommand.PAUSE:
        await spotifyService.pauseTrack(userId);
        await displayCurrentlyPlaying(session, userId);
        break;

      default:
        logger.warn(`Unhandled player command: ${command}`, {
          userId: userId,
          command: command
        });
        break;
    }
  } catch (error){
    logger.error(`Spotify API error during command ${command}`, {
      userId: userId,
      command: command,
      error: {
        message: error.message,
        stack: error.stack,
        responseStatus: error.response?.status,
        responseBody: error.response?.data 
      }
    });
    
    if (error.message?.includes('NO_ACTIVE_DEVICE')) { 
      logger.warn(`[User ${userId}] No active device detected for command '${command}'. Auto-triggereing device list.`);
      await triggerDeviceList(session, userId, command);
    } else  {
      let userMessage = 'Error executing command. Please try again.';
      
      if (error.response?.data?.error?.message) { 
      userMessage = `Spotify Error: ${error.response.data.error.message}`;
      }

      session.layouts.showTextWall(userMessage, {durationMs: 5000});
    }
  }
}

// Display the currently playing track
export async function displayCurrentlyPlaying(session: TpaSession, userId: string): Promise<void> {
  try {
    const tokenValid = await spotifyService.refreshTokenIfNeeded(userId);
    if (!tokenValid) {
      session.layouts.showTextWall('Error with spotify authentication. Please reconnect your account.');
      return;
    }

    // Sleep to give time for spotify to update currently playing
    await sleep(500)
    const playbackInfo = await spotifyService.getCurrentlyPlaying(userId);
    logger.debug(`[User ${userId}] Fetched playback info from Spotify.`, {
      playbackInfo: playbackInfo,
      userId: userId
    });
    
    // Ceck for the required info
    if (playbackInfo && playbackInfo.trackName) {
      const displayText = 
        `${playbackInfo.isPlaying ? 'Now Playing' : 'Paused'}\n\n` +
        `Song: ${playbackInfo.trackName}\n` +
        `Artist: ${playbackInfo.artists}\n` +
        (playbackInfo.albumName ? `Album: ${playbackInfo.albumName}` : '');
      
      // Display the now playing information
      session.layouts.showTextWall(displayText, {durationMs: 5000});
    } else {
      // Nothing is playing
      logger.info('No track currently playing on Spotify');
      session.layouts.showTextWall('No track currently playing on Spotify', {durationMs: 5000});
    }
  } catch (error) {
    logger.error(`Error displaying current track`, {
      userId: userId,
      error: {
        message: error.message,
        stack: error.stack,
        responseStatus: error.response?.status,
        responseBody: error.response?.data 
      }
    });
    session.layouts.showTextWall('Error getting track information', {durationMs: 5000});
  }
}

function getSessionState(userId: string): SessionState {
  // Check for sessionState
  if (!sessionStates.has(userId)) {
    logger.warn(`[User ${userId}] State not found, initializing to IDLE.`);
    sessionStates.set(userId, {mode: SessionMode.IDLE, timeoutId: null, pendingCommand: undefined});
  }

  // Return sessionState for userId
  return sessionStates.get(userId)!;
}

function setSessionState(session: TpaSession, userId: string, newMode: SessionMode, options?: {data?: any; timeoutMs?: number; timeoutMessage?: string, pendingCommand?: PlayerCommand}): void {
  const currentState = getSessionState(userId);

  if (currentState.timeoutId) {
    // Clear timeout to set new one
    clearTimeout(currentState.timeoutId);
  }

  let newTimeoutId: NodeJS.Timeout | null = null;
  if (options?.timeoutMs) {
    newTimeoutId = setTimeout(() => {
      logger.info(`[User ${userId}] Timeout reached for mode ${SessionMode[newMode]}. Resetting to IDLE.`, {
        userId: userId,
        newMode: SessionMode[newMode]
      })
      const timedOutState = sessionStates.get(userId);
      if (timedOutState && timedOutState.mode === newMode) {
        sessionStates.set(userId, {...timedOutState, mode: SessionMode.IDLE, timeoutId: null, data: undefined, pendingCommand: undefined});
        session.layouts.showTextWall(options.timeoutMessage || 'Action timed out.', {durationMs: 5000});
      }
    }, options.timeoutMs);
  }

  let nextData: any = undefined;
  if (newMode !== SessionMode.IDLE) {
    nextData = {
      // Always try to preserve musicPlayer unless explicitly overridden
      musicPlayer: options?.data?.musicPlayer ?? currentState.data?.musicPlayer,
      // Add mode-specific data if provided in options
      ...(options?.data?.deviceInfo && newMode === SessionMode.AWAITING_DEVICE_SELECTION && { deviceInfo: options.data.deviceInfo }),
    };

    // Remove undefined properties if any were added conditionally
    Object.keys(nextData).forEach(key => nextData[key] === undefined && delete nextData[key]);
    if (Object.keys(nextData).length === 0) {
      nextData = undefined;
    }
  } else {
    // If returning to IDLE, only preserve musicPlayer from current state
    if (currentState.data?.musicPlayer) {
        nextData = {musicPlayer: currentState.data.musicPlayer};
    } else {
        nextData = undefined;
    }
  }

  const newState: SessionState = {
    mode: newMode,
    timeoutId: newTimeoutId,
    pendingCommand: options?.pendingCommand, // Only set pending command if explicitly passed in options, otherwise clear it (especially for IDLE)
    data: nextData 
  };

  // Handle timeout reset case separately
  if (options?.timeoutMs && newTimeoutId) {
    newTimeoutId = setTimeout(() => {
      const timedOutState = sessionStates.get(userId);
      if (timedOutState && timedOutState.mode === newMode) {
        // Reset state to IDLE, preserving only musicPlayer from the timed-out state
        sessionStates.set(userId, {
          ...timedOutState,
          mode: SessionMode.IDLE,
          timeoutId: null,
          pendingCommand: undefined, // Clear pending command on timeout
          data: timedOutState.data?.musicPlayer ? {musicPlayer: timedOutState.data.musicPlayer} : undefined // Preserve only source
        });
        session.layouts.showTextWall(options.timeoutMessage || 'Action timed out.', {durationMs: 5000});
      }
    }, options.timeoutMs);

    newState.timeoutId = newTimeoutId;
  }
  
  sessionStates.set(userId, newState);
  logger.info(`[User ${userId}] Mode changed to ${SessionMode[newMode]}`);
}

function clearSessionState(userId: string): void {
  const state = sessionStates.get(userId);
  if (state?.timeoutId) {
      clearTimeout(state.timeoutId);
  }
  
  const deleted = sessionStates.delete(userId);
  if (deleted) {
      logger.info(`[User ${userId}] Cleared session state from map.`);
  } else {
      logger.debug(`[User ${userId}] Attempted to clear session state, but no entry found.`);
  }
}

async function triggerShazam(session: TpaSession, userId: string): Promise<void> {
  logger.info(`[User ${userId}] Triggering shazam listening mode.`, {
    userId: userId
  });
  await enterShazamMode(session, userId);
}

async function enterShazamMode(session: TpaSession, userId: string): Promise<void> {
  session.layouts.showTextWall('Listening for song...', {durationMs: 10000 - 500});
  // Update session mode to LISTENING_FOR_SHAZAM
  setSessionState(session, userId, SessionMode.LISTENING_FOR_SHAZAM, {
    timeoutMs: 10000,
    timeoutMessage: 'Shazam cancelled. No speech detected.'
  });
}

async function handleShazamInput(session: TpaSession, userId: string, transcript: string): Promise<void> {
  logger.info(`[User ${userId}] Processing Shazam input: "${transcript}"`, {
    userId: userId,
    transcript: transcript
  });
  setSessionState(session, userId, SessionMode.IDLE);

  if (!transcript || transcript.trim().length === 0) {
    logger.info(`[User ${userId}] Empty transcript received for Shazam.`, {
      userId: userId
    });
    session.layouts.showTextWall('Could not identify song (no speech).', {durationMs: 5000});
    return;
  }

  try {
    session.layouts.showTextWall(`Searching Shazam for: "${transcript.substring(0, 30)}${transcript.length > 30 ? '...' : ''}"`, {durationMs: 5000});
    const songInfo = await shazamService.findTrack(transcript);

    if (songInfo.trackName) {
      const displayText = 
        `Found song:\n\n` + 
        `Song: ${songInfo.trackName}\n` + 
        `Artist: ${songInfo.artists}`;
      session.layouts.showTextWall(displayText, {durationMs: 5000});
    } else {
      session.layouts.showTextWall(`Could not identify song for "${transcript.substring(0, 30)}${transcript.length > 30 ? '...' : ''}"`, {durationMs: 5000});
    }
  } catch (error) {
    logger.error(`[User ${userId}] Shazam service error`, {
      userId: userId,
      transcript: transcript,
      error: {
        message: error.message,
        stack: error.stack,
        responseStatus: error.response?.status,
        responseBody: error.response?.data 
      }
    });
    session.layouts.showTextWall('Error identifying song via Shazam.', {durationMs: 5000});
  }
}

async function triggerDeviceList(session: TpaSession, userId: string, pendingCommand?: PlayerCommand): Promise<void> {
  logger.info(`[User ${userId}] Triggering device list and selection mode.`, {
    pendingCommand: pendingCommand
  });
  try {
    const tokenValid = await spotifyService.refreshTokenIfNeeded(userId);
    if (!tokenValid) {
      session.layouts.showTextWall('Spotify connection issue. Please reconnect account.', { durationMs: 5000 });
      setSessionState(session, userId, SessionMode.IDLE);
      return;
    }

    const devices = await spotifyService.getDevice(userId);
    const deviceArray: DeviceInfo[] = devices.map((device: any) => ({
      name: device.name, type: device.type, id: device.id,
    }));

    logger.debug(`[User ${userId}] Found devices:`, deviceArray);

    if (deviceArray.length === 0) {
      session.layouts.showTextWall('Open Spotify on a device to begin playback.', { durationMs: 5000 });
      setSessionState(session, userId, SessionMode.IDLE);
    } else if (deviceArray.length === 1) {
      session.layouts.showTextWall(`Playing on: ${deviceArray[0].name} (${deviceArray[0].type})`, { durationMs: 5000 });
      // Auto set device since there's only one
      await spotifyService.setDevice(userId, [deviceArray[0].id]);
      setSessionState(session, userId, SessionMode.IDLE);
      if (pendingCommand) {
        logger.info(`[User ${userId}] Single device auto-selected. Retrying pending command: ${pendingCommand}`);
        await sleep(500);
        await handlePlayerCommand(session, userId, pendingCommand)
      }
    } else {
      // More than one device, enter selection mode
      await enterDeviceSelectionMode(session, userId, deviceArray, pendingCommand);
    }
  } catch (error) {
    logger.error(`[User ${userId}] Error fetching devices for listing.`, {
      userId: userId,
      error: {
        message: error.message,
        stack: error.stack,
        responseStatus: error.response?.status,
        responseBody: error.response?.data 
      }
    });
    session.layouts.showTextWall('Error getting Spotify device list.', { durationMs: 5000 });
    setSessionState(session, userId, SessionMode.IDLE);
  }
}

async function enterDeviceSelectionMode(session: TpaSession, userId: string, devices: DeviceInfo[], pendingCommand?: PlayerCommand): Promise<void> {
  const devicesToShow = devices.slice(0, 3);
  let deviceList = 'Say the number to select device:\n\n';

  devicesToShow.forEach((device, index) => {
    deviceList += `${index + 1}: ${device.name} (${device.type})\n`;
  });

  if (devices.length > 3) {
    deviceList += `... (${devices.length - devicesToShow.length} more)`;
  }

  session.layouts.showTextWall(deviceList.trim(), {durationMs: 10000 - 500});
  const currentStateData = getSessionState(userId).data
  setSessionState(session, userId, SessionMode.AWAITING_DEVICE_SELECTION, {
    data: {
      musicPlayer: currentStateData?.musicPlayer,
      deviceInfo: devicesToShow
    },
    timeoutMs: 10000,
    timeoutMessage: 'Device selection cancelled (timeout).',
    pendingCommand: pendingCommand
  });
}

async function handleDeviceSelectionInput(session: TpaSession, userId: string, transcript: string, availableDevices: DeviceInfo[]): Promise<void> {
  logger.debug(`[User ${userId}] Processing device selection input: "${transcript}"`);
  const stateBeforeReset = getSessionState(userId);
  const commandToRetry = stateBeforeReset.pendingCommand;
  setSessionState(session, userId, SessionMode.IDLE);

  if (!availableDevices || availableDevices.length === 0) {
    logger.warn(`[User ${userId}] Device selection input received, but no devices were stored in state.`);
    session.layouts.showTextWall('Internal error: Device list lost.', { durationMs: 5000 });
    return;
  }

  const selectedNumber = parseNumberFromTranscript(transcript);

  if (selectedNumber !== null && selectedNumber >= 1 && selectedNumber <= availableDevices.length) {
    const selectedDeviceIndex = selectedNumber - 1;
    const selectedDevice = availableDevices[selectedDeviceIndex];

     if (!selectedDevice || !selectedDevice.id) {
        logger.warn(`[User ${userId}] Internal error: Invalid device found at index ${selectedDeviceIndex}`);
        session.layouts.showTextWall('Internal error selecting device.', { durationMs: 5000 });
        return;
     }

    logger.info(`[User ${userId}] User selected device number ${selectedNumber}: ${selectedDevice.name} (ID: ${selectedDevice.id})`);
    session.layouts.showTextWall(`Selecting: ${selectedDevice.name}...`, { durationMs: 5000 });

    try {
      await spotifyService.setDevice(userId, [selectedDevice.id]);
      logger.debug(`[User ${userId}] Successfully set device to ${selectedDevice.id}`);
      session.layouts.showTextWall(`Device set to: ${selectedDevice.name}`, { durationMs: 5000 });

      if (commandToRetry) {
        logger.info(`[User ${userId}] Device selected. Retrying original command: ${commandToRetry}`);
        await sleep(500);
        await handlePlayerCommand(session, userId, commandToRetry);
      } else {
        await displayCurrentlyPlaying(session, userId);
      }
    } catch (error) {
      logger.error(`[User ${userId}] Error setting Spotify device.`, {
        userId: userId,
        selectedNumber: selectedNumber,
        devices: availableDevices,
        error: {
          message: error.message,
          stack: error.stack,
          responseStatus: error.response?.status,
          responseBody: error.response?.data 
        }
      });
      session.layouts.showTextWall(`Error selecting ${selectedDevice.name}.`, { durationMs: 5000 });
    }
  } else {
    logger.info(`[User ${userId}] Invalid device selection input: "${transcript}" (Parsed: ${selectedNumber})`);
    let feedback = 'Invalid selection.';
    if (selectedNumber !== null) {
      feedback = `Please say a number between 1 and ${availableDevices.length}.`;
    }
    session.layouts.showTextWall(feedback, { durationMs: 5000 });
  }
}

function parseNumberFromTranscript(text: string): number | null {
  const lowerText = text.toLowerCase().trim();
  const numberMap: { [key: string]: number } = {
    'one': 1, '1': 1,
    'two': 2, '2': 2, 'to': 2, 'too': 2,
    'three': 3, '3': 3,
  };
  if (lowerText in numberMap) return numberMap[lowerText];
  const parsedInt = parseInt(lowerText, 10);
  if (!isNaN(parsedInt)) return parsedInt;
  return null;
}
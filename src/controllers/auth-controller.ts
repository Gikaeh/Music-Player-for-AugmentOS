import {Router, Request, Response} from 'express';
import {AuthenticatedRequest} from '@mentra/sdk';
import {spotifyService} from '../services/spotify-service';
import logger from '../utils/logger';

const router = Router();

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Handle spotify auth
router.get('/login/:userId', (req: Request, res: Response) => {
  const userId = req.params.userId;

  if (!userId || typeof userId !== 'string' || !emailRegex.test(userId)) {
    logger.warn(`Login attempt with invalid userId format: ${userId}.`);
    return res.status(400).send(`
      <h1>Invalid User ID</h1>
      <p>The user ID provided (${userId || 'none'}) is not a valid email format.</p>
      <p>Please ensure you are using the correct login link associated with your AugmentOS email address.</p>
    `);
  }

  logger.info(`Login request for user: ${userId}.`);
  const authUrl = spotifyService.createAuthorizationUrl(userId);
  res.redirect(authUrl);
});

// Handle callback from Spotify
router.get('/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query;
  const userId = state as string;

  try {
    // Exchange authorization code for access token
    await spotifyService.handleAuthorizationCallback(code as string, userId);

    res.send('Authentication successful! You can close this window and return to your glasses.');
  } catch (error) {
    logger.error('Authentication error:', {
      userId: userId,
      res: res,
      req: req,
      error: {
        message: error.message,
        stack: error.stack,
        responseStatus: error.response?.status,
        responseBody: error.response?.data 
      }
    });
    res.send('Authentication failed. Please try again.');
  }
});

router.get('/webview', (req: AuthenticatedRequest, res) => {
  const userId = req.authUserId

  if (!userId) {
    logger.error('User ID not found on AuthenticatedRequest in /webview route.');
    return res.status(401).send('<h1>Unauthorized</h1><p>Could not identify the user. Please ensure you are logged in.</p>');
  }
  
  const redirectUrl = `/login/${userId}`;
  logger.info(`Redirecting from /webview to ${redirectUrl} for user: ${userId}`);
  res.redirect(redirectUrl);
});

export const authRoutes = router;
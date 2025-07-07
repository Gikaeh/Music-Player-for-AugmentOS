import dotenv from 'dotenv';

// Load env variables
dotenv.config();

export const config = {
  spotify: {
    clientId: process.env.SPOTIFY_CLIENT_ID || 'YOUR_CLIENT_ID',
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET || 'YOUR_CLIENT_SECRET',
    redirectUri: process.env.REDIRECT_URI || 'http://localhost:4040/callback'
  },
  server: {
    webUrl: process.env.WEB_URL || 'http://localhost:4040',
    port: process.env.WEB_PORT || 4040,
    authPort: process.env.AUTH_PORT
  },
  augmentOS: {
    apiKey: process.env.MENTRAOS_API_KEY || '',
    packageName: process.env.MENTRAOS_PACKAGE_NAME || 'org.gikaeh.music-player-for-augment-os'
  },
  encryption: {
    key: process.env.TOKEN_ENCRYPTION_KEY
  },
  logging: {
    appState: process.env.NODE_ENV
  }
};

// Log environment configuration
export function logEnvironment() {
  console.log('=== Environment Variables ===');
  console.log(`URL: ${config.server.webUrl}`);
  console.log(`PORT: ${config.server.port}`);
  console.log(`AUGMENTOS_API_KEY: ${config.augmentOS.apiKey ? 'Set' : 'Not set'}`);
  console.log(`REDIRECT_URI: ${config.spotify.redirectUri ? 'Set' : 'Not set'}`);
}
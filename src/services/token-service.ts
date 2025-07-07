// import fs from 'fs';
// import path from 'path';
// import crypto from 'crypto'
// import {SpotifyCredentials} from '../types';
// import {config} from '../config/environment'
// import logger from '../utils/logger'

// export class TokenService {
//   private userTokens: Map<string, SpotifyCredentials> = new Map();
//   private readonly tokenFilePath: string;
//   private algoritm = 'aes-256-gcm';
//   private secretKey: Buffer = Buffer.from(config.encryption.key, 'base64');
//   private ivLength = 16;

//   constructor() {
//     // Create a data directory if it doesn't exist
//     const dataDir = path.join(__dirname, '../../data');
//     if (!fs.existsSync(dataDir)) {
//       fs.mkdirSync(dataDir, { recursive: true });
//     }
    
//     this.tokenFilePath = path.join(dataDir, 'spotify_tokens.json');
//     this.loadTokens();
//   }
  
//   private encrypt(text: string): string {
//     if (!this.secretKey || this.secretKey.length !== 32) {
//       console.error('Invalid secretKey length or configuration for encryption.');
//     }

//     const iv = crypto.randomBytes(this.ivLength);
//     const cipher = crypto.createCipheriv(this.algoritm, this.secretKey, iv);
//     let encrypted = cipher.update(text, 'utf-8', 'hex');
//     encrypted += cipher.final('hex');
//     const authTag = cipher.getAuthTag();

//     return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
//   }

//   private decrypt(encryptedText: string): string {
//     if (!this.secretKey || this.secretKey.length !== 32) {
//       console.error('Invalid secretKey length or configuration for decryption.');
//     }

//     const parts = encryptedText.split(':');
//     if (parts.length !== 3) {
//       console.error('Invalid encrypted text format.');
//     }

//     const iv = Buffer.from(parts[0], 'hex');
//     const authTag = Buffer.from(parts[1], 'hex');
//     const encrypted = parts[2]
//     const decipher = crypto.createDecipheriv(this.algoritm, this.secretKey, iv);
//     decipher.setAuthTag(authTag);
//     let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
//     decrypted += decipher.final('utf-8');

//     return decrypted;
//   }

//   public getToken(userId: string): SpotifyCredentials | undefined {
//     const encryptedCreds = this.userTokens.get(userId.toLowerCase());
//     if (encryptedCreds) {
//       const accessToken = this.decrypt(encryptedCreds.accessToken);
//       const refreshToken = this.decrypt(encryptedCreds.refreshToken);
//       return {...encryptedCreds, accessToken, refreshToken};
//     }

//     return undefined;
//   }

//   public setToken(userId: string, credentials: SpotifyCredentials): void {
//     const encryptedAccessToken = this.encrypt(credentials.accessToken);
//     const encryptedRefreshToken = this.encrypt(credentials.refreshToken);
//     this.userTokens.set(userId.toLowerCase(), {...credentials, accessToken: encryptedAccessToken, refreshToken: encryptedRefreshToken});
//     this.saveTokens();
//   }

//   public removeToken(userId: string): void {
//     if (this.userTokens.has(userId.toLowerCase())) {
//       this.userTokens.delete(userId.toLowerCase());
//       this.saveTokens();
//       logger.info(`Removed token for session ${userId}`);
//     }
//   }

//   public hasToken(userId: string): boolean {
//     return this.userTokens.has(userId.toLowerCase());
//   }

//   private saveTokens(): void {
//     const tokensToSave: { [key: string]: any } = {}; // Use 'any' temporarily or define a storage type
//     for (const [userId, credentials] of this.userTokens.entries()) {
//       try {
//         tokensToSave[userId.toLowerCase()] = {
//           ...credentials, // Keep non-sensitive fields
//           accessToken: this.encrypt(credentials.accessToken), // Encrypt before saving
//           refreshToken: this.encrypt(credentials.refreshToken), // Encrypt before saving
//         };
//       } catch (error) {
//         logger.error(`Error encrypting token for session ${userId} during save.`, {
//           userId: userId,
//           error: {
//             message: error.message,
//             stack: error.stack,
//             responseStatus: error.response?.status,
//             responseBody: error.response?.data 
//           }
//         });
//         break;
//       }
//     }

//     try {
//       fs.writeFileSync(this.tokenFilePath, JSON.stringify(tokensToSave, null, 2));
//       logger.info('Tokens saved to file (encrypted)');
//     } catch (error) {
//       logger.error('Error writing tokens file.', {
//         filePath: this.tokenFilePath,
//         tokens: tokensToSave,
//         error: {
//           message: error.message,
//           stack: error.stack,
//           responseStatus: error.response?.status,
//           responseBody: error.response?.data 
//         }
//       });
//     }
//   }
  
//   private loadTokens(): void {
//     try {
//       if (!fs.existsSync(this.tokenFilePath)) {
//         logger.warn('No saved tokens file found.', {
//           filePath: this.tokenFilePath
//         });
//         this.userTokens = new Map(); // Ensure map is empty if file doesn't exist
//         return;
//       }

//       const fileContent = fs.readFileSync(this.tokenFilePath, 'utf8');
//         // Handle empty file case to prevent JSON parsing errors
//       if (!fileContent.trim()) {
//         logger.warn('Token file is empty.', {
//           fileLength: fileContent.length
//         });
//         this.userTokens = new Map();
//         return;
//       }

//       // Parse the JSON object containing encrypted tokens
//       const encryptedTokensObj = JSON.parse(fileContent);
//       const loadedTokens = new Map<string, SpotifyCredentials>();

//       // Iterate through each session's encrypted credentials
//       for (const [userId, storedCreds] of Object.entries(encryptedTokensObj)) {
//         // Basic validation - ensure it looks like a credential object with strings to decrypt
//         if (typeof storedCreds !== 'object' || storedCreds === null || typeof storedCreds.accessToken !== 'string' || typeof storedCreds.refreshToken !== 'string') {
//           logger.warn(`Skipping token for user ${userId} due to invalid format in storage.`, {
//             userId: userId,
//             storedCreds: storedCreds
//           });
//           continue;
//         }

//         try {
//           // Decrypt the sensitive fields
//           const accessToken = this.decrypt(storedCreds.accessToken);
//           const refreshToken = this.decrypt(storedCreds.refreshToken);

//           // Create the actual SpotifyCredentials object for in-memory use
//           const decryptedCredentials: SpotifyCredentials = {
//               ...(storedCreds as object), // Cast to allow spreading, assuming other fields are compatible
//               accessToken: accessToken,
//               refreshToken: refreshToken,
//           };

//           // Add the successfully decrypted token to our temporary map
//           loadedTokens.set(userId.toLowerCase(), decryptedCredentials);
//         } catch (error) {
//             // Log specific decryption errors
//             logger.error(`Failed to decrypt token for user ${userId}. Skipping.`, {
//               userId: userId,
//               storedCreds: storedCreds,
//               error: {
//                 message: error.message,
//                 stack: error.stack,
//                 responseStatus: error.response?.status,
//                 responseBody: error.response?.data 
//               }
//             });
//         }
//       }

//       // Replace the in-memory map with the newly loaded and decrypted tokens
//       this.userTokens = loadedTokens;
//       logger.info(`Loaded and decrypted ${this.userTokens.size} tokens from storage.`);
//     } catch (error) {
//       // Catch errors related to file reading or JSON parsing
//       logger.error('Error reading or parsing tokens file.', {
//         error: {
//           message: error.message,
//           stack: error.stack,
//           responseStatus: error.response?.status,
//           responseBody: error.response?.data 
//         }
//       });
//       // Fallback to an empty map in case of critical loading errors
//       this.userTokens = new Map();
//     }
//   }
// }

// export const tokenService = new TokenService();

// REMOVED: fs and path imports
// import fs from 'fs';
// import path from 'path';

import crypto from 'crypto';
import { PrismaClient } from '@prisma/client'; // ADDED: Prisma Client
import { SpotifyCredentials } from '../types';
import { config } from '../config/environment';
import logger from '../utils/logger';

export class TokenService {
  private userTokens: Map<string, SpotifyCredentials> = new Map();
  
  private prisma = new PrismaClient();

  private algorithm = 'aes-256-gcm';
  private secretKey: Buffer = Buffer.from(config.encryption.key, 'base64');
  private ivLength = 16;

  constructor(){}

  /**
   * Initializes the service by loading and decrypting tokens from the database.
   * This method MUST be called after creating an instance of TokenService.
   */
  public async init(): Promise<void> {
    logger.info('Initializing TokenService: loading tokens from database...');
    try {
      const allTokensFromDb = await this.prisma.token.findMany();
      const loadedTokens = new Map<string, SpotifyCredentials>();

      for (const dbToken of allTokensFromDb) {
        try {
          // Decrypt tokens before placing them in the in-memory cache
          const decryptedCreds: SpotifyCredentials = {
            accessToken: this.decrypt(dbToken.accessToken),
            refreshToken: this.decrypt(dbToken.refreshToken),
            expiresIn: dbToken.expiresIn,
            scope: dbToken.scope,
            tokenType: dbToken.tokenType,
          };
          loadedTokens.set(dbToken.userId.toLowerCase(), decryptedCreds);
        } catch (error) {
          logger.error(`Failed to decrypt token for user ${dbToken.userId}. Skipping.`, {
            userId: dbToken.userId,
            error: { message: error.message },
          });
        }
      }

      this.userTokens = loadedTokens;
      logger.info(`Successfully loaded and decrypted ${this.userTokens.size} tokens into cache.`);
    } catch (error) {
      logger.error('Failed to load tokens from the database.', {
        error: { message: error.message, stack: error.stack },
      });
      // In case of a DB error, we start with an empty map.
      this.userTokens = new Map();
    }
  }

  private encrypt(text: string): string {
    if (!this.secretKey || this.secretKey.length !== 32) {
      logger.warn('Invalid secretKey length or configuration for encryption.');
    }

    const iv = crypto.randomBytes(this.ivLength);
    const cipher = crypto.createCipheriv(this.algorithm, this.secretKey, iv);
    let encrypted = cipher.update(text, 'utf-8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  }
    
  private decrypt(encryptedText: string): string {
    if (!this.secretKey || this.secretKey.length !== 32) {
      logger.warn('Invalid secretKey length or configuration for decryption.');
    }

    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
      logger.warn('Invalid encrypted text format.');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2]
    const decipher = crypto.createDecipheriv(this.algorithm, this.secretKey, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
    decrypted += decipher.final('utf-8');

    return decrypted;
  }

  // This method now reads directly from the fast in-memory cache.
  public getToken(userId: string): SpotifyCredentials | undefined {
    return this.userTokens.get(userId.toLowerCase());
  }
  
  // CHANGED: This method is now async and writes to the database.
  public async setToken(userId: string, credentials: SpotifyCredentials): Promise<void> {
    const lowerCaseUserId = userId.toLowerCase();

    // 1. Update the in-memory cache with the plain text credentials for immediate use.
    this.userTokens.set(lowerCaseUserId, credentials);
    logger.info(`Token for user ${lowerCaseUserId} updated in-memory cache.`);

    // 2. Encrypt and persist to the database.
    const dataToStore = {
      userId: lowerCaseUserId,
      accessToken: this.encrypt(credentials.accessToken),
      refreshToken: this.encrypt(credentials.refreshToken),
      expiresIn: credentials.expiresIn,
      scope: credentials.scope,
      tokenType: credentials.tokenType,
    };

    try {
      // `upsert` is perfect: it updates if the user exists, or creates if it doesn't.
      await this.prisma.token.upsert({
        where: { userId: lowerCaseUserId },
        update: dataToStore,
        create: dataToStore,
      });
      logger.info(`Token for user ${lowerCaseUserId} successfully saved to the database.`);
    } catch (error) {
      logger.error(`Failed to save token for user ${lowerCaseUserId} to the database.`, {
        error: { message: error.message, stack: error.stack },
      });
    }
  }

  // CHANGED: This method is now async and deletes from the database.
  public async removeToken(userId: string): Promise<void> {
    const lowerCaseUserId = userId.toLowerCase();
    if (this.userTokens.has(lowerCaseUserId)) {
      // 1. Remove from in-memory cache
      this.userTokens.delete(lowerCaseUserId);

      // 2. Remove from database
      try {
        await this.prisma.token.delete({
          where: { userId: lowerCaseUserId },
        });
        logger.info(`Removed token for user ${lowerCaseUserId} from cache and database.`);
      } catch (error) {
        // It's possible the token was already deleted from the DB.
        // Prisma throws an error if the record to delete is not found. We can log it as a warning.
        logger.error(`Could not remove token for user ${lowerCaseUserId} from DB (it may have already been deleted).`, {
          error: { message: error.message },
        });
      }
    }
  }

  public hasToken(userId: string): boolean {
    return this.userTokens.has(userId.toLowerCase());
  }
}

export const tokenService = new TokenService();
import {server} from './server';
import { logEnvironment } from './config/environment';

// Log environment variables
logEnvironment();

server.start().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
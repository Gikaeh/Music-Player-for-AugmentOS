import express from 'express';
import {authRoutes} from './controllers/auth-controller';
import { tokenService } from './services/token-service';

export async function createExpressApp() {
  await tokenService.init();
  
  const app = express();
  
  // Add authentication routes
  app.use('/', authRoutes);
  
  return app;
}
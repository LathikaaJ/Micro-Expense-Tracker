/**
 * AI Micro-Expense Tracker — Real-Time Streaming Analytics Platform
 *
 * Architecture:
 *   - JSON file store (no MongoDB)
 *   - Socket.IO WebSocket server (/stream, /alerts namespaces)
 *   - Stream analytics engine (sliding windows, incremental aggregation)
 *   - Hybrid ML classification pipeline (Rule → ML → Gemini)
 *   - Performance monitoring middleware
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';

import authRoutes from './routes/auth.js';
import expenseRoutes from './routes/expenses.js';
import budgetRoutes from './routes/budget.js';
import mlRoutes from './routes/ml.js';
import receiptRoutes from './routes/receipts.js';
import forecastingRoutes from './routes/forecasting.js';
import { authenticateToken } from './middleware/auth.js';
import { mlClassifier } from './services/mlModel.js';
import { streamAnalytics } from './services/streamAnalytics.js';
import { initSocketServer } from './services/socketServer.js';
import { db } from './store/fileStore.js';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 5000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));

// Performance monitoring middleware
app.use((req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => {
    const latency = Date.now() - t0;
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${latency}ms`);
    }
    // Record to stream analytics perf tracker
    streamAnalytics.perf.recordEvent(latency);
  });
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/expenses', authenticateToken, expenseRoutes);
app.use('/api/budget', authenticateToken, budgetRoutes);
app.use('/api/ml', authenticateToken, mlRoutes);
app.use('/api/forecasting', authenticateToken, forecastingRoutes);
app.use('/api/receipts', authenticateToken, receiptRoutes);

// Performance metrics endpoint
app.get('/api/metrics', authenticateToken, (_req, res) => {
  res.json(streamAnalytics.getPerformanceMetrics());
});

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    storage: 'json-file',
    mlModelLoaded: mlClassifier.isLoaded,
    mlVersion: mlClassifier.version,
    wsConnections: streamAnalytics.perf.wsConnections,
    users: db.users.size(),
    expenses: db.expenses.size(),
    timestamp: new Date().toISOString()
  });
});

// Global error handler
app.use((err, _req, res, _next) => {
  console.error('[Unhandled Error]', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Startup ──────────────────────────────────────────────────────────────────
async function start() {
  try {
    console.log('[Store] JSON file store loaded');
    console.log(`[Store] Users: ${db.users.size()}, Expenses: ${db.expenses.size()}`);

    // Initialize stream analytics from stored data
    await streamAnalytics.init();

    // Load ML model from file store
    await mlClassifier.loadFromDB();

    // Initialize Socket.IO
    initSocketServer(httpServer);

    httpServer.listen(PORT, () => {
      console.log(`[Server] Real-Time Streaming Platform running on port ${PORT}`);
      console.log(`[Server] ML: ${mlClassifier.isLoaded ? `v${mlClassifier.version} loaded` : 'not trained (rule-based active)'}`);
      console.log(`[Server] WebSocket: ws://localhost:${PORT}/stream, /alerts`);
    });
  } catch (err) {
    console.error('[Startup] Fatal error:', err);
    process.exit(1);
  }
}

start();

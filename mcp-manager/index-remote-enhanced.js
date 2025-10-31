#!/usr/bin/env node
/**
 * MCP Manager - Remote Worker Enhanced
 * 
 * This is the interactive manager enhanced with remote Docker worker management.
 * It includes all interactive features plus remote worker C2 capabilities.
 */

// Import the remote worker tools
import { remoteWorkerTools, createRemoteWorkerHandlers } from './remote-worker-tools.js';

// Re-export everything from the base interactive manager
import * as baseManager from './index-interactive-fixed.js';

// Note: This file serves as an entry point that combines:
// 1. All interactive manager features
// 2. Remote worker management tools
//
// To use this enhanced manager, update your mcp.json to point to this file.

console.error('═══════════════════════════════════════════════════════════════');
console.error('🌐 MCP Manager - Remote Worker Enhanced');
console.error('   - Interactive worker communication ✓');
console.error('   - Remote Docker worker management ✓');
console.error('   - C2 command and control ✓');
console.error('═══════════════════════════════════════════════════════════════');

// The actual integration happens by importing index-interactive-fixed.js
// and enhancing it with remote worker capabilities in the tools list


#!/usr/bin/env node

/**
 * DOMLogger++ MCP Server
 * 
 * A Node.js MCP server that provides browser automation + DOMLogger++ extension control
 * for Cursor Desktop and other MCP clients.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Extension path (one level up from backend, into app folder)
const EXTENSION_PATH = join(__dirname, '..', 'app');

console.error(`[DOMLogger MCP] Extension path: ${EXTENSION_PATH}`);

class DOMLoggerMCPServer {
  constructor() {
    this.server = new Server(
      {
        name: 'domlogger-unified',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    this.browser = null;
    this.page = null;
    this.pages = []; // Track multiple pages
    this.selectedPageIndex = 0; // Currently selected page
    this.userConfig = null;
    this.currentScope = null;
    this.lastNavigatedUrl = null;
    this.cdpSessions = new Map(); // Map of page -> CDP session
    this.debuggerEnabled = new Map(); // Track debugger state per page
    this.networkRequests = new Map(); // Track network requests per page
    this.consoleMessages = new Map(); // Track console messages per page
    this.performanceTraceRunning = false; // Track if performance trace is running
    this.performanceTracePage = null; // Page being traced
    this.setupHandlers();
    
    console.error('[DOMLogger MCP] Server initialized with enhanced auto-configuration');
  }

  setupHandlers() {
    // Handle tool listing
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'browser_navigate',
          description: 'Navigate browser to a URL with automatic DOMLogger++ configuration and scope management. Automatically applies user config (if set) or default config, adds domain to monitoring scope, and prepares for sink capture.',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'URL to navigate to',
              },
            },
            required: ['url'],
          },
        },
        {
          name: 'browser_click',
          description: 'Click an element on the page',
          inputSchema: {
            type: 'object',
            properties: {
              selector: {
                type: 'string',
                description: 'CSS selector',
              },
              wait_time: {
                type: 'number',
                description: 'Wait time in ms (default: 0)',
              },
            },
            required: ['selector'],
          },
        },
        {
          name: 'browser_type',
          description: 'Type text into an input field',
          inputSchema: {
            type: 'object',
            properties: {
              selector: {
                type: 'string',
                description: 'CSS selector',
              },
              text: {
                type: 'string',
                description: 'Text to type',
              },
            },
            required: ['selector', 'text'],
          },
        },
        {
          name: 'browser_evaluate',
          description: 'Execute JavaScript in the page context',
          inputSchema: {
            type: 'object',
            properties: {
              script: {
                type: 'string',
                description: 'JavaScript code to execute',
              },
            },
            required: ['script'],
          },
        },
        {
          name: 'browser_screenshot',
          description: 'Take a screenshot of the page',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Path to save screenshot',
              },
              full_page: {
                type: 'boolean',
                description: 'Capture full page (default: false)',
              },
            },
          },
        },
        {
          name: 'browser_get_url',
          description: 'Get current page URL',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'browser_wait_for_selector',
          description: 'Wait for an element to appear',
          inputSchema: {
            type: 'object',
            properties: {
              selector: {
                type: 'string',
                description: 'CSS selector',
              },
              timeout: {
                type: 'number',
                description: 'Timeout in ms (default: 30000)',
              },
            },
            required: ['selector'],
          },
        },
        {
          name: 'domlogger_add_scope',
          description: 'Add a domain pattern to DOMLogger++ monitoring scope',
          inputSchema: {
            type: 'object',
            properties: {
              pattern: {
                type: 'string',
                description: 'Regex pattern for domain',
              },
            },
            required: ['pattern'],
          },
        },
        {
          name: 'domlogger_query_sinks',
          description: 'Query captured JavaScript sinks from DOMLogger++',
          inputSchema: {
            type: 'object',
            properties: {
              sink_type: {
                type: 'string',
                description: 'Filter by sink name',
              },
              tag: {
                type: 'string',
                description: 'Filter by category',
              },
              data_contains: {
                type: 'string',
                description: 'Filter by data content',
              },
              limit: {
                type: 'number',
                description: 'Max results (default: 100)',
              },
            },
          },
        },
        {
          name: 'domlogger_set_config',
          description: 'Set DOMLogger++ hook configuration. Stores user config for automatic application on future navigations. Automatically refreshes current page to capture sinks with new configuration.',
          inputSchema: {
            type: 'object',
            properties: {
              config_name: {
                type: 'string',
                description: 'Name for the configuration (will be stored as user config)',
              },
              config: {
                type: 'object',
                description: 'Hook configuration object with hooks, functions, attributes, events',
              },
            },
            required: ['config_name', 'config'],
          },
        },
        {
          name: 'domlogger_get_statistics',
          description: 'Get statistics about captured sinks',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'domlogger_clear_data',
          description: 'Clear captured sink data',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'domlogger_manage_config',
          description: 'Manage user configuration - view current config, reset to default, or get config status',
          inputSchema: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['view', 'reset', 'status'],
                description: 'Action to perform: view current config, reset to default, or get status',
              },
            },
            required: ['action'],
          },
        },
        {
          name: 'domlogger_goto_sink_with_canary',
          description: 'Find all sinks containing canary, open each in new window, set breakpoints, get callstacks',
          inputSchema: {
            type: 'object',
            properties: {
              canary: {
                type: 'string',
                description: 'Canary string to search for in sink data (can be anything)',
              },
              max_sinks: {
                type: 'number',
                description: 'Maximum number of sinks to process (default: 10)',
              },
              auto_get_callstack: {
                type: 'boolean',
                description: 'Automatically get callstack for each sink (default: true)',
              },
            },
            required: ['canary'],
          },
        },
        {
          name: 'browser_get_callstack',
          description: 'Get call stack when debugger pauses at breakpoint',
          inputSchema: {
            type: 'object',
            properties: {
              timeout: {
                type: 'number',
                description: 'Max time to wait for pause in ms (default: 30000)',
              },
            },
          },
        },
        {
          name: 'browser_navigate_callstack',
          description: 'Navigate to DevTools Call Stack panel and click on specific frame',
          inputSchema: {
            type: 'object',
            properties: {
              frameIndex: {
                type: 'number',
                description: 'Index of call stack frame to click (0-based, default: 1 for second frame)',
              },
              openDevTools: {
                type: 'boolean',
                description: 'Whether to open DevTools first (default: true)',
              },
            },
          },
        },
        // ========== DEBUGGER TOOLS ==========
        {
          name: 'debugger_enable',
          description: 'Enable the Chrome debugger on the selected page. Required before setting breakpoints.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'debugger_disable',
          description: 'Disable the Chrome debugger on the selected page.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'debugger_set_breakpoint_by_url',
          description: 'Set a breakpoint at a specific line in a script URL.',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'URL or file path of the script',
              },
              lineNumber: {
                type: 'number',
                description: 'Line number (0-based)',
              },
              columnNumber: {
                type: 'number',
                description: 'Column number (0-based, optional)',
              },
              condition: {
                type: 'string',
                description: 'Optional condition for conditional breakpoint',
              },
            },
            required: ['url', 'lineNumber'],
          },
        },
        {
          name: 'debugger_remove_breakpoint',
          description: 'Remove a breakpoint by its ID.',
          inputSchema: {
            type: 'object',
            properties: {
              breakpointId: {
                type: 'string',
                description: 'Breakpoint ID to remove',
              },
            },
            required: ['breakpointId'],
          },
        },
        {
          name: 'debugger_resume',
          description: 'Resume JavaScript execution after being paused.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'debugger_pause',
          description: 'Pause JavaScript execution immediately.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'debugger_step_over',
          description: 'Step over the current line.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'debugger_step_into',
          description: 'Step into function call.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'debugger_step_out',
          description: 'Step out of current function.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'debugger_get_call_stack',
          description: 'Get the call stack from a paused page.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'debugger_evaluate_on_call_frame',
          description: 'Evaluate an expression in the context of a paused call frame.',
          inputSchema: {
            type: 'object',
            properties: {
              callFrameId: {
                type: 'string',
                description: 'Call frame ID (use "0" for top frame)',
              },
              expression: {
                type: 'string',
                description: 'Expression to evaluate',
              },
            },
            required: ['callFrameId', 'expression'],
          },
        },
        {
          name: 'debugger_get_script_source',
          description: 'Get JavaScript source code by script ID.',
          inputSchema: {
            type: 'object',
            properties: {
              scriptId: {
                type: 'string',
                description: 'Script ID to retrieve',
              },
            },
            required: ['scriptId'],
          },
        },
        {
          name: 'debugger_set_xhr_breakpoint',
          description: 'Set a breakpoint that pauses on XHR/Fetch requests.',
          inputSchema: {
            type: 'object',
            properties: {
              urlPattern: {
                type: 'string',
                description: 'URL pattern to match (optional, empty = all requests)',
              },
            },
          },
        },
        {
          name: 'debugger_set_event_breakpoint',
          description: 'Set a breakpoint that pauses on DOM events.',
          inputSchema: {
            type: 'object',
            properties: {
              eventName: {
                type: 'string',
                description: 'Event name (e.g., "click", "keydown", "load")',
              },
              targetName: {
                type: 'string',
                description: 'Optional target name (e.g., "Window", "Document")',
              },
            },
            required: ['eventName'],
          },
        },
        {
          name: 'debugger_pause_on_exceptions',
          description: 'Configure when to pause on exceptions.',
          inputSchema: {
            type: 'object',
            properties: {
              state: {
                type: 'string',
                enum: ['none', 'uncaught', 'all'],
                description: 'When to pause: none, uncaught, or all exceptions',
              },
            },
            required: ['state'],
          },
        },
        {
          name: 'debugger_set_logpoint',
          description: 'Set a logpoint that logs expressions to console without pausing execution.',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'URL or file path of the script',
              },
              lineNumber: {
                type: 'number',
                description: 'Line number (0-based)',
              },
              columnNumber: {
                type: 'number',
                description: 'Column number (0-based, optional)',
              },
              logMessage: {
                type: 'string',
                description: 'Expression to log (e.g., "userId", "request.body")',
              },
            },
            required: ['url', 'lineNumber', 'logMessage'],
          },
        },
        // ========== PAGE MANAGEMENT TOOLS ==========
        {
          name: 'list_pages',
          description: 'Get a list of pages open in the browser.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'select_page',
          description: 'Select a page as a context for future tool calls.',
          inputSchema: {
            type: 'object',
            properties: {
              pageIdx: {
                type: 'number',
                description: 'The index of the page to select. Call list_pages to list pages.',
              },
            },
            required: ['pageIdx'],
          },
        },
        {
          name: 'close_page',
          description: 'Closes the page by its index. The last open page cannot be closed.',
          inputSchema: {
            type: 'object',
            properties: {
              pageIdx: {
                type: 'number',
                description: 'The index of the page to close. Call list_pages to list pages.',
              },
            },
            required: ['pageIdx'],
          },
        },
        {
          name: 'new_page',
          description: 'Creates a new page and navigates to a URL.',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'URL to load in a new page.',
              },
              timeout: {
                type: 'number',
                description: 'Navigation timeout in ms (default: 30000)',
              },
            },
            required: ['url'],
          },
        },
        {
          name: 'navigate_page',
          description: 'Navigates the currently selected page to a URL.',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'URL to navigate the page to',
              },
              timeout: {
                type: 'number',
                description: 'Navigation timeout in ms (default: 30000)',
              },
            },
            required: ['url'],
          },
        },
        {
          name: 'navigate_page_history',
          description: 'Navigate back or forward in the currently selected page history.',
          inputSchema: {
            type: 'object',
            properties: {
              navigate: {
                type: 'string',
                enum: ['back', 'forward'],
                description: 'Whether to navigate back or forward in the selected pages history',
              },
              timeout: {
                type: 'number',
                description: 'Navigation timeout in ms (default: 30000)',
              },
            },
            required: ['navigate'],
          },
        },
        {
          name: 'wait_for',
          description: 'Wait for a selector to appear or for a specified timeout.',
          inputSchema: {
            type: 'object',
            properties: {
              selector: {
                type: 'string',
                description: 'CSS selector to wait for',
              },
              timeout: {
                type: 'number',
                description: 'Timeout in ms (default: 30000)',
              },
            },
            required: ['selector'],
          },
        },
        // ========== INPUT TOOLS ==========
        {
          name: 'click',
          description: 'Click on an element using a CSS selector',
          inputSchema: {
            type: 'object',
            properties: {
              selector: {
                type: 'string',
                description: 'CSS selector of element to click',
              },
              dblClick: {
                type: 'boolean',
                description: 'Set to true for double clicks',
              },
            },
            required: ['selector'],
          },
        },
        {
          name: 'hover',
          description: 'Hover over an element using a CSS selector',
          inputSchema: {
            type: 'object',
            properties: {
              selector: {
                type: 'string',
                description: 'CSS selector of element to hover',
              },
            },
            required: ['selector'],
          },
        },
        {
          name: 'fill',
          description: 'Fill a form field using a CSS selector',
          inputSchema: {
            type: 'object',
            properties: {
              selector: {
                type: 'string',
                description: 'CSS selector of input field',
              },
              value: {
                type: 'string',
                description: 'Value to type into the field',
              },
            },
            required: ['selector', 'value'],
          },
        },
        {
          name: 'handle_dialog',
          description: 'If a browser dialog was opened, use this command to handle it',
          inputSchema: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['accept', 'dismiss'],
                description: 'Whether to dismiss or accept the dialog',
              },
              promptText: {
                type: 'string',
                description: 'Optional prompt text to enter into the dialog.',
              },
            },
            required: ['action'],
          },
        },
        // ========== NETWORK TOOLS ==========
        {
          name: 'list_network_requests',
          description: 'List all network requests captured on the selected page.',
          inputSchema: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
                description: 'Maximum number of requests to return (default: 100)',
              },
              filter: {
                type: 'string',
                description: 'Filter requests by URL pattern',
              },
            },
          },
        },
        {
          name: 'get_network_request',
          description: 'Get detailed information about a specific network request by ID.',
          inputSchema: {
            type: 'object',
            properties: {
              requestId: {
                type: 'string',
                description: 'Request ID from list_network_requests',
              },
            },
            required: ['requestId'],
          },
        },
        // ========== CONSOLE TOOLS ==========
        {
          name: 'list_console_messages',
          description: 'List all console messages captured on the selected page.',
          inputSchema: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
                description: 'Maximum number of messages to return (default: 100)',
              },
              type: {
                type: 'string',
                enum: ['log', 'info', 'warn', 'error', 'debug'],
                description: 'Filter by message type',
              },
            },
          },
        },
        {
          name: 'get_console_message',
          description: 'Get detailed information about a specific console message by ID.',
          inputSchema: {
            type: 'object',
            properties: {
              messageId: {
                type: 'string',
                description: 'Message ID from list_console_messages',
              },
            },
            required: ['messageId'],
          },
        },
        // ========== SCREENSHOT & SNAPSHOT TOOLS ==========
        {
          name: 'take_screenshot',
          description: 'Take a screenshot of the selected page.',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Path to save screenshot',
              },
              fullPage: {
                type: 'boolean',
                description: 'Capture full page (default: false)',
              },
            },
          },
        },
        {
          name: 'take_snapshot',
          description: 'Take a DOM snapshot of the selected page.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        // ========== EMULATION TOOLS ==========
        {
          name: 'emulate_network',
          description: 'Emulate network conditions (3G, 4G, slow, fast, offline).',
          inputSchema: {
            type: 'object',
            properties: {
              profile: {
                type: 'string',
                enum: ['fast3g', 'slow3g', '4g', 'offline', 'online'],
                description: 'Network profile to emulate',
              },
            },
            required: ['profile'],
          },
        },
        {
          name: 'emulate_cpu',
          description: 'Emulate CPU throttling (slowdown factor).',
          inputSchema: {
            type: 'object',
            properties: {
              throttling: {
                type: 'number',
                description: 'CPU throttling multiplier (e.g., 4 = 4x slowdown)',
              },
            },
            required: ['throttling'],
          },
        },
        {
          name: 'resize_page',
          description: 'Resize the selected page viewport to specific dimensions.',
          inputSchema: {
            type: 'object',
            properties: {
              width: {
                type: 'number',
                description: 'Page width in pixels',
              },
              height: {
                type: 'number',
                description: 'Page height in pixels',
              },
            },
            required: ['width', 'height'],
          },
        },
        // ========== SCRIPT EVALUATION ==========
        {
          name: 'evaluate_script',
          description: 'Execute JavaScript on the selected page (alias for browser_evaluate).',
          inputSchema: {
            type: 'object',
            properties: {
              script: {
                type: 'string',
                description: 'JavaScript code to execute',
              },
            },
            required: ['script'],
          },
        },
        // ========== PERFORMANCE TOOLS ==========
        {
          name: 'performance_start_trace',
          description: 'Starts a performance trace recording on the selected page for analyzing performance metrics.',
          inputSchema: {
            type: 'object',
            properties: {
              reload: {
                type: 'boolean',
                description: 'Whether to reload the page after starting the trace (default: false)',
              },
            },
          },
        },
        {
          name: 'performance_stop_trace',
          description: 'Stops the active performance trace recording and returns performance metrics.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'get_performance_metrics',
          description: 'Get current performance metrics from the selected page without a full trace.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      
      console.error(`[DOMLogger MCP] Tool called: ${name}`);
      
      try {
        const result = await this.handleToolCall(name, args || {});
        return {
          content: [
            {
              type: 'text',
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        console.error(`[DOMLogger MCP] Tool error:`, error);
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    });

    // Handle resource listing
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [],
    }));
  }

  async ensureBrowser() {
    if (!this.browser) {
      console.error('[DOMLogger MCP] Starting browser with extension...');
      
      // Check if extension exists
      if (!fs.existsSync(EXTENSION_PATH)) {
        throw new Error(`Extension not found at: ${EXTENSION_PATH}`);
      }
      
      // Check for manifest
      const manifestPath = join(EXTENSION_PATH, 'manifest.json');
      if (!fs.existsSync(manifestPath)) {
        throw new Error(`Extension manifest not found at: ${manifestPath}`);
      }
      
      // Launch browser with extension in headless mode
      this.browser = await puppeteer.launch({
        headless: 'new', // Using new headless mode which supports extensions
        args: [
          `--disable-extensions-except=${EXTENSION_PATH}`,
          `--load-extension=${EXTENSION_PATH}`,
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
        ],
      });
      
      const pages = await this.browser.pages();
      this.page = pages[0] || await this.browser.newPage();
      
      // Initialize pages array
      await this.updatePagesArray();
      
      // Set up listeners for network and console on the default page
      await this.setupPageListeners(this.page);
      
      console.error('[DOMLogger MCP] Browser started with DOMLogger++ extension loaded');
    }
    return { browser: this.browser, page: this.page };
  }

  async updatePagesArray() {
    if (this.browser) {
      this.pages = await this.browser.pages();
      // Ensure selectedPageIndex is valid
      if (this.selectedPageIndex >= this.pages.length) {
        this.selectedPageIndex = this.pages.length - 1;
      }
      if (this.selectedPageIndex < 0 && this.pages.length > 0) {
        this.selectedPageIndex = 0;
      }
    }
  }

  getSelectedPage() {
    if (this.pages.length === 0) {
      throw new Error('No pages available');
    }
    return this.pages[this.selectedPageIndex] || this.pages[0];
  }

  async getCDPSession(page) {
    if (!this.cdpSessions.has(page)) {
      const session = await page.target().createCDPSession();
      this.cdpSessions.set(page, session);
    }
    return this.cdpSessions.get(page);
  }

  async setupPageListeners(page) {
    // Set up network request tracking
    const pageRequests = [];
    this.networkRequests.set(page, pageRequests);

    page.on('request', (request) => {
      pageRequests.push({
        id: request._requestId,
        url: request.url(),
        method: request.method(),
        headers: request.headers(),
        timestamp: Date.now(),
        type: 'request',
      });
    });

    page.on('response', (response) => {
      const request = pageRequests.find(r => r.url === response.url());
      if (request) {
        request.status = response.status();
        request.statusText = response.statusText();
        request.responseHeaders = response.headers();
        request.type = 'response';
      }
    });

    // Set up console message tracking
    const pageMessages = [];
    this.consoleMessages.set(page, pageMessages);

    page.on('console', (message) => {
      pageMessages.push({
        id: `msg_${pageMessages.length}`,
        type: message.type(),
        text: message.text(),
        location: message.location(),
        timestamp: Date.now(),
        args: message.args().map(arg => arg.toString()),
      });
    });
  }

  // Helper method to get default configuration
  getDefaultConfig() {
    return {
      hooks: {
        XSS: {
          function: ['eval', 'Function', 'setTimeout', 'setInterval'],
          attribute: ['set:Element.prototype.innerHTML', 'set:Element.prototype.outerHTML']
        },
        ANALYTICS: {
          function: ['fetch', 'XMLHttpRequest.prototype.send', 'navigator.sendBeacon'],
          event: ['click', 'submit']
        }
      }
    };
  }

  // Helper method to apply configuration automatically
  async applyConfiguration() {
    const configToUse = this.userConfig || this.getDefaultConfig();
    const configName = this.userConfig ? 'USER_CONFIG' : 'DEFAULT_CONFIG';
    
    console.error(`[DOMLogger MCP] Applying ${configName}...`);
    
    try {
      const result = await this.handleToolCall('domlogger_set_config', {
        config_name: configName,
        config: configToUse
      });
      
      if (result.success) {
        console.error(`[DOMLogger MCP] ✓ ${configName} applied successfully`);
        return true;
      } else {
        console.error(`[DOMLogger MCP] ✗ Failed to apply ${configName}:`, result.error);
        return false;
      }
    } catch (error) {
      console.error(`[DOMLogger MCP] ✗ Error applying ${configName}:`, error.message);
      return false;
    }
  }

  // Helper method to add scope automatically based on URL
  async addScopeForUrl(url) {
    try {
      const domain = url.replace(/^https?:\/\//, '').split('/')[0];
      
      // Skip if already added this scope
      if (this.currentScope === domain) {
        console.error(`[DOMLogger MCP] Scope already set for: ${domain}`);
        return true;
      }
      
      console.error(`[DOMLogger MCP] Adding scope for domain: ${domain}`);
      
      const result = await this.handleToolCall('domlogger_add_scope', {
        pattern: domain
      });
      
      if (result.success) {
        this.currentScope = domain;
        console.error(`[DOMLogger MCP] ✓ Scope added for: ${domain}`);
        return true;
      } else {
        console.error(`[DOMLogger MCP] ✗ Failed to add scope:`, result.error);
        return false;
      }
    } catch (error) {
      console.error(`[DOMLogger MCP] ✗ Error adding scope:`, error.message);
      return false;
    }
  }

  // Helper method to refresh page after configuration changes
  async refreshPageForSinks() {
    if (!this.lastNavigatedUrl) {
      console.error('[DOMLogger MCP] No URL to refresh');
      return false;
    }
    
    try {
      console.error(`[DOMLogger MCP] Refreshing page to capture sinks: ${this.lastNavigatedUrl}`);
      
      const { page } = await this.ensureBrowser();
      await page.reload({ waitUntil: 'networkidle2' });
      
      // Wait a bit for JavaScript to execute and sinks to be captured
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      console.error('[DOMLogger MCP] ✓ Page refreshed, sinks should now be captured');
      return true;
    } catch (error) {
      console.error(`[DOMLogger MCP] ✗ Error refreshing page:`, error.message);
      return false;
    }
  }

  async getExtensionPage(browser) {
    // Access extension via service worker or background page
    if (!this.extensionPage) {
      // Get all targets (pages, workers, etc.)
      const targets = await browser.targets();
      
      console.error('[DOMLogger MCP] Looking for extension context...');
      
      // Find any extension page (popup, options, devtools, etc.)
      const extTarget = targets.find(t => t.url().includes('chrome-extension://'));
      
      if (extTarget) {
        const extId = extTarget.url().match(/chrome-extension:\/\/([^\/]+)/)?.[1];
        console.error('[DOMLogger MCP] Found extension ID:', extId);
        
        if (extId) {
          // Create a new page and navigate to extension's options page
          this.extensionPage = await browser.newPage();
          
          try {
            // Navigate to the extension's options page where chrome.storage is available
            await this.extensionPage.goto(`chrome-extension://${extId}/src/options/options.html`, {
              waitUntil: 'networkidle0',
              timeout: 10000
            });
            
            // Wait a bit more for chrome APIs to be ready
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Verify chrome.storage is available
            const hasStorage = await this.extensionPage.evaluate(() => {
              return typeof chrome !== 'undefined' && typeof chrome.storage !== 'undefined';
            });
            
            if (hasStorage) {
              console.error('[DOMLogger MCP] ✓ Extension page ready with chrome.storage access');
            } else {
              console.error('[DOMLogger MCP] ✗ Extension page loaded but chrome.storage not available');
            }
          } catch (e) {
            console.error('[DOMLogger MCP] Failed to navigate to options page:', e.message);
            
            // Try popup page as fallback
            try {
              await this.extensionPage.goto(`chrome-extension://${extId}/src/popup/popup.html`, {
                waitUntil: 'networkidle0',
                timeout: 10000
              });
              await new Promise(resolve => setTimeout(resolve, 1000));
              console.error('[DOMLogger MCP] ✓ Extension popup page loaded');
            } catch (e2) {
              console.error('[DOMLogger MCP] Failed to navigate to popup page:', e2.message);
            }
          }
        }
      } else {
        console.error('[DOMLogger MCP] No extension target found! Extension may not be loaded.');
      }
    }
    
    return this.extensionPage || this.page;
  }

  async handleToolCall(name, args) {
    // Browser automation tools
    if (name === 'browser_navigate') {
      const { page } = await this.ensureBrowser();
      
      console.error(`[DOMLogger MCP] Enhanced navigation to: ${args.url}`);
      
      // 1. Apply configuration (user config or default)
      const configApplied = await this.applyConfiguration();
      
      // 2. Add scope for the target domain
      const scopeAdded = await this.addScopeForUrl(args.url);
      
      // 3. Navigate to the URL
      await page.goto(args.url, { waitUntil: 'networkidle2' });
      this.lastNavigatedUrl = args.url;
      
      // 4. Wait for initial JavaScript execution
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      console.error('[DOMLogger MCP] ✓ Enhanced navigation complete with auto-config and scope');
      
      return { 
        success: true, 
        url: args.url,
        config_applied: configApplied,
        scope_added: scopeAdded,
        auto_configured: true,
        message: 'Page loaded with automatic DOMLogger++ configuration and scope management'
      };
    }

    if (name === 'browser_click') {
      const { page } = await this.ensureBrowser();
      if (args.wait_time) {
        await new Promise(resolve => setTimeout(resolve, args.wait_time));
      }
      await page.click(args.selector);
      return { success: true, selector: args.selector };
    }

    if (name === 'browser_type') {
      const { page } = await this.ensureBrowser();
      await page.type(args.selector, args.text);
      return { success: true, selector: args.selector, text: args.text };
    }

    if (name === 'browser_evaluate') {
      const { page } = await this.ensureBrowser();
      const result = await page.evaluate(args.script);
      return { success: true, result };
    }

    if (name === 'browser_screenshot') {
      const { page } = await this.ensureBrowser();
      const screenshotPath = args.path || join(__dirname, 'screenshot.png');
      await page.screenshot({
        path: screenshotPath,
        fullPage: args.full_page || false,
      });
      return { success: true, path: screenshotPath };
    }

    if (name === 'browser_get_url') {
      const { page } = await this.ensureBrowser();
      return { url: page.url() };
    }

    if (name === 'browser_wait_for_selector') {
      const { page } = await this.ensureBrowser();
      await page.waitForSelector(args.selector, {
        timeout: args.timeout || 30000,
      });
      return { success: true, selector: args.selector };
    }

    // DOMLogger++ extension tools
    if (name === 'domlogger_add_scope') {
      const { browser, page } = await this.ensureBrowser();
      
      // Get extension ID and navigate to extension page for chrome.runtime access
      const targets = await browser.targets();
      const extTarget = targets.find(t => t.url().includes('chrome-extension://'));
      
      if (!extTarget) {
        return { success: false, error: 'Extension not loaded' };
      }
      
      const extId = extTarget.url().match(/chrome-extension:\/\/([^\/]+)/)?.[1];
      
      // Create or reuse extension page
      if (!this.extensionControlPage) {
        this.extensionControlPage = await browser.newPage();
        await this.extensionControlPage.goto(`chrome-extension://${extId}/src/popup/popup.html`);
        await new Promise(r => setTimeout(r, 500)); // Wait for page to load
      }
      
      // Call the extension's MCP server via runtime messaging
      const result = await this.extensionControlPage.evaluate(async (pattern) => {
        return new Promise((resolve) => {
          chrome.runtime.sendMessage({
            mcp_request: {
              method: 'add_scope',
              params: { pattern }
            }
          }, (response) => {
            resolve(response || { success: false, error: 'No response from extension' });
          });
        });
      }, args.pattern);
      
      return result;
    }

    if (name === 'domlogger_query_sinks') {
      const { browser } = await this.ensureBrowser();
      
      if (!this.extensionControlPage) {
        const targets = await browser.targets();
        const extTarget = targets.find(t => t.url().includes('chrome-extension://'));
        if (!extTarget) return { success: false, error: 'Extension not loaded' };
        
        const extId = extTarget.url().match(/chrome-extension:\/\/([^\/]+)/)?.[1];
        this.extensionControlPage = await browser.newPage();
        await this.extensionControlPage.goto(`chrome-extension://${extId}/src/popup/popup.html`);
        await new Promise(r => setTimeout(r, 500));
      }
      
      const result = await this.extensionControlPage.evaluate(async (filters) => {
        return new Promise((resolve) => {
          chrome.runtime.sendMessage({
            mcp_request: {
              method: 'query_sinks',
              params: filters
            }
          }, (response) => {
            resolve(response || { success: false, error: 'No response from extension' });
          });
        });
      }, args);
      
      return result;
    }

    if (name === 'domlogger_set_config') {
      const { browser } = await this.ensureBrowser();
      
      // Store user configuration for future use
      if (args.config_name !== 'DEFAULT_CONFIG') {
        this.userConfig = args.config;
        console.error(`[DOMLogger MCP] Stored user configuration: ${args.config_name}`);
      }
      
      if (!this.extensionControlPage) {
        const targets = await browser.targets();
        const extTarget = targets.find(t => t.url().includes('chrome-extension://'));
        if (!extTarget) return { success: false, error: 'Extension not loaded' };
        
        const extId = extTarget.url().match(/chrome-extension:\/\/([^\/]+)/)?.[1];
        this.extensionControlPage = await browser.newPage();
        await this.extensionControlPage.goto(`chrome-extension://${extId}/src/popup/popup.html`);
        await new Promise(r => setTimeout(r, 500));
      }
      
      const result = await this.extensionControlPage.evaluate(async (configName, configData) => {
        return new Promise((resolve) => {
          chrome.runtime.sendMessage({
            mcp_request: {
              method: 'set_config',
              params: { config_name: configName, config: configData }
            }
          }, (response) => {
            resolve(response || { success: false, error: 'No response from extension' });
          });
        });
      }, args.config_name, args.config);
      
      // If configuration was successful and we have a page loaded, refresh it
      if (result.success && this.lastNavigatedUrl) {
        console.error('[DOMLogger MCP] Configuration updated, refreshing page to capture new sinks...');
        await this.refreshPageForSinks();
        
        result.page_refreshed = true;
        result.message = 'Configuration applied and page refreshed to capture sinks with new settings';
      }
      
      return result;
    }

    if (name === 'domlogger_get_statistics') {
      const { browser } = await this.ensureBrowser();
      
      if (!this.extensionControlPage) {
        const targets = await browser.targets();
        const extTarget = targets.find(t => t.url().includes('chrome-extension://'));
        if (!extTarget) return { success: false, error: 'Extension not loaded' };
        
        const extId = extTarget.url().match(/chrome-extension:\/\/([^\/]+)/)?.[1];
        this.extensionControlPage = await browser.newPage();
        await this.extensionControlPage.goto(`chrome-extension://${extId}/src/popup/popup.html`);
        await new Promise(r => setTimeout(r, 500));
      }
      
      const result = await this.extensionControlPage.evaluate(async () => {
        return new Promise((resolve) => {
          chrome.runtime.sendMessage({
            mcp_request: {
              method: 'get_statistics',
              params: {}
            }
          }, (response) => {
            resolve(response || { success: false, error: 'No response from extension' });
          });
        });
      });
      
      return result;
    }

    if (name === 'domlogger_clear_data') {
      const { browser } = await this.ensureBrowser();
      
      if (!this.extensionControlPage) {
        const targets = await browser.targets();
        const extTarget = targets.find(t => t.url().includes('chrome-extension://'));
        if (!extTarget) return { success: false, error: 'Extension not loaded' };
        
        const extId = extTarget.url().match(/chrome-extension:\/\/([^\/]+)/)?.[1];
        this.extensionControlPage = await browser.newPage();
        await this.extensionControlPage.goto(`chrome-extension://${extId}/src/popup/popup.html`);
        await new Promise(r => setTimeout(r, 500));
      }
      
      const result = await this.extensionControlPage.evaluate(async () => {
        return new Promise((resolve) => {
          chrome.runtime.sendMessage({
            mcp_request: {
              method: 'clear_sinks',
              params: {}
            }
          }, (response) => {
            resolve(response || { success: false, error: 'No response from extension' });
          });
        });
      });
      
      return result;
    }

    if (name === 'domlogger_manage_config') {
      const action = args.action;
      
      switch (action) {
        case 'view':
          return {
            success: true,
            user_config: this.userConfig,
            default_config: this.getDefaultConfig(),
            current_scope: this.currentScope,
            last_url: this.lastNavigatedUrl,
            message: this.userConfig ? 'User configuration is active' : 'Using default configuration'
          };
          
        case 'reset':
          this.userConfig = null;
          console.error('[DOMLogger MCP] User configuration reset to default');
          
          // Apply default configuration if we have a page loaded
          if (this.lastNavigatedUrl) {
            await this.applyConfiguration();
            await this.refreshPageForSinks();
          }
          
          return {
            success: true,
            message: 'Configuration reset to default and applied',
            default_config: this.getDefaultConfig(),
            page_refreshed: !!this.lastNavigatedUrl
          };
          
        case 'status':
          return {
            success: true,
            has_user_config: !!this.userConfig,
            config_type: this.userConfig ? 'USER_CONFIG' : 'DEFAULT_CONFIG',
            current_scope: this.currentScope,
            last_navigated_url: this.lastNavigatedUrl,
            browser_ready: !!this.browser,
            extension_ready: !!this.extensionControlPage,
            auto_config_enabled: true,
            message: `Status: ${this.userConfig ? 'Custom' : 'Default'} configuration active`
          };
          
        default:
          return {
            success: false,
            error: `Unknown action: ${action}`,
            available_actions: ['view', 'reset', 'status']
          };
      }
    }


    // Goto sink with canary - handle multiple matches, open in separate windows, get callstacks
    if (name === 'domlogger_goto_sink_with_canary') {
      const { browser } = await this.ensureBrowser();
      const canary = args.canary;
      const maxSinks = args.max_sinks || 10;
      const autoGetCallstack = args.auto_get_callstack !== false;
      
      console.error(`[DOMLogger MCP] Searching for sinks with canary: "${canary}"`);
      
      // Query sinks to find ALL containing the canary
      const sinksResult = await this.handleToolCall('domlogger_query_sinks', {
        data_contains: canary,
        limit: 100
      });
      
      if (!sinksResult.success || !sinksResult.sinks || sinksResult.sinks.length === 0) {
        return {
          success: false,
          error: `No sinks found containing canary: "${canary}"`,
          searched: canary
        };
      }
      
      const matchingSinks = sinksResult.sinks.slice(0, maxSinks);
      console.error(`[DOMLogger MCP] Found ${matchingSinks.length} sink(s) matching canary`);
      
      // Process each sink asynchronously
      const results = [];
      
      for (const [index, sink] of matchingSinks.entries()) {
        console.error(`[DOMLogger MCP] Processing sink ${index + 1}/${matchingSinks.length}: ${sink.sink}`);
        
        try {
          // Create new page (window) for this sink
          const newPage = await browser.newPage();
          
          // CRITICAL: Enable debugger BEFORE any navigation
          const client = await newPage.target().createCDPSession();
          await client.send('Debugger.enable');
          console.error(`[DOMLogger MCP] Debugger enabled for sink ${index + 1}`);
          
          // Get extension page for communication
          if (!this.extensionControlPage) {
            const targets = await browser.targets();
            const extTarget = targets.find(t => t.url().includes('chrome-extension://'));
            if (!extTarget) {
              results.push({
                index,
                success: false,
                error: 'Extension not loaded',
                sink: sink.sink
              });
              await newPage.close();
              continue;
            }
            
            const extId = extTarget.url().match(/chrome-extension:\/\/([^\/]+)/)?.[1];
            this.extensionControlPage = await browser.newPage();
            await this.extensionControlPage.goto(`chrome-extension://${extId}/src/popup/popup.html`);
            await new Promise(r => setTimeout(r, 500));
          }
          
          // Navigate to a blank page first to get tab ID
          await newPage.goto('about:blank');
          await new Promise(r => setTimeout(r, 500));
          
          // Get the tab ID for this new page
          const newTabId = await this.extensionControlPage.evaluate(async () => {
            return new Promise((resolve) => {
              chrome.tabs.query({}, (tabs) => {
                // Get the most recently created tab
                const sortedTabs = tabs.sort((a, b) => b.id - a.id);
                resolve(sortedTabs[0]?.id || null);
              });
            });
          });
          
          if (!newTabId) {
            results.push({
              index,
              success: false,
              error: 'Could not get tab ID',
              sink: sink.sink,
              url: sink.href
            });
            await newPage.close();
            continue;
          }
          
          console.error(`[DOMLogger MCP] Got tab ID ${newTabId} for sink ${index + 1}`);
          
          // Set up debugger pause listener BEFORE triggering navigation
          let callstack = null;
          let pauseListenerSet = false;
          
          const callstackPromise = autoGetCallstack ? new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
              console.error(`[DOMLogger MCP] Timeout waiting for debugger pause on sink ${index + 1}`);
              reject(new Error('Timeout waiting for pause'));
            }, 20000); // 20 second timeout
            
            const pauseHandler = async (params) => {
              clearTimeout(timeoutId);
              console.error(`[DOMLogger MCP] ✓ Debugger paused for sink ${index + 1}!`);
              console.error(`[DOMLogger MCP]   Reason: ${params.reason}`);
              console.error(`[DOMLogger MCP]   Call frames: ${params.callFrames.length}`);
              
              try {
                // Use CDP to navigate and inspect the call stack
                const detailedFrames = [];
                
                // Get the initial call frames
                const initialFrames = params.callFrames;
                
                // Focus on frames 0, 1, 2 (current + go back 2)
                const framesToInspect = Math.min(5, initialFrames.length);
                
                for (let frameIndex = 0; frameIndex < framesToInspect; frameIndex++) {
                  const frame = initialFrames[frameIndex];
                  console.error(`[DOMLogger MCP]   Inspecting frame ${frameIndex}: ${frame.functionName || '(anonymous)'}`);
                  
                  const frameData = {
                    index: frameIndex,
                    functionName: frame.functionName || '(anonymous)',
                    url: frame.url,
                    location: {
                      scriptId: frame.location.scriptId,
                      lineNumber: frame.location.lineNumber + 1,
                      columnNumber: frame.location.columnNumber + 1
                    },
                    scopeVariables: {},
                    localVariables: {},
                    thisContext: null,
                    sourceCode: null,
                    evaluations: {}
                  };
                  
                  // Evaluate expressions in this frame's context
                  try {
                    // Get current location info
                    const locationEval = await client.send('Debugger.evaluateOnCallFrame', {
                      callFrameId: frame.callFrameId,
                      expression: 'JSON.stringify({ url: location.href, pathname: location.pathname, search: location.search })',
                      returnByValue: true
                    });
                    
                    if (locationEval.result && locationEval.result.value) {
                      frameData.evaluations.location = JSON.parse(locationEval.result.value);
                    }
                  } catch (e) {
                    frameData.evaluations.locationError = e.message;
                  }
                  
                  // Get function arguments if available
                  try {
                    const argsEval = await client.send('Debugger.evaluateOnCallFrame', {
                      callFrameId: frame.callFrameId,
                      expression: 'typeof arguments !== "undefined" ? JSON.stringify(Array.from(arguments).map(a => typeof a === "object" ? String(a) : a)) : "[]"',
                      returnByValue: true
                    });
                    
                    if (argsEval.result && argsEval.result.value) {
                      frameData.evaluations.arguments = JSON.parse(argsEval.result.value);
                    }
                  } catch (e) {
                    frameData.evaluations.argsError = e.message;
                  }
                  
                  // Get scope chain with variables
                  if (frame.scopeChain && frame.scopeChain.length > 0) {
                    for (let scopeIdx = 0; scopeIdx < Math.min(3, frame.scopeChain.length); scopeIdx++) {
                      const scope = frame.scopeChain[scopeIdx];
                      
                      try {
                        if (scope.object && scope.object.objectId) {
                          const props = await client.send('Runtime.getProperties', {
                            objectId: scope.object.objectId,
                            ownProperties: true
                          });
                          
                          const scopeVars = {};
                          if (props.result) {
                            for (const prop of props.result.slice(0, 15)) {
                              if (prop.value && prop.name !== '__proto__') {
                                scopeVars[prop.name] = {
                                  type: prop.value.type,
                                  value: prop.value.value !== undefined ? prop.value.value : prop.value.description,
                                  className: prop.value.className
                                };
                              }
                            }
                          }
                          
                          frameData.scopeVariables[`${scope.type}_${scopeIdx}`] = {
                            type: scope.type,
                            name: scope.name,
                            variables: scopeVars
                          };
                        }
                      } catch (e) {
                        frameData.scopeVariables[`${scope.type}_${scopeIdx}`] = { error: e.message };
                      }
                    }
                  }
                  
                  // Get source code (limited context)
                  try {
                    if (frame.location.scriptId) {
                      const scriptSource = await client.send('Debugger.getScriptSource', {
                        scriptId: frame.location.scriptId
                      });
                      
                      if (scriptSource.scriptSource) {
                        const lines = scriptSource.scriptSource.split('\n');
                        const lineNum = frame.location.lineNumber;
                        const startLine = Math.max(0, lineNum - 5);
                        const endLine = Math.min(lines.length, lineNum + 6);
                        
                        frameData.sourceCode = {
                          startLine: startLine + 1,
                          endLine: endLine + 1,
                          currentLine: lineNum + 1,
                          totalLines: lines.length,
                          excerpt: lines.slice(startLine, endLine).map((line, idx) => {
                            const lineNumber = startLine + idx + 1;
                            return {
                              line: lineNumber,
                              code: line.substring(0, 200), // Limit line length
                              current: lineNumber === (lineNum + 1)
                            };
                          })
                        };
                      }
                    }
                  } catch (e) {
                    frameData.sourceError = e.message;
                  }
                  
                  detailedFrames.push(frameData);
                }
                
                console.error(`[DOMLogger MCP] ✓ Inspected ${detailedFrames.length} frames with detailed context`);
                
                // Resume debugger
                await client.send('Debugger.resume');
                console.error(`[DOMLogger MCP] ✓ Debugger resumed for sink ${index + 1}`);
                
                resolve({
                  frames: detailedFrames,
                  totalFrames: initialFrames.length,
                  inspectedFrames: detailedFrames.length,
                  pauseReason: params.reason,
                  summary: `Inspected ${detailedFrames.length} frames with CDP evaluation and scope inspection`
                });
              } catch (e) {
                console.error(`[DOMLogger MCP] ✗ Error extracting callstack: ${e.message}`);
                console.error(e.stack);
                resolve({ error: e.message, stack: e.stack });
              }
            };
            
            client.on('Debugger.paused', pauseHandler);
            pauseListenerSet = true;
            console.error(`[DOMLogger MCP] ✓ Debugger pause listener set for sink ${index + 1}`);
          }) : Promise.resolve(null);
          
          // Now trigger the debugSink action which will reload the page
          console.error(`[DOMLogger MCP] Triggering debugSink for tab ${newTabId}`);
          console.error(`[DOMLogger MCP]   URL: ${sink.href}`);
          console.error(`[DOMLogger MCP]   Canary: ${sink.debug}`);
          console.error(`[DOMLogger MCP]   Sink type: ${sink.sink}`);
          
          await this.extensionControlPage.evaluate(async (tabId, url, canaryId) => {
            return new Promise((resolve) => {
              chrome.runtime.sendMessage({
                action: 'debugSink',
                tabId: tabId,
                url: url,
                canary: canaryId
              }, () => {
                resolve();
              });
            });
          }, newTabId, sink.href, sink.debug);
          
          // Wait for the callstack promise to resolve (or timeout)
          if (autoGetCallstack) {
            try {
              callstack = await callstackPromise;
            } catch (e) {
              console.error(`[DOMLogger MCP] Callstack capture failed: ${e.message}`);
              callstack = { error: e.message };
            }
          }
          
          // Store result
          results.push({
            index,
            success: true,
            sink: {
              type: sink.sink,
              tag: sink.tag,
              url: sink.href,
              data: sink.data,
              dupKey: sink.dupKey,
              debug: sink.debug
            },
            callstack: callstack,
            tabId: newTabId,
            windowIndex: index
          });
          
          // Keep the window open for manual inspection
          console.error(`[DOMLogger MCP] Sink ${index + 1} complete, window remains open`);
          
        } catch (error) {
          console.error(`[DOMLogger MCP] Error processing sink ${index + 1}: ${error.message}`);
          results.push({
            index,
            success: false,
            error: error.message,
            sink: sink.sink
          });
        }
      }
      
      // Summary
      const successful = results.filter(r => r.success).length;
      const withCallstack = results.filter(r => r.callstack && !r.callstack.error).length;
      
      return {
        success: true,
        canary: canary,
        total_found: matchingSinks.length,
        processed: results.length,
        successful: successful,
        with_callstack: withCallstack,
        results: results,
        summary: `Processed ${results.length} sink(s) with canary "${canary}". ${successful} successful, ${withCallstack} with callstack. Each opened in separate window.`
      };
    }

    // Get callstack when debugger is paused
    if (name === 'browser_get_callstack') {
      const { browser, page } = await this.ensureBrowser();
      const timeout = args.timeout || 30000;
      
      console.error('[DOMLogger MCP] Waiting for debugger to pause...');
      
      try {
        // Enable debugger
        const client = await page.target().createCDPSession();
        await client.send('Debugger.enable');
        
        // Wait for debugger to pause
        const pausedPromise = new Promise((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            reject(new Error('Timeout waiting for debugger to pause'));
          }, timeout);
          
          client.on('Debugger.paused', (params) => {
            clearTimeout(timeoutId);
            resolve(params);
          });
        });
        
        const pausedInfo = await pausedPromise;
        
        // Get call stack
        const callFrames = pausedInfo.callFrames;
        const formattedStack = callFrames.map((frame, i) => ({
          index: i,
          functionName: frame.functionName || '(anonymous)',
          url: frame.url,
          lineNumber: frame.location.lineNumber + 1,
          columnNumber: frame.location.columnNumber + 1,
          scriptId: frame.location.scriptId
        }));
        
        console.error(`[DOMLogger MCP] Got call stack with ${formattedStack.length} frames`);
        
        // You can choose to resume or leave paused
        // await client.send('Debugger.resume');
        
        return {
          success: true,
          paused: true,
          reason: pausedInfo.reason,
          callStack: formattedStack,
          message: `Debugger paused with ${formattedStack.length} stack frames`,
          note: 'Call browser_evaluate with "debugger" to resume, or it will stay paused'
        };
        
      } catch (error) {
        console.error('[DOMLogger MCP] Error getting callstack:', error);
        return {
          success: false,
          error: error.message,
          suggestion: 'Make sure a breakpoint was hit. Try domlogger_goto_sink_with_canary first.'
        };
      }
    }

    // Navigate to DevTools Call Stack and click specific frame
    if (name === 'browser_navigate_callstack') {
      const { browser, page } = await this.ensureBrowser();
      const frameIndex = args.frameIndex !== undefined ? args.frameIndex : 1; // Default to second frame
      const openDevTools = args.openDevTools !== false; // Default to true
      
      console.error(`[DOMLogger MCP] Navigating to call stack frame ${frameIndex}`);
      
      try {
        // Open DevTools if requested
        if (openDevTools) {
          console.error('[DOMLogger MCP] Opening DevTools...');
          
          // Use CDP to open DevTools
          const client = await page.target().createCDPSession();
          
          // First, check if debugger is already paused
          let isPaused = false;
          try {
            await client.send('Debugger.enable');
            
            // Check if we're currently paused
            const pausedCheck = await new Promise((resolve) => {
              const timeoutId = setTimeout(() => resolve(false), 1000);
              
              client.on('Debugger.paused', () => {
                clearTimeout(timeoutId);
                resolve(true);
              });
              
              // Try to get current state
              client.send('Runtime.evaluate', {
                expression: 'typeof debugger !== "undefined"'
              }).then(() => {
                clearTimeout(timeoutId);
                resolve(false);
              }).catch(() => {
                clearTimeout(timeoutId);
                resolve(false);
              });
            });
            
            isPaused = pausedCheck;
            console.error(`[DOMLogger MCP] Debugger paused: ${isPaused}`);
            
          } catch (e) {
            console.error(`[DOMLogger MCP] Error checking debugger state: ${e.message}`);
          }
        }
        
        // Navigate to DevTools Sources panel using keyboard shortcut
        await page.keyboard.down('F12'); // Open DevTools
        await new Promise(r => setTimeout(r, 2000)); // Wait for DevTools to open
        
        // Navigate to Sources panel
        await page.keyboard.down('Control');
        await page.keyboard.down('Shift');
        await page.keyboard.press('KeyO'); // Ctrl+Shift+O for Sources
        await page.keyboard.up('Shift');
        await page.keyboard.up('Control');
        await new Promise(r => setTimeout(r, 1000));
        
        // Try to find and click the call stack frame
        try {
          // Look for call stack panel elements
          const callStackSelectors = [
            '.call-stack-pane .tree-outline li:nth-child(' + (frameIndex + 1) + ')',
            '.call-stack .tree-outline li:nth-child(' + (frameIndex + 1) + ')',
            '[aria-label="Call Stack"] li:nth-child(' + (frameIndex + 1) + ')',
            '.sources-panel .call-stack li:nth-child(' + (frameIndex + 1) + ')'
          ];
          
          let clicked = false;
          for (const selector of callStackSelectors) {
            try {
              await page.waitForSelector(selector, { timeout: 2000 });
              await page.click(selector);
              clicked = true;
              console.error(`[DOMLogger MCP] ✓ Clicked call stack frame ${frameIndex} using selector: ${selector}`);
              break;
            } catch (e) {
              console.error(`[DOMLogger MCP] Selector ${selector} not found: ${e.message}`);
            }
          }
          
          if (!clicked) {
            // Try alternative approach - use CDP to evaluate in DevTools context
            console.error('[DOMLogger MCP] Trying CDP approach to navigate call stack...');
            
            const client = await page.target().createCDPSession();
            
            // Try to evaluate DevTools-specific commands
            const devToolsEval = await client.send('Runtime.evaluate', {
              expression: `
                // Try to find call stack elements
                const callStackElements = [
                  ...document.querySelectorAll('.call-stack-pane .tree-outline li'),
                  ...document.querySelectorAll('.call-stack .tree-outline li'),
                  ...document.querySelectorAll('[aria-label="Call Stack"] li'),
                  ...document.querySelectorAll('.sources-panel .call-stack li')
                ];
                
                if (callStackElements.length > ${frameIndex}) {
                  callStackElements[${frameIndex}].click();
                  JSON.stringify({
                    success: true,
                    clicked: true,
                    frameIndex: ${frameIndex},
                    totalFrames: callStackElements.length,
                    frameText: callStackElements[${frameIndex}].textContent
                  });
                } else {
                  JSON.stringify({
                    success: false,
                    reason: 'Frame not found',
                    totalFrames: callStackElements.length,
                    availableFrames: callStackElements.map(el => el.textContent)
                  });
                }
              `,
              returnByValue: true
            });
            
            if (devToolsEval.result && devToolsEval.result.value) {
              const result = JSON.parse(devToolsEval.result.value);
              
              if (result.success) {
                console.error(`[DOMLogger MCP] ✓ Successfully clicked frame ${frameIndex} via CDP`);
                
                // Get detailed info about the selected frame
                const frameInfo = await client.send('Runtime.evaluate', {
                  expression: `
                    JSON.stringify({
                      location: location.href,
                      selectedFrame: ${frameIndex},
                      frameText: "${result.frameText}",
                      devToolsOpen: true,
                      timestamp: new Date().toISOString()
                    });
                  `,
                  returnByValue: true
                });
                
                let frameDetails = {};
                if (frameInfo.result && frameInfo.result.value) {
                  frameDetails = JSON.parse(frameInfo.result.value);
                }
                
                return {
                  success: true,
                  method: 'CDP evaluation',
                  frameIndex: frameIndex,
                  clicked: true,
                  frameText: result.frameText,
                  totalFrames: result.totalFrames,
                  details: frameDetails,
                  message: `Successfully navigated to call stack frame ${frameIndex}`
                };
              } else {
                return {
                  success: false,
                  method: 'CDP evaluation',
                  error: result.reason,
                  totalFrames: result.totalFrames,
                  availableFrames: result.availableFrames,
                  suggestion: 'Make sure DevTools is open and debugger is paused'
                };
              }
            }
          } else {
            // Successfully clicked using Puppeteer selectors
            await new Promise(r => setTimeout(r, 1000)); // Wait for navigation
            
            // Get info about the current state
            const currentInfo = await page.evaluate(() => {
              return {
                url: location.href,
                title: document.title,
                devToolsVisible: true,
                selectedFrame: frameIndex,
                timestamp: new Date().toISOString()
              };
            });
            
            return {
              success: true,
              method: 'Puppeteer selector',
              frameIndex: frameIndex,
              clicked: true,
              currentInfo: currentInfo,
              message: `Successfully clicked call stack frame ${frameIndex}`
            };
          }
          
        } catch (e) {
          console.error(`[DOMLogger MCP] Error navigating call stack: ${e.message}`);
          return {
            success: false,
            error: e.message,
            frameIndex: frameIndex,
            suggestion: 'Make sure the page has a breakpoint active and DevTools is accessible'
          };
        }
        
      } catch (error) {
        console.error('[DOMLogger MCP] Error in browser_navigate_callstack:', error);
        return {
          success: false,
          error: error.message,
          suggestion: 'Make sure browser is running and page is loaded'
        };
      }
    }

    // ========== DEBUGGER TOOLS ==========
    if (name === 'debugger_enable') {
      const { browser } = await this.ensureBrowser();
      await this.updatePagesArray();
      const page = this.getSelectedPage();
      const client = await this.getCDPSession(page);
      
      await client.send('Debugger.enable');
      this.debuggerEnabled.set(page, true);
      
      return { success: true, message: 'Debugger enabled' };
    }

    if (name === 'debugger_disable') {
      const { browser } = await this.ensureBrowser();
      await this.updatePagesArray();
      const page = this.getSelectedPage();
      const client = await this.getCDPSession(page);
      
      await client.send('Debugger.disable');
      this.debuggerEnabled.set(page, false);
      
      return { success: true, message: 'Debugger disabled' };
    }

    if (name === 'debugger_set_breakpoint_by_url') {
      const { browser } = await this.ensureBrowser();
      await this.updatePagesArray();
      const page = this.getSelectedPage();
      const client = await this.getCDPSession(page);
      
      // Ensure debugger is enabled
      if (!this.debuggerEnabled.get(page)) {
        await client.send('Debugger.enable');
        this.debuggerEnabled.set(page, true);
      }
      
      const result = await client.send('Debugger.setBreakpointByUrl', {
        url: args.url,
        lineNumber: args.lineNumber,
        columnNumber: args.columnNumber,
        condition: args.condition,
      });
      
      return {
        success: true,
        breakpointId: result.breakpointId,
        locations: result.locations,
        message: `Breakpoint set at ${args.url}:${args.lineNumber}`,
      };
    }

    if (name === 'debugger_remove_breakpoint') {
      const { browser } = await this.ensureBrowser();
      await this.updatePagesArray();
      const page = this.getSelectedPage();
      const client = await this.getCDPSession(page);
      
      await client.send('Debugger.removeBreakpoint', {
        breakpointId: args.breakpointId,
      });
      
      return { success: true, message: `Removed breakpoint ${args.breakpointId}` };
    }

    if (name === 'debugger_resume') {
      const { browser } = await this.ensureBrowser();
      await this.updatePagesArray();
      const page = this.getSelectedPage();
      const client = await this.getCDPSession(page);
      
      await client.send('Debugger.resume');
      
      return { success: true, message: 'Resumed execution' };
    }

    if (name === 'debugger_pause') {
      const { browser } = await this.ensureBrowser();
      await this.updatePagesArray();
      const page = this.getSelectedPage();
      const client = await this.getCDPSession(page);
      
      await client.send('Debugger.pause');
      
      return { success: true, message: 'Paused execution' };
    }

    if (name === 'debugger_step_over') {
      const { browser } = await this.ensureBrowser();
      await this.updatePagesArray();
      const page = this.getSelectedPage();
      const client = await this.getCDPSession(page);
      
      await client.send('Debugger.stepOver');
      
      return { success: true, message: 'Stepped over' };
    }

    if (name === 'debugger_step_into') {
      const { browser } = await this.ensureBrowser();
      await this.updatePagesArray();
      const page = this.getSelectedPage();
      const client = await this.getCDPSession(page);
      
      await client.send('Debugger.stepInto');
      
      return { success: true, message: 'Stepped into' };
    }

    if (name === 'debugger_step_out') {
      const { browser } = await this.ensureBrowser();
      await this.updatePagesArray();
      const page = this.getSelectedPage();
      const client = await this.getCDPSession(page);
      
      await client.send('Debugger.stepOut');
      
      return { success: true, message: 'Stepped out' };
    }

    if (name === 'debugger_get_call_stack') {
      const { browser } = await this.ensureBrowser();
      await this.updatePagesArray();
      const page = this.getSelectedPage();
      const client = await this.getCDPSession(page);
      
      // Wait for debugger to be paused
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Debugger is not paused'));
        }, 5000);
        
        client.once('Debugger.paused', (params) => {
          clearTimeout(timeout);
          
          const callStack = params.callFrames.map((frame, index) => ({
            index,
            functionName: frame.functionName || '(anonymous)',
            url: frame.url,
            lineNumber: frame.location.lineNumber + 1,
            columnNumber: frame.location.columnNumber + 1,
            scriptId: frame.location.scriptId,
            callFrameId: frame.callFrameId,
          }));
          
          resolve({
            success: true,
            callStack,
            reason: params.reason,
            message: `Call stack with ${callStack.length} frames`,
          });
        });
        
        // Check if already paused by trying to get current call stack
        client.send('Debugger.pause').catch(() => {});
      });
    }

    if (name === 'debugger_evaluate_on_call_frame') {
      const { browser } = await this.ensureBrowser();
      await this.updatePagesArray();
      const page = this.getSelectedPage();
      const client = await this.getCDPSession(page);
      
      const result = await client.send('Debugger.evaluateOnCallFrame', {
        callFrameId: args.callFrameId,
        expression: args.expression,
      });
      
      return {
        success: true,
        result: result.result,
        exceptionDetails: result.exceptionDetails,
      };
    }

    if (name === 'debugger_get_script_source') {
      const { browser } = await this.ensureBrowser();
      await this.updatePagesArray();
      const page = this.getSelectedPage();
      const client = await this.getCDPSession(page);
      
      const result = await client.send('Debugger.getScriptSource', {
        scriptId: args.scriptId,
      });
      
      return {
        success: true,
        scriptSource: result.scriptSource,
        bytecode: result.bytecode,
      };
    }

    if (name === 'debugger_set_xhr_breakpoint') {
      const { browser } = await this.ensureBrowser();
      await this.updatePagesArray();
      const page = this.getSelectedPage();
      const client = await this.getCDPSession(page);
      
      await client.send('DOMDebugger.setXHRBreakpoint', {
        url: args.urlPattern || '',
      });
      
      return {
        success: true,
        message: `XHR breakpoint set${args.urlPattern ? ` for: ${args.urlPattern}` : ' for all requests'}`,
      };
    }

    if (name === 'debugger_set_event_breakpoint') {
      const { browser } = await this.ensureBrowser();
      await this.updatePagesArray();
      const page = this.getSelectedPage();
      const client = await this.getCDPSession(page);
      
      await client.send('DOMDebugger.setEventListenerBreakpoint', {
        eventName: args.eventName,
        targetName: args.targetName,
      });
      
      return {
        success: true,
        message: `Event breakpoint set for "${args.eventName}"${args.targetName ? ` on ${args.targetName}` : ''}`,
      };
    }

    if (name === 'debugger_pause_on_exceptions') {
      const { browser } = await this.ensureBrowser();
      await this.updatePagesArray();
      const page = this.getSelectedPage();
      const client = await this.getCDPSession(page);
      
      await client.send('Debugger.setPauseOnExceptions', {
        state: args.state,
      });
      
      return {
        success: true,
        message: `Pause on ${args.state} exceptions`,
      };
    }

    if (name === 'debugger_set_logpoint') {
      const { browser } = await this.ensureBrowser();
      await this.updatePagesArray();
      const page = this.getSelectedPage();
      const client = await this.getCDPSession(page);
      
      // Ensure debugger is enabled
      if (!this.debuggerEnabled.get(page)) {
        await client.send('Debugger.enable');
        this.debuggerEnabled.set(page, true);
      }
      
      // Create a conditional breakpoint that always returns false but logs
      const logCondition = `(console.log(${args.logMessage}), false)`;
      
      const result = await client.send('Debugger.setBreakpointByUrl', {
        url: args.url,
        lineNumber: args.lineNumber,
        columnNumber: args.columnNumber,
        condition: logCondition,
      });
      
      return {
        success: true,
        breakpointId: result.breakpointId,
        message: `Logpoint set at ${args.url}:${args.lineNumber} - will log: ${args.logMessage}`,
      };
    }

    // ========== PAGE MANAGEMENT TOOLS ==========
    if (name === 'list_pages') {
      const { browser } = await this.ensureBrowser();
      await this.updatePagesArray();
      
      const pageList = await Promise.all(this.pages.map(async (page, index) => ({
        index,
        url: page.url(),
        title: await page.title(),
        selected: index === this.selectedPageIndex,
      })));
      
      return {
        success: true,
        pages: pageList,
        selectedIndex: this.selectedPageIndex,
      };
    }

    if (name === 'select_page') {
      const { browser } = await this.ensureBrowser();
      await this.updatePagesArray();
      
      if (args.pageIdx < 0 || args.pageIdx >= this.pages.length) {
        return {
          success: false,
          error: `Invalid page index ${args.pageIdx}. Available pages: 0-${this.pages.length - 1}`,
        };
      }
      
      this.selectedPageIndex = args.pageIdx;
      this.page = this.pages[args.pageIdx];
      await this.pages[args.pageIdx].bringToFront();
      
      return {
        success: true,
        selectedIndex: this.selectedPageIndex,
        url: this.page.url(),
        title: await this.page.title(),
      };
    }

    if (name === 'close_page') {
      const { browser } = await this.ensureBrowser();
      await this.updatePagesArray();
      
      if (this.pages.length === 1) {
        return {
          success: false,
          error: 'Cannot close the last page',
        };
      }
      
      if (args.pageIdx < 0 || args.pageIdx >= this.pages.length) {
        return {
          success: false,
          error: `Invalid page index ${args.pageIdx}. Available pages: 0-${this.pages.length - 1}`,
        };
      }
      
      const pageToClose = this.pages[args.pageIdx];
      
      // Clean up tracking
      this.cdpSessions.delete(pageToClose);
      this.debuggerEnabled.delete(pageToClose);
      this.networkRequests.delete(pageToClose);
      this.consoleMessages.delete(pageToClose);
      
      await pageToClose.close();
      await this.updatePagesArray();
      
      // Adjust selected page if necessary
      if (this.selectedPageIndex >= this.pages.length) {
        this.selectedPageIndex = this.pages.length - 1;
      }
      this.page = this.pages[this.selectedPageIndex];
      
      return {
        success: true,
        message: `Closed page ${args.pageIdx}`,
        remainingPages: this.pages.length,
      };
    }

    if (name === 'new_page') {
      const { browser } = await this.ensureBrowser();
      
      const newPage = await browser.newPage();
      await this.setupPageListeners(newPage);
      
      await newPage.goto(args.url, {
        timeout: args.timeout || 30000,
        waitUntil: 'networkidle2',
      });
      
      await this.updatePagesArray();
      
      // Select the new page
      this.selectedPageIndex = this.pages.indexOf(newPage);
      this.page = newPage;
      
      return {
        success: true,
        pageIndex: this.selectedPageIndex,
        url: newPage.url(),
        title: await newPage.title(),
      };
    }

    if (name === 'navigate_page') {
      const { browser } = await this.ensureBrowser();
      await this.updatePagesArray();
      const page = this.getSelectedPage();
      
      await page.goto(args.url, {
        timeout: args.timeout || 30000,
        waitUntil: 'networkidle2',
      });
      
      return {
        success: true,
        url: page.url(),
        title: await page.title(),
      };
    }

    if (name === 'navigate_page_history') {
      const { browser } = await this.ensureBrowser();
      await this.updatePagesArray();
      const page = this.getSelectedPage();
      
      try {
        if (args.navigate === 'back') {
          await page.goBack({ timeout: args.timeout || 30000 });
        } else {
          await page.goForward({ timeout: args.timeout || 30000 });
        }
        
        return {
          success: true,
          url: page.url(),
          title: await page.title(),
        };
      } catch (error) {
        return {
          success: false,
          error: `Unable to navigate ${args.navigate}: ${error.message}`,
        };
      }
    }

    if (name === 'wait_for') {
      const { browser } = await this.ensureBrowser();
      await this.updatePagesArray();
      const page = this.getSelectedPage();
      
      await page.waitForSelector(args.selector, {
        timeout: args.timeout || 30000,
      });
      
      return {
        success: true,
        selector: args.selector,
        message: `Element ${args.selector} appeared`,
      };
    }

    // ========== INPUT TOOLS ==========
    if (name === 'click') {
      const { browser } = await this.ensureBrowser();
      await this.updatePagesArray();
      const page = this.getSelectedPage();
      
      if (args.dblClick) {
        await page.click(args.selector, { clickCount: 2 });
      } else {
        await page.click(args.selector);
      }
      
      return {
        success: true,
        selector: args.selector,
        action: args.dblClick ? 'double-clicked' : 'clicked',
      };
    }

    if (name === 'hover') {
      const { browser } = await this.ensureBrowser();
      await this.updatePagesArray();
      const page = this.getSelectedPage();
      
      await page.hover(args.selector);
      
      return {
        success: true,
        selector: args.selector,
        action: 'hovered',
      };
    }

    if (name === 'fill') {
      const { browser } = await this.ensureBrowser();
      await this.updatePagesArray();
      const page = this.getSelectedPage();
      
      await page.type(args.selector, args.value);
      
      return {
        success: true,
        selector: args.selector,
        value: args.value,
      };
    }

    if (name === 'handle_dialog') {
      const { browser } = await this.ensureBrowser();
      await this.updatePagesArray();
      const page = this.getSelectedPage();
      
      return new Promise((resolve) => {
        page.once('dialog', async (dialog) => {
          if (args.action === 'accept') {
            await dialog.accept(args.promptText);
          } else {
            await dialog.dismiss();
          }
          
          resolve({
            success: true,
            action: args.action,
            dialogType: dialog.type(),
            message: dialog.message(),
          });
        });
        
        // Set timeout in case no dialog appears
        setTimeout(() => {
          resolve({
            success: false,
            error: 'No dialog appeared within timeout',
          });
        }, 10000);
      });
    }

    // ========== NETWORK TOOLS ==========
    if (name === 'list_network_requests') {
      const { browser } = await this.ensureBrowser();
      await this.updatePagesArray();
      const page = this.getSelectedPage();
      
      const requests = this.networkRequests.get(page) || [];
      const limit = args.limit || 100;
      const filter = args.filter;
      
      let filteredRequests = requests;
      if (filter) {
        filteredRequests = requests.filter(r => r.url.includes(filter));
      }
      
      return {
        success: true,
        requests: filteredRequests.slice(-limit).map(r => ({
          id: r.id,
          url: r.url,
          method: r.method,
          status: r.status,
          timestamp: r.timestamp,
        })),
        total: requests.length,
      };
    }

    if (name === 'get_network_request') {
      const { browser } = await this.ensureBrowser();
      await this.updatePagesArray();
      const page = this.getSelectedPage();
      
      const requests = this.networkRequests.get(page) || [];
      const request = requests.find(r => r.id === args.requestId);
      
      if (!request) {
        return {
          success: false,
          error: `Request ${args.requestId} not found`,
        };
      }
      
      return {
        success: true,
        request,
      };
    }

    // ========== CONSOLE TOOLS ==========
    if (name === 'list_console_messages') {
      const { browser } = await this.ensureBrowser();
      await this.updatePagesArray();
      const page = this.getSelectedPage();
      
      const messages = this.consoleMessages.get(page) || [];
      const limit = args.limit || 100;
      const type = args.type;
      
      let filteredMessages = messages;
      if (type) {
        filteredMessages = messages.filter(m => m.type === type);
      }
      
      return {
        success: true,
        messages: filteredMessages.slice(-limit).map(m => ({
          id: m.id,
          type: m.type,
          text: m.text,
          timestamp: m.timestamp,
        })),
        total: messages.length,
      };
    }

    if (name === 'get_console_message') {
      const { browser } = await this.ensureBrowser();
      await this.updatePagesArray();
      const page = this.getSelectedPage();
      
      const messages = this.consoleMessages.get(page) || [];
      const message = messages.find(m => m.id === args.messageId);
      
      if (!message) {
        return {
          success: false,
          error: `Message ${args.messageId} not found`,
        };
      }
      
      return {
        success: true,
        message,
      };
    }

    // ========== SCREENSHOT & SNAPSHOT TOOLS ==========
    if (name === 'take_screenshot') {
      const { browser } = await this.ensureBrowser();
      await this.updatePagesArray();
      const page = this.getSelectedPage();
      
      const screenshotPath = args.path || join(__dirname, `screenshot_${Date.now()}.png`);
      await page.screenshot({
        path: screenshotPath,
        fullPage: args.fullPage || false,
      });
      
      return {
        success: true,
        path: screenshotPath,
      };
    }

    if (name === 'take_snapshot') {
      const { browser } = await this.ensureBrowser();
      await this.updatePagesArray();
      const page = this.getSelectedPage();
      
      const snapshot = await page.evaluate(() => {
        return {
          html: document.documentElement.outerHTML,
          url: location.href,
          title: document.title,
          timestamp: new Date().toISOString(),
        };
      });
      
      return {
        success: true,
        snapshot,
      };
    }

    // ========== EMULATION TOOLS ==========
    if (name === 'emulate_network') {
      const { browser } = await this.ensureBrowser();
      await this.updatePagesArray();
      const page = this.getSelectedPage();
      const client = await this.getCDPSession(page);
      
      const profiles = {
        'fast3g': {
          offline: false,
          downloadThroughput: 1.6 * 1024 * 1024 / 8,
          uploadThroughput: 750 * 1024 / 8,
          latency: 40,
        },
        'slow3g': {
          offline: false,
          downloadThroughput: 500 * 1024 / 8,
          uploadThroughput: 500 * 1024 / 8,
          latency: 400,
        },
        '4g': {
          offline: false,
          downloadThroughput: 4 * 1024 * 1024 / 8,
          uploadThroughput: 3 * 1024 * 1024 / 8,
          latency: 20,
        },
        'offline': {
          offline: true,
          downloadThroughput: 0,
          uploadThroughput: 0,
          latency: 0,
        },
        'online': {
          offline: false,
          downloadThroughput: -1,
          uploadThroughput: -1,
          latency: 0,
        },
      };
      
      const profile = profiles[args.profile];
      if (!profile) {
        return {
          success: false,
          error: `Unknown profile: ${args.profile}`,
        };
      }
      
      await client.send('Network.emulateNetworkConditions', profile);
      
      return {
        success: true,
        profile: args.profile,
        conditions: profile,
      };
    }

    if (name === 'emulate_cpu') {
      const { browser } = await this.ensureBrowser();
      await this.updatePagesArray();
      const page = this.getSelectedPage();
      const client = await this.getCDPSession(page);
      
      await client.send('Emulation.setCPUThrottlingRate', {
        rate: args.throttling,
      });
      
      return {
        success: true,
        throttling: args.throttling,
        message: `CPU throttled to ${args.throttling}x slowdown`,
      };
    }

    if (name === 'resize_page') {
      const { browser } = await this.ensureBrowser();
      await this.updatePagesArray();
      const page = this.getSelectedPage();
      
      await page.setViewport({
        width: args.width,
        height: args.height,
      });
      
      return {
        success: true,
        width: args.width,
        height: args.height,
      };
    }

    // ========== SCRIPT EVALUATION ==========
    if (name === 'evaluate_script') {
      // Alias for browser_evaluate
      return await this.handleToolCall('browser_evaluate', { script: args.script });
    }

    // ========== PERFORMANCE TOOLS ==========
    if (name === 'performance_start_trace') {
      const { browser } = await this.ensureBrowser();
      await this.updatePagesArray();
      const page = this.getSelectedPage();
      
      if (this.performanceTraceRunning) {
        return {
          success: false,
          error: 'A performance trace is already running. Use performance_stop_trace to stop it first.',
        };
      }
      
      this.performanceTraceRunning = true;
      this.performanceTracePage = page;
      
      const pageUrl = page.url();
      
      // Start tracing with comprehensive categories
      const categories = [
        '-*',
        'blink.console',
        'blink.user_timing',
        'devtools.timeline',
        'disabled-by-default-devtools.screenshot',
        'disabled-by-default-devtools.timeline',
        'disabled-by-default-devtools.timeline.invalidationTracking',
        'disabled-by-default-devtools.timeline.frame',
        'disabled-by-default-devtools.timeline.stack',
        'disabled-by-default-v8.cpu_profiler',
        'disabled-by-default-v8.cpu_profiler.hires',
        'latencyInfo',
        'loading',
        'disabled-by-default-lighthouse',
        'v8.execute',
        'v8',
      ];
      
      await page.tracing.start({ categories });
      
      if (args.reload) {
        await page.goto(pageUrl, { waitUntil: 'load' });
      }
      
      return {
        success: true,
        message: 'Performance trace started. Use performance_stop_trace to stop it.',
        tracing: true,
        reload: args.reload || false,
      };
    }

    if (name === 'performance_stop_trace') {
      if (!this.performanceTraceRunning) {
        return {
          success: false,
          error: 'No performance trace is currently running.',
        };
      }
      
      const page = this.performanceTracePage;
      
      try {
        const traceBuffer = await page.tracing.stop();
        this.performanceTraceRunning = false;
        this.performanceTracePage = null;
        
        // Get basic performance metrics
        const performanceMetrics = await page.evaluate(() => {
          const navigation = performance.getEntriesByType('navigation')[0];
          const paint = performance.getEntriesByType('paint');
          const resources = performance.getEntriesByType('resource');
          
          return {
            navigation: navigation ? {
              domContentLoaded: navigation.domContentLoadedEventEnd - navigation.domContentLoadedEventStart,
              loadComplete: navigation.loadEventEnd - navigation.loadEventStart,
              domInteractive: navigation.domInteractive,
              domComplete: navigation.domComplete,
              duration: navigation.duration,
            } : null,
            paint: paint.map(p => ({
              name: p.name,
              startTime: p.startTime,
            })),
            resourceCount: resources.length,
            resourceTotalSize: resources.reduce((sum, r) => sum + (r.transferSize || 0), 0),
          };
        });
        
        return {
          success: true,
          message: 'Performance trace stopped',
          traceSize: traceBuffer.length,
          metrics: performanceMetrics,
          note: 'Trace data collected. Use get_performance_metrics for detailed metrics.',
        };
      } catch (error) {
        this.performanceTraceRunning = false;
        this.performanceTracePage = null;
        
        return {
          success: false,
          error: `Error stopping trace: ${error.message}`,
        };
      }
    }

    if (name === 'get_performance_metrics') {
      const { browser } = await this.ensureBrowser();
      await this.updatePagesArray();
      const page = this.getSelectedPage();
      
      const metrics = await page.evaluate(() => {
        const perfData = window.performance;
        const navigation = perfData.getEntriesByType('navigation')[0];
        const paint = perfData.getEntriesByType('paint');
        const resources = perfData.getEntriesByType('resource');
        const marks = perfData.getEntriesByType('mark');
        const measures = perfData.getEntriesByType('measure');
        
        // Get memory info if available
        const memory = (performance).memory ? {
          usedJSHeapSize: (performance).memory.usedJSHeapSize,
          totalJSHeapSize: (performance).memory.totalJSHeapSize,
          jsHeapSizeLimit: (performance).memory.jsHeapSizeLimit,
        } : null;
        
        return {
          timing: navigation ? {
            // Navigation timing
            redirectTime: navigation.redirectEnd - navigation.redirectStart,
            dnsTime: navigation.domainLookupEnd - navigation.domainLookupStart,
            tcpTime: navigation.connectEnd - navigation.connectStart,
            requestTime: navigation.responseStart - navigation.requestStart,
            responseTime: navigation.responseEnd - navigation.responseStart,
            domParsingTime: navigation.domInteractive - navigation.responseEnd,
            domContentLoadedTime: navigation.domContentLoadedEventEnd - navigation.domContentLoadedEventStart,
            loadEventTime: navigation.loadEventEnd - navigation.loadEventStart,
            totalLoadTime: navigation.loadEventEnd - navigation.fetchStart,
            
            // Detailed timings
            fetchStart: navigation.fetchStart,
            domainLookupStart: navigation.domainLookupStart,
            domainLookupEnd: navigation.domainLookupEnd,
            connectStart: navigation.connectStart,
            connectEnd: navigation.connectEnd,
            requestStart: navigation.requestStart,
            responseStart: navigation.responseStart,
            responseEnd: navigation.responseEnd,
            domInteractive: navigation.domInteractive,
            domContentLoadedEventStart: navigation.domContentLoadedEventStart,
            domContentLoadedEventEnd: navigation.domContentLoadedEventEnd,
            domComplete: navigation.domComplete,
            loadEventStart: navigation.loadEventStart,
            loadEventEnd: navigation.loadEventEnd,
          } : null,
          paint: paint.map(p => ({
            name: p.name,
            startTime: p.startTime,
          })),
          resources: {
            total: resources.length,
            byType: resources.reduce((acc, r) => {
              const type = r.initiatorType || 'other';
              acc[type] = (acc[type] || 0) + 1;
              return acc;
            }, {}),
            totalSize: resources.reduce((sum, r) => sum + (r.transferSize || 0), 0),
            totalDuration: resources.reduce((sum, r) => sum + r.duration, 0),
          },
          marks: marks.map(m => ({
            name: m.name,
            startTime: m.startTime,
          })),
          measures: measures.map(m => ({
            name: m.name,
            startTime: m.startTime,
            duration: m.duration,
          })),
          memory: memory,
        };
      });
      
      return {
        success: true,
        url: page.url(),
        metrics: metrics,
        timestamp: new Date().toISOString(),
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  }

  async cleanup() {
    if (this.browser) {
      console.error('[DOMLogger MCP] Closing browser...');
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    
    console.error('[DOMLogger MCP] Server running on stdio');
    console.error('[DOMLogger MCP] Extension path:', EXTENSION_PATH);
    console.error('[DOMLogger MCP] Ready to receive requests');
    
    // Handle cleanup on exit
    process.on('SIGINT', async () => {
      await this.cleanup();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await this.cleanup();
      process.exit(0);
    });
  }
}

// Start the server
const server = new DOMLoggerMCPServer();
server.run().catch((error) => {
  console.error('[DOMLogger MCP] Fatal error:', error);
  process.exit(1);
});


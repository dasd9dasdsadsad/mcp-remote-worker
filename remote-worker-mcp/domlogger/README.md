# DOMLogger++ MCP Server

Node.js-based MCP server that provides full control over the DOMLogger++ browser extension for Cursor Desktop.

## Features

- **Browser Automation**: Navigate, click, type, evaluate JavaScript, take screenshots
- **Extension Control**: Add domains to scope, query captured sinks, configure hooks
- **Real-time Monitoring**: Capture and analyze JavaScript sinks as they execute
- **Automated Workflows**: XSS scanning, security testing

## Quick Start

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Test the Server

```bash
npm test
```

### 3. Configure Cursor Desktop

Add to your Cursor MCP settings (`%APPDATA%\Cursor\User\globalStorage\mcp-settings.json`):

```json
{
  "mcpServers": {
    "domlogger-unified": {
      "command": "node",
      "args": ["C:\\Users\\YOUR_USERNAME\\domloggerpp-1\\backend\\server.js"],
      "env": {}
    }
  }
}
```

**Important:** Update the path to match your installation directory!

### 4. Restart Cursor

Close and reopen Cursor Desktop completely.

## Available Tools

### Browser Control (7 tools)
- `browser_navigate` - Navigate to URL
- `browser_click` - Click elements  
- `browser_type` - Type text
- `browser_evaluate` - Execute JavaScript
- `browser_screenshot` - Take screenshots
- `browser_get_url` - Get current URL
- `browser_wait_for_selector` - Wait for elements

### DOMLogger++ Control (5 tools)
- `domlogger_add_scope` - Add domain to monitoring
- `domlogger_query_sinks` - Query captured sinks
- `domlogger_set_config` - Set hook configuration
- `domlogger_get_statistics` - Get statistics
- `domlogger_clear_data` - Clear captured data

### Workflows (1 tool)
- `scan_for_xss` - Automated XSS scanning

### Advanced Debugging (2 tools) ✅ FULLY FUNCTIONAL
- `domlogger_goto_sink_with_canary` - Find sinks with canary, open in separate windows, capture call stacks
- `browser_get_callstack` - Get call stack when debugger pauses

**Status:** Successfully tested with real-world XSS sinks. Captures full call stacks automatically.

Total: **15 tools**

## Usage Examples

### Example 1: Monitor a Website

```
Add app.netlify.com to DOMLogger scope
Navigate to https://app.netlify.com
Query captured sinks
```

### Example 2: XSS Scanning

```
Scan https://example.com for XSS vulnerabilities
```

### Example 3: Custom Configuration

```
Set DOMLogger config to monitor innerHTML and eval
Add example.com to scope
Navigate to https://example.com
Get statistics
```

### Example 4: Canary-based Debugging

```
Find sink containing "my_canary_123"
Get the full call stack
```

See `CANARY_CALLSTACK.md` for detailed documentation on canary-based debugging.

## Architecture

```
Cursor Desktop
    ↓ MCP Protocol (stdio)
Node.js MCP Server (server.js)
    ↓ Puppeteer
Chrome Browser + DOMLogger++ Extension
    ↓ chrome.runtime.sendMessage
Extension Background (app/src/background/mcp-server.js)
    ↓
chrome.storage & Sink Data
```

## Files

- `server.js` - Main MCP server
- `test-server.js` - Test suite
- `test-canary.js` - Canary tools test
- `package.json` - Dependencies
- `README.md` - This file
- `CANARY_CALLSTACK.md` - Canary debugging guide
- `QUICK_START.md` - 3-minute setup

## Extension Integration

The MCP server communicates with the DOMLogger++ extension via:

1. **Puppeteer** launches Chrome with the extension loaded
2. **Extension page** created for chrome.runtime API access
3. **Runtime messaging** sends MCP requests to extension background
4. **Extension MCP server** (`app/src/background/mcp-server.js`) handles requests
5. **Responses** flow back through the same channel

## Troubleshooting

### Server doesn't start
- Check Node.js is installed: `node --version` (requires v16+)
- Reinstall dependencies: `npm install`

### Extension not loaded
- Verify extension path in browser
- Check Chrome console for errors
- Reload extension at chrome://extensions

### Tools not responding
- Restart Cursor completely
- Check MCP server logs in Cursor output panel
- Verify extension is loaded in the browser

## Dependencies

- `@modelcontextprotocol/sdk` - Official MCP SDK
- `puppeteer` - Browser automation

Both are automatically installed via `npm install`.

## License

Same as DOMLogger++ main project.


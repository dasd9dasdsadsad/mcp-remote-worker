# Quick Start - DOMLogger++ MCP

Get the MCP server running in 3 minutes.

## 1. Install (30 seconds)

```bash
cd backend
npm install
```

## 2. Test (30 seconds)

```bash
npm test
```

You should see:
```
✅ All tests passed!
- Initialize: domlogger-unified
- Tools: 13 available
- Browser: Launches successfully
```

## 3. Configure Cursor (1 minute)

**Windows:** Edit `%APPDATA%\Cursor\User\globalStorage\mcp-settings.json`

**macOS/Linux:** Edit `~/Library/Application Support/Cursor/User/globalStorage/mcp-settings.json`

Add:
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

**⚠️ Important:** 
- Replace `YOUR_USERNAME` with your actual username
- Use double backslashes on Windows: `C:\\Users\\...`
- Use forward slashes on macOS/Linux: `/Users/...`

## 4. Restart Cursor (30 seconds)

- Close Cursor completely
- Reopen Cursor

## 5. Test It (30 seconds)

In Cursor, ask:

> "Use browser_navigate to go to https://example.com and take a screenshot"

You should see:
- Chrome browser opens with DOMLogger++ extension
- Navigates to example.com
- Screenshot taken
- Success response

## That's It! 🎉

You now have:
- ✅ Browser automation working
- ✅ DOMLogger++ extension integrated
- ✅ 13 MCP tools available
- ✅ AI-powered security testing ready

## Next Steps

Try these commands in Cursor:

**Add a domain to scope:**
> "Add app.netlify.com to DOMLogger scope and navigate there"

**Query captured sinks:**
> "Query all captured sinks from DOMLogger"

**Get statistics:**
> "Get DOMLogger statistics"

**Run XSS scan:**
> "Scan https://example.com for XSS"

## Troubleshooting

**"Extension not loaded"**
- Reload DOMLogger++ at chrome://extensions
- Restart Cursor

**"No response from extension"**  
- Close all Chrome windows
- Restart Cursor
- Try again

**"Server doesn't start"**
- Check Node.js: `node --version` (need v16+)
- Reinstall: `npm install`
- Check logs in Cursor output panel

## Documentation

- Full docs: `backend/README.md`
- Architecture: `INTEGRATED_ARCHITECTURE.md`
- Available tools: 13 total (browser + extension control)














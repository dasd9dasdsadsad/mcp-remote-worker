// MCP Server running inside the extension
// This allows the extension to expose its functionality via chrome.runtime messaging

const mcpServer = new class MCPServer {
    constructor() {
        this.sinkData = new Map(); // Store sink data with dupKey as key
        this.stats = {
            totalSinks: 0,
            byType: {},
            byTag: {},
            byDomain: {}
        };
    }

    async init() {
        console.log('[MCP] Initializing MCP server inside extension...');
        
        // Listen for external native messages (from Node.js MCP server)
        if (extensionAPI.runtime.onMessageExternal) {
            extensionAPI.runtime.onMessageExternal.addListener(this.handleExternalMessage.bind(this));
        }
        
        // Also support internal extension messages
        extensionAPI.runtime.onMessage.addListener((msg, sender, sendResponse) => {
            if (msg.mcp_request) {
                this.handleMCPRequest(msg.mcp_request).then(sendResponse);
                return true; // Keep channel open for async response
            }
        });
        
        console.log('[MCP] Server initialized');
    }

    // Called by background.js when new sink data arrives
    addSinkData(data) {
        const dupKey = data.dupKey;
        this.sinkData.set(dupKey, data);
        
        // Update statistics
        this.stats.totalSinks++;
        
        // By type
        const type = data.type || 'unknown';
        this.stats.byType[type] = (this.stats.byType[type] || 0) + 1;
        
        // By tag
        const tag = data.tag || 'unknown';
        this.stats.byTag[tag] = (this.stats.byTag[tag] || 0) + 1;
        
        // By domain
        try {
            const domain = new URL(data.href).hostname;
            this.stats.byDomain[domain] = (this.stats.byDomain[domain] || 0) + 1;
        } catch (e) {}
    }

    async handleExternalMessage(request, sender, sendResponse) {
        console.log('[MCP] Received external message:', request);
        const response = await this.handleMCPRequest(request);
        sendResponse(response);
    }

    async handleMCPRequest(request) {
        const { method, params = {} } = request;
        
        console.log('[MCP] Handling request:', method, params);
        
        try {
            switch (method) {
                case 'add_scope':
                    return await this.addScope(params.pattern);
                
                case 'remove_scope':
                    return await this.removeScope(params.pattern);
                
                case 'get_scope':
                    return await this.getScope();
                
                case 'query_sinks':
                    return await this.querySinks(params);
                
                case 'get_statistics':
                    return await this.getStatistics();
                
                case 'clear_sinks':
                    return await this.clearSinks();
                
                case 'set_config':
                    return await this.setConfig(params.config_name, params.config);
                
                case 'get_config':
                    return await this.getConfig();
                
                default:
                    return {
                        success: false,
                        error: `Unknown method: ${method}`
                    };
            }
        } catch (error) {
            console.error('[MCP] Error handling request:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Tool implementations
    async addScope(pattern) {
        return new Promise((resolve) => {
            extensionAPI.storage.local.get(['allowedDomains'], (data) => {
                const domains = data.allowedDomains || [];
                if (!domains.includes(pattern)) {
                    domains.push(pattern);
                    extensionAPI.storage.local.set({ allowedDomains: domains }, () => {
                        console.log('[MCP] Added domain to scope:', pattern);
                        resolve({ success: true, domains, added: pattern });
                    });
                } else {
                    resolve({ success: true, domains, alreadyExists: true });
                }
            });
        });
    }

    async removeScope(pattern) {
        return new Promise((resolve) => {
            extensionAPI.storage.local.get(['allowedDomains'], (data) => {
                const domains = data.allowedDomains || [];
                const filtered = domains.filter(d => d !== pattern);
                extensionAPI.storage.local.set({ allowedDomains: filtered }, () => {
                    console.log('[MCP] Removed domain from scope:', pattern);
                    resolve({ success: true, domains: filtered, removed: pattern });
                });
            });
        });
    }

    async getScope() {
        return new Promise((resolve) => {
            extensionAPI.storage.local.get(['allowedDomains'], (data) => {
                resolve({ success: true, domains: data.allowedDomains || [] });
            });
        });
    }

    async querySinks(filters = {}) {
        let sinks = Array.from(this.sinkData.values());
        
        // Apply filters
        if (filters.tag) {
            sinks = sinks.filter(s => s.tag === filters.tag);
        }
        if (filters.sink_type) {
            sinks = sinks.filter(s => s.sink === filters.sink_type);
        }
        if (filters.type) {
            sinks = sinks.filter(s => s.type === filters.type);
        }
        if (filters.data_contains) {
            sinks = sinks.filter(s => 
                JSON.stringify(s.data).includes(filters.data_contains)
            );
        }
        if (filters.domain) {
            sinks = sinks.filter(s => {
                try {
                    return new URL(s.href).hostname.match(filters.domain);
                } catch (e) {
                    return false;
                }
            });
        }
        
        // Apply limit
        if (filters.limit) {
            sinks = sinks.slice(0, filters.limit);
        }
        
        return {
            success: true,
            sinks,
            total: sinks.length,
            filters_applied: filters
        };
    }

    async getStatistics() {
        return {
            success: true,
            stats: {
                totalSinks: this.stats.totalSinks,
                byType: this.stats.byType,
                byTag: this.stats.byTag,
                byDomain: this.stats.byDomain,
                inMemory: this.sinkData.size
            }
        };
    }

    async clearSinks() {
        this.sinkData.clear();
        this.stats = {
            totalSinks: 0,
            byType: {},
            byTag: {},
            byDomain: {}
        };
        
        // Also clear from MessagesHandler
        MessagesHandler.storage = {};
        MessagesHandler.broadcast({ action: 'clearStorage' });
        
        return {
            success: true,
            message: 'All sink data cleared'
        };
    }

    async setConfig(configName, config) {
        return new Promise((resolve) => {
            extensionAPI.storage.local.get(['hooksData'], (data) => {
                let hooksData = data.hooksData || {
                    selectedHook: 1,
                    hooksSettings: [
                        { name: 'GLOBAL', content: { hooks: {}, config: {} } }
                    ]
                };
                
                // Find or create config
                const idx = hooksData.hooksSettings.findIndex(c => c.name === configName);
                if (idx === -1) {
                    // Add new config
                    hooksData.hooksSettings.push({
                        name: configName,
                        content: config
                    });
                    hooksData.selectedHook = hooksData.hooksSettings.length - 1;
                } else {
                    // Update existing config
                    hooksData.hooksSettings[idx].content = config;
                    hooksData.selectedHook = idx;
                }
                
                extensionAPI.storage.local.set({ hooksData }, () => {
                    console.log('[MCP] Config set:', configName);
                    resolve({
                        success: true,
                        config_name: configName,
                        selected: hooksData.selectedHook
                    });
                });
            });
        });
    }

    async getConfig() {
        return new Promise((resolve) => {
            extensionAPI.storage.local.get(['hooksData'], (data) => {
                const hooksData = data.hooksData;
                if (!hooksData) {
                    resolve({ success: false, error: 'No config found' });
                    return;
                }
                
                const selected = hooksData.hooksSettings[hooksData.selectedHook];
                resolve({
                    success: true,
                    config: selected,
                    all_configs: hooksData.hooksSettings.map(s => s.name),
                    selected_index: hooksData.selectedHook
                });
            });
        });
    }
}();






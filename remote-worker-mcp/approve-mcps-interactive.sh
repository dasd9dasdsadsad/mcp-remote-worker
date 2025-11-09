#!/bin/bash
# Script to interactively approve MCP servers in cursor-agent

echo "═══════════════════════════════════════════════════════════════"
echo "MCP Server Interactive Approval"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "This script will launch cursor-agent in interactive mode."
echo "When prompted, you need to:"
echo "  1. Approve 'mcp-worker-enhanced'"
echo "  2. Approve 'domlogger-unified'"
echo ""
echo "Starting in 3 seconds..."
sleep 3

# Run cursor-agent with a simple prompt to trigger MCP loading
echo "test approval" | cursor-agent --model auto -p "Just respond with 'approved'" --approve-mcps

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "Approval complete! Check MCP list:"
echo "═══════════════════════════════════════════════════════════════"
cursor-agent mcp list

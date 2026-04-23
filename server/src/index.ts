import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AEWebSocketServer } from "./websocket.js";
import fs from "node:fs";
import path from "node:path";

const server = new McpServer({
  name: "AfterEffectsServer",
  version: "1.0.0"
});

const configuredPort = Number.parseInt(process.env.AEMCP_PORT || "0", 10);
const wsServer = new AEWebSocketServer(configuredPort);
const wsPort = wsServer.getPort();
const portFilePath = process.env.AEMCP_PORT_FILE || path.join(
  process.env.APPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Roaming"),
  "Adobe",
  "CEP",
  "extensions",
  "aemcp",
  "aemcp-port.json"
);

function writePortClaim() {
  const payload = {
    pid: process.pid,
    port: wsPort,
    updatedAt: new Date().toISOString()
  };

  fs.mkdirSync(path.dirname(portFilePath), { recursive: true });
  fs.writeFileSync(portFilePath, JSON.stringify(payload, null, 2), "utf8");
  console.error(`AEMCP claim written to ${portFilePath}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensurePanelConnection(): Promise<void> {
  if (wsServer.isConnected()) {
    return;
  }

  writePortClaim();

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (wsServer.isConnected()) {
      return;
    }
    await sleep(100);
  }

  throw new Error('After Effects not connected. Please ensure the AEMCP panel is open.');
}

function clearPortClaim() {
  try {
    if (!fs.existsSync(portFilePath)) {
      return;
    }

    const raw = fs.readFileSync(portFilePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && parsed.pid === process.pid) {
      fs.unlinkSync(portFilePath);
    }
  } catch (error) {
    console.error("Failed to clear AEMCP claim:", error);
  }
}

process.on("exit", clearPortClaim);
process.on("SIGINT", () => {
  clearPortClaim();
  process.exit(0);
});
process.on("SIGTERM", () => {
  clearPortClaim();
  process.exit(0);
});

// Helper to execute ExtendScript
async function executeInAE(jsx: string): Promise<string> {
  await ensurePanelConnection();
  
  return await wsServer.sendCommand('eval', { jsx });
}

// Tool 1: Run Script
server.tool(
  "run_script",
  "Execute ExtendScript code in After Effects. Your code is automatically wrapped in beginUndoGroup/endUndoGroup, so don't add those. Note: ExtendScript does NOT have JSON support. To return values, use explicit 'return' statements. To return objects, build them as strings.",
  {
    jsx: z.string().describe("ExtendScript code to execute. Already wrapped in undo group. Use 'return' to get values back.")
  },
  async ({ jsx }) => {
    try {
      const result = await executeInAE(jsx);
      // Convert result to string for display
      const resultText = result === undefined ? "Success" : 
                        result === null ? "null" :
                        typeof result === "string" ? result :
                        JSON.stringify(result);
      return {
        content: [{
          type: "text",
          text: resultText
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  }
);

// Tool 6: Create ScriptUI Tool
server.tool(
  "create_scriptui_tool",
  "Create a custom tool window for After Effects using ScriptUI. This creates a SEPARATE floating tool window with buttons, sliders, text inputs, and other controls. Perfect for building custom tools and utilities for the user. Use 'palette' for persistent tool windows, 'dialog' for quick modal inputs.",
  {
    scriptui_code: z.string().describe("ExtendScript ScriptUI code to create the tool. Use Window('palette') for non-blocking tools. Example: var tool = new Window('palette', 'My Custom Tool'); tool.add('button', undefined, 'Process'); tool.show();")
  },
  async ({ scriptui_code }) => {
    try {
      // ScriptUI code runs directly as ExtendScript
      const result = await executeInAE(scriptui_code);
      
      return {
        content: [{
          type: "text",
          text: result === undefined ? "ScriptUI tool created successfully" : result
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  }
);

// Tool 7: Append HTML to Panel
server.tool(
  "append_html_to_panel",
  "Append HTML/CSS/JS content to the existing AEMCP panel. Note: This adds content INSIDE the current AEMCP panel window, it does NOT create a new window. Use create_scriptui_tool for new windows.",
  {
    html: z.string().describe("HTML content to append to the panel"),
    css: z.string().optional().describe("CSS styles"),
    js: z.string().optional().describe("JavaScript for interactions")
  },
  async ({ html, css, js }) => {
    try {
      await ensurePanelConnection();
      await wsServer.sendCommand('renderCustomPanel', {
        html: html,
        css: css || "",
        js: js || ""
      });
      
      return {
        content: [{
          type: "text",
          text: "HTML content appended to panel"
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  }
);

// Tool 8: Clear Panel HTML
server.tool(
  "clear_panel_html",
  "Clear the HTML content from the AEMCP panel",
  {},
  async () => {
    try {
      await ensurePanelConnection();
      await wsServer.sendCommand('closePanel');
      return {
        content: [{
          type: "text",
          text: "Panel HTML cleared"
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  }
);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`After Effects MCP Server running on WebSocket port ${wsPort}...`);
}

main().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});

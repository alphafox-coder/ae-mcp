class WebSocketClient {
    constructor(url = null) {
        this.url = url;
        this.ws = null;
        this.reconnectInterval = 2000;
        this.messageHandlers = new Map();
        this.portFilePath = null;
        this.currentPort = null;
        this.pollInterval = 1000;
        this.pollTimer = null;
    }

    start() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
        }
        this.pollPortFile();
        this.pollTimer = setInterval(() => this.pollPortFile(), this.pollInterval);
    }

    readPortFile() {
        if (!window.cep || !window.cep.fs || !this.portFilePath) {
            return null;
        }

        const result = window.cep.fs.readFile(this.portFilePath);
        if (!result || result.err !== 0 || !result.data) {
            return null;
        }

        try {
            const parsed = JSON.parse(result.data);
            const port = Number(parsed.port);
            return Number.isFinite(port) ? port : null;
        } catch (error) {
            console.error('Port file parse error:', error);
            return null;
        }
    }

    pollPortFile() {
        const discoveredPort = this.readPortFile();
        const targetPort = discoveredPort || 39307;
        if (this.currentPort === targetPort && this.ws && this.ws.readyState !== WebSocket.CLOSED) {
            return;
        }

        this.currentPort = targetPort;
        this.url = `ws://127.0.0.1:${targetPort}`;
        this.connect();
    }

    connect() {
        try {
            if (this.ws) {
                this.ws.onopen = null;
                this.ws.onclose = null;
                this.ws.onerror = null;
                this.ws.onmessage = null;
                try {
                    this.ws.close();
                } catch (error) {
                    console.error('Socket close error:', error);
                }
            }

            this.ws = new WebSocket(this.url);
            
            this.ws.onopen = () => {
                console.log('Connected to MCP server');
                this.onConnectionChange(true);
            };

            this.ws.onclose = () => {
                console.log('Disconnected from MCP server');
                this.onConnectionChange(false);
                setTimeout(() => this.pollPortFile(), this.reconnectInterval);
            };

            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
            };

            this.ws.onmessage = (event) => {
                this.handleMessage(event.data);
            };
        } catch (error) {
            console.error('Connection error:', error);
            setTimeout(() => this.pollPortFile(), this.reconnectInterval);
        }
    }

    handleMessage(data) {
        try {
            const message = JSON.parse(data);
            console.log('Received:', message);
            
            if (message.id && this.messageHandlers.has(message.id)) {
                const handler = this.messageHandlers.get(message.id);
                handler(message);
                this.messageHandlers.delete(message.id);
            } else if (message.action) {
                this.onAction(message);
            }
        } catch (error) {
            console.error('Message handling error:', error);
        }
    }

    send(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
            return true;
        }
        return false;
    }

    sendWithCallback(message, callback) {
        if (!message.id) {
            message.id = this.generateId();
        }
        this.messageHandlers.set(message.id, callback);
        return this.send(message);
    }

    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    onConnectionChange(connected) {
        // Override in main.js
    }

    onAction(message) {
        // Override in main.js
    }
}

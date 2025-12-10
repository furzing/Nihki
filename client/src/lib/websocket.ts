import { useEffect, useRef, useState, useCallback } from 'react';

export function useWebSocket(sessionId: string) {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<MessageEvent | null>(null);
  const websocket = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;

  const connect = useCallback(() => {
    if (!sessionId) {
      console.log('[WebSocket] No sessionId provided, skipping connection');
      return;
    }

    try {
      // Construct WebSocket URL safely from current location
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.host; // Includes both hostname and port
      const wsUrl = `${protocol}//${host}/ws`;
      
      console.log('[WebSocket] 🔌 Attempting connection to:', wsUrl);
      
      websocket.current = new WebSocket(wsUrl);

      websocket.current.onopen = () => {
        console.log('[WebSocket] ✅ Connection established!');
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
        
        // Join the session room
        const joinMessage = {
          type: 'join-session',
          sessionId: sessionId
        };
        console.log('[WebSocket] 📨 Sending join-session message:', joinMessage);
        websocket.current?.send(JSON.stringify(joinMessage));
      };

      websocket.current.onmessage = (event) => {
        console.log('[WebSocket] 📥 Message received:', event.data);
        setLastMessage(event);
      };

      websocket.current.onclose = (event) => {
        console.log('[WebSocket] ❌ Connection closed. Code:', event.code, 'Reason:', event.reason);
        setIsConnected(false);
        
        // Attempt to reconnect
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++;
          const delay = Math.pow(2, reconnectAttemptsRef.current) * 1000;
          console.log(`[WebSocket] 🔄 Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})`);
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        } else {
          console.error('[WebSocket] ⛔ Max reconnection attempts reached');
        }
      };

      websocket.current.onerror = (error) => {
        console.error('[WebSocket] ⚠️ Error occurred:', error);
        setIsConnected(false);
      };

    } catch (error) {
      console.error('[WebSocket] ❌ Failed to create connection:', error);
      setIsConnected(false);
    }
  }, [sessionId]);

  const sendMessage = useCallback((message: any) => {
    if (websocket.current?.readyState === WebSocket.OPEN) {
      const msgType = message.type || 'unknown';
      if (msgType !== 'audio-chunk') {
        console.log('[WebSocket] 📤 Sending message:', msgType);
      }
      websocket.current.send(JSON.stringify(message));
    } else {
      const readyState = websocket.current?.readyState;
      const stateNames = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
      const stateName = readyState !== undefined ? stateNames[readyState] : 'NULL';
      console.warn(`[WebSocket] ⚠️ Cannot send message, WebSocket state: ${stateName} (${readyState})`);
    }
  }, []);

  const sendBinaryMessage = useCallback((data: Uint8Array) => {
    if (websocket.current?.readyState === WebSocket.OPEN) {
      console.log('[WebSocket] 🎙️ Sending binary audio chunk:', data.length, 'bytes');
      websocket.current.send(data);
    } else {
      const readyState = websocket.current?.readyState;
      const stateNames = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
      const stateName = readyState !== undefined ? stateNames[readyState] : 'NULL';
      console.warn(`[WebSocket] ⚠️ Cannot send binary, WebSocket state: ${stateName} (${readyState})`);
    }
  }, []);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    
    if (websocket.current) {
      websocket.current.close();
      websocket.current = null;
    }
    
    setIsConnected(false);
  }, []);

  useEffect(() => {
    connect();
    
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    isConnected,
    lastMessage,
    sendMessage,
    sendBinaryMessage,
    disconnect
  };
}

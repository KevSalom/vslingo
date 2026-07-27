import {
  type ClientVoiceMessage,
  parseServerMessage,
  type ServerVoiceMessage,
} from './protocol';

export type VoiceSocketListener = (message: ServerVoiceMessage) => void;
export type VoiceSocketBinaryListener = (data: ArrayBuffer) => void;
export type VoiceSocketStatusListener = (connected: boolean) => void;

const DEFAULT_API_BASE_URL =
  import.meta.env.PUBLIC_API_URL?.trim() || 'http://127.0.0.1:8000';

/** Build Voice WS URL from the same PUBLIC_API_URL used by REST clients. */
export function resolveVoiceWebSocketUrl(
  apiBaseUrl: string = DEFAULT_API_BASE_URL,
): string {
  const trimmed = apiBaseUrl.trim().replace(/\/$/, '');
  if (!trimmed) {
    return resolveVoiceWebSocketUrl('http://127.0.0.1:8000');
  }
  if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) {
    return trimmed.endsWith('/api/voice/ws') ? trimmed : `${trimmed}/api/voice/ws`;
  }
  const withScheme = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
  const wsBase = withScheme.replace(/^http/i, 'ws');
  return `${wsBase}/api/voice/ws`;
}

export class VoiceSocketClient {
  private socket: WebSocket | null = null;
  private listeners: Set<VoiceSocketListener> = new Set();
  private binaryListeners: Set<VoiceSocketBinaryListener> = new Set();
  private statusListeners: Set<VoiceSocketStatusListener> = new Set();

  constructor(private url: string = resolveVoiceWebSocketUrl()) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const wsUrl = this.url.startsWith('http')
          ? this.url.replace(/^http/i, 'ws')
          : this.url;
        this.socket = new WebSocket(wsUrl);

        this.socket.binaryType = 'arraybuffer';

        this.socket.onopen = () => {
          this.notifyStatus(true);
          this.sendMessage({ type: 'session.start', protocol_version: 1 });
          resolve();
        };

        this.socket.onmessage = (event) => {
          if (typeof event.data === 'string') {
            const parsed = parseServerMessage(event.data);
            if (parsed) {
              this.notifyListeners(parsed);
            }
          } else if (event.data instanceof ArrayBuffer) {
            this.notifyBinaryListeners(event.data);
          }
        };

        this.socket.onerror = (error) => {
          if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            reject(error);
          }
        };

        this.socket.onclose = () => {
          this.notifyStatus(false);
          this.socket = null;
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  sendMessage(msg: ClientVoiceMessage): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }

  sendBinary(data: Uint8Array): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      const exactBytes = data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength,
      ) as ArrayBuffer;
      this.socket.send(exactBytes);
    }
  }

  onMessage(listener: VoiceSocketListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onBinary(listener: VoiceSocketBinaryListener): () => void {
    this.binaryListeners.add(listener);
    return () => this.binaryListeners.delete(listener);
  }

  onStatusChange(listener: VoiceSocketStatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  disconnect(): void {
    if (this.socket) {
      if (this.socket.readyState === WebSocket.OPEN) {
        this.sendMessage({ type: 'session.end' });
      }
      this.socket.close();
      this.socket = null;
    }
    this.notifyStatus(false);
  }

  get isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  private notifyListeners(message: ServerVoiceMessage): void {
    for (const listener of this.listeners) {
      listener(message);
    }
  }

  private notifyBinaryListeners(data: ArrayBuffer): void {
    for (const listener of this.binaryListeners) {
      listener(data);
    }
  }

  private notifyStatus(connected: boolean): void {
    for (const listener of this.statusListeners) {
      listener(connected);
    }
  }
}

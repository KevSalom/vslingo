import { describe, expect, it } from 'vitest';
import contractFixture from '../../../../docs/contracts/voice-protocol-v1.json';
import { parseServerMessage } from './protocol';

describe('Voice Protocol v1 parsing', () => {
  it('parses all server events from contract fixture', () => {
    const serverEvents = contractFixture.server_events;

    for (const [_key, msg] of Object.entries(serverEvents)) {
      const jsonStr = JSON.stringify(msg);
      const parsed = parseServerMessage(jsonStr);
      expect(parsed).not.toBeNull();
      expect(parsed?.type).toBe(msg.type);
    }
  });

  it('rejects invalid JSON string', () => {
    expect(parseServerMessage('invalid json')).toBeNull();
  });

  it('rejects unknown message type', () => {
    expect(parseServerMessage(JSON.stringify({ type: 'unknown.type' }))).toBeNull();
  });

  it('rejects malformed session.ready', () => {
    const malformed = JSON.stringify({
      type: 'session.ready',
      protocol_version: 2, // invalid version
      session_id: '123',
    });
    expect(parseServerMessage(malformed)).toBeNull();
  });
});

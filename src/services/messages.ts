import twilio from 'twilio';
import type { AppEnv } from '../config/env.js';

export interface Messenger {
  send(to: string, body: string): Promise<{ sid: string }>;
  validate(signature: string, url: string, params: Record<string, string>): boolean;
}

export class MockMessenger implements Messenger {
  readonly sent: Array<{ to: string; body: string }> = [];
  async send(to: string, body: string) { this.sent.push({ to, body }); return { sid: `mock-${this.sent.length}` }; }
  validate(signature: string) { return signature === 'mock-valid-signature'; }
}

export class TwilioMessenger implements Messenger {
  private readonly client;
  constructor(private readonly env: AppEnv) { this.client = twilio(env.TWILIO_ACCOUNT_SID!, env.TWILIO_AUTH_TOKEN!); }
  async send(to: string, body: string) {
    const message = await this.client.messages.create({ to, from: this.env.TWILIO_FROM!, body });
    return { sid: message.sid };
  }
  validate(signature: string, url: string, params: Record<string, string>) {
    return twilio.validateRequest(this.env.TWILIO_AUTH_TOKEN!, signature, url, params);
  }
}

export function createMessenger(env: AppEnv): Messenger {
  return env.MOCK_EXTERNALS ? new MockMessenger() : new TwilioMessenger(env);
}

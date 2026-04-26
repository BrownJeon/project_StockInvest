export type { AlertLevel } from './slack';
import type { AlertLevel } from './slack';
import { sendSlackAlert }    from './slack';
import { sendTelegramAlert } from './telegram';

export function sendAlert(level: AlertLevel, title: string, body: string): void {
  sendSlackAlert(level, title, body).catch(() => {});
  sendTelegramAlert(level, title, body).catch(() => {});
}

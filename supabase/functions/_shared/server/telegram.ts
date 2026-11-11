// Telegram Bot API sender.
import { type Messenger, UpstreamError } from './deps.ts';

export function createTelegram(token: string, chatId: string, fetchFn: typeof fetch = fetch): Messenger {
  return {
    async send(html: string) {
      if (!token || !chatId) throw new UpstreamError(503, 'TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID are not set');
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 10_000);
      try {
        const res = await fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true }),
          signal: ctl.signal,
        });
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          throw new UpstreamError(res.status, `Telegram: ${b?.description ?? res.status}`, b?.parameters?.retry_after ?? null);
        }
      } catch (e) {
        if (e instanceof UpstreamError) throw e;
        throw new UpstreamError(0, `Telegram network error: ${(e as Error).message}`);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

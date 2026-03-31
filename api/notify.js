// Vercel Serverless Function — Ежедневные Telegram-уведомления
// Вызывается каждый день в 9:00 по Алматы (04:00 UTC)
// Настрой в Vercel: Settings → Cron Jobs → 0 4 * * * → /api/notify

const SUPABASE_URL = 'https://afnxgnoqkxtyrcwhgbyv.supabase.co';
const BOT_TOKEN    = '8447689900:AAEKt1iaGkldie1gDHLa4EewxZX6jlmHERM';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sendMessage(chatId, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
  });
}

async function supabaseGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
    }
  });
  return res.json();
}

function localDateStr(date) {
  // Казахстан UTC+5
  const kz = new Date(date.getTime() + 5 * 3600000);
  return kz.toISOString().split('T')[0];
}

function fmt(n) {
  return Math.round(n).toLocaleString('ru-RU') + ' ₸';
}

export default async function handler(req, res) {
  // Защита: только Vercel Cron или запрос с секретом
  const secret = req.headers['x-cron-secret'];
  if (secret !== process.env.CRON_SECRET && req.method !== 'GET') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const today    = localDateStr(new Date());
  const tomorrow = localDateStr(new Date(Date.now() + 86400000));

  // Получаем всех подключённых пользователей
  const tgUsers = await supabaseGet('user_telegram?select=user_id,chat_id');
  if (!tgUsers?.length) {
    return res.status(200).json({ sent: 0 });
  }

  let sent = 0;
  for (const { user_id, chat_id } of tgUsers) {
    try {
      // Загружаем займы пользователя
      const loanRows = await supabaseGet(`loans?user_id=eq.${user_id}&select=data`);
      const loans    = (loanRows || []).map(r => r.data).filter(Boolean);

      // Платежи сегодня и завтра
      const todayPay    = [];
      const tomorrowPay = [];

      for (const l of loans) {
        for (const p of (l.schedule || [])) {
          if (!p.paid && p.total > 0 && !p.is_early && !p.is_default) {
            if (p.date === today)    todayPay.push({ name: l.name, platform: l.platform, total: p.total });
            if (p.date === tomorrow) tomorrowPay.push({ name: l.name, platform: l.platform, total: p.total });
          }
        }
      }

      // Пропускаем если нечего отправлять
      if (!todayPay.length && !tomorrowPay.length) continue;

      let msg = `🔔 <b>Инвест-трекер — ежедневный отчёт</b>\n<i>${today}</i>\n\n`;

      if (todayPay.length) {
        const total = todayPay.reduce((s, p) => s + p.total, 0);
        msg += `📅 <b>Сегодня поступит:</b>\n`;
        for (const p of todayPay) {
          msg += `  • ${p.name} [${p.platform}]: <b>${fmt(p.total)}</b>\n`;
        }
        msg += `  <b>Итого: ${fmt(total)}</b>\n\n`;
      }

      if (tomorrowPay.length) {
        const total = tomorrowPay.reduce((s, p) => s + p.total, 0);
        msg += `📆 <b>Завтра поступит:</b>\n`;
        for (const p of tomorrowPay) {
          msg += `  • ${p.name} [${p.platform}]: <b>${fmt(p.total)}</b>\n`;
        }
        msg += `  <b>Итого: ${fmt(total)}</b>`;
      }

      await sendMessage(chat_id, msg);
      sent++;
    } catch(e) {
      console.error('notify error for', user_id, e);
    }
  }

  return res.status(200).json({ sent, today });
}

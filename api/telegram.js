// Vercel Serverless Function — Telegram Bot Webhook
// URL: https://invest-platform-seven.vercel.app/api/telegram

const SUPABASE_URL        = 'https://afnxgnoqkxtyrcwhgbyv.supabase.co';
const BOT_TOKEN           = '8447689900:AAEKt1iaGkldie1gDHLa4EewxZX6jlmHERM';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sendMessage(chatId, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
  });
}

async function safeJson(res) {
  const text = await res.text();
  if (!text || !text.trim()) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
    }
  });
  return safeJson(res);
}

async function sbPost(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates'
    },
    body: JSON.stringify(body)
  });
  return safeJson(res);
}

async function sbDelete(path) {
  await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
    }
  });
}

async function findUserByCode(code) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/find_user_by_code`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ p_code: code })
  });
  const data = await safeJson(res);
  return data || null;
}

function fmt(n) {
  return Math.round(n).toLocaleString('ru-RU') + ' ₸';
}

function localDateStr(date) {
  const kz = new Date(date.getTime() + 5 * 3600000);
  return kz.toISOString().split('T')[0];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('Telegram webhook OK');
  }

  const update  = req.body;
  const message = update.message;
  if (!message || !message.text) return res.status(200).send('ok');

  const chatId   = message.chat.id;
  const text     = message.text.trim();
  const username = message.from?.first_name || message.from?.username || 'друг';

  // ── /start [CODE] ─────────────────────────────────────────────
  if (text.startsWith('/start')) {
    const code = text.split(' ')[1]?.toUpperCase();

    if (!code) {
      await sendMessage(chatId,
        `👋 Привет, ${username}!\n\nЯ — <b>Инвест-трекер бот</b>.\n\nЧтобы подключить уведомления:\n1. Открой приложение\n2. Нажми на аватар профиля\n3. Выбери <b>«Подключить Telegram»</b>\n4. Отправь мне команду с кодом`
      );
      return res.status(200).send('ok');
    }

    const userId = await findUserByCode(code);
    if (!userId) {
      await sendMessage(chatId,
        `❌ Код <b>${code}</b> не найден.\n\nПопробуй снова: открой приложение → профиль → <b>Подключить Telegram</b> и скопируй свежий код.`
      );
      return res.status(200).send('ok');
    }

    await sbPost('user_telegram', { user_id: userId, chat_id: String(chatId) });

    await sendMessage(chatId,
      `✅ <b>Готово, ${username}!</b> Telegram подключён.\n\nКаждый день в <b>9:00</b> буду присылать платежи на сегодня и завтра.\n\nКоманды:\n/today — платежи сегодня\n/week — платежи на 7 дней\n/loans — активные займы\n/stop — отключить уведомления`
    );
    return res.status(200).send('ok');
  }

  // ── Для всех остальных команд — ищем пользователя по chat_id ──
  const tgRows = await sbGet(`user_telegram?chat_id=eq.${chatId}&select=user_id`);
  const userId = tgRows?.[0]?.user_id;

  if (!userId) {
    await sendMessage(chatId,
      `👋 Сначала подключи аккаунт:\nОткрой приложение → профиль → <b>Подключить Telegram</b>.`
    );
    return res.status(200).send('ok');
  }

  const loanRows = await sbGet(`loans?user_id=eq.${userId}&select=data`);
  const loans    = (loanRows || []).map(r => r.data).filter(Boolean);
  const today    = localDateStr(new Date());
  const weekEnd  = localDateStr(new Date(Date.now() + 7 * 86400000));

  // ── /today ────────────────────────────────────────────────────
  if (text === '/today') {
    const pays = [];
    for (const l of loans) {
      for (const p of (l.schedule || [])) {
        if (!p.paid && p.date === today && p.total > 0 && !p.is_early && !p.is_default)
          pays.push({ name: l.name, platform: l.platform, total: p.total, body: p.body, reward: p.net_reward });
      }
    }
    if (!pays.length) {
      await sendMessage(chatId, `📅 <b>Сегодня платежей нет.</b> Отдыхай! 🎉`);
    } else {
      const sum = pays.reduce((s, p) => s + p.total, 0);
      let msg = `📅 <b>Платежи сегодня (${today}):</b>\n\n`;
      for (const p of pays)
        msg += `• <b>${p.name}</b> [${p.platform}]\n  💰 ${fmt(p.total)}\n\n`;
      msg += `<b>Итого: ${fmt(sum)}</b>`;
      await sendMessage(chatId, msg);
    }
    return res.status(200).send('ok');
  }

  // ── /week ─────────────────────────────────────────────────────
  if (text === '/week') {
    const pays = [];
    for (const l of loans) {
      for (const p of (l.schedule || [])) {
        if (!p.paid && p.date >= today && p.date <= weekEnd && p.total > 0 && !p.is_early && !p.is_default)
          pays.push({ name: l.name, platform: l.platform, date: p.date, total: p.total });
      }
    }
    pays.sort((a, b) => a.date.localeCompare(b.date));
    if (!pays.length) {
      await sendMessage(chatId, `📆 <b>На этой неделе платежей нет.</b>`);
    } else {
      const sum = pays.reduce((s, p) => s + p.total, 0);
      let msg = `📆 <b>Платежи на 7 дней:</b>\n\n`;
      for (const p of pays)
        msg += `• ${p.date} — <b>${p.name}</b> [${p.platform}]: ${fmt(p.total)}\n`;
      msg += `\n<b>Итого: ${fmt(sum)}</b>`;
      await sendMessage(chatId, msg);
    }
    return res.status(200).send('ok');
  }

  // ── /loans ────────────────────────────────────────────────────
  if (text === '/loans') {
    const active = loans.filter(l => !l.default_info &&
      l.schedule?.some(p => !p.paid && p.total > 0 && !p.is_early && !p.is_default));
    if (!active.length) {
      await sendMessage(chatId, `📋 <b>Активных займов нет.</b>`);
    } else {
      let msg = `📋 <b>Активные займы (${active.length}):</b>\n\n`;
      for (const l of active) {
        const paid   = l.schedule.filter(p => p.paid).length;
        const total  = l.schedule.filter(p => p.total > 0 && !p.is_early && !p.is_default).length;
        const remain = l.schedule.filter(p => !p.paid && p.total > 0 && !p.is_early && !p.is_default)
                                  .reduce((s, p) => s + p.total, 0);
        msg += `• <b>${l.name}</b> [${l.platform}]\n  Выплачено: ${paid}/${total} | Осталось: ${fmt(remain)}\n\n`;
      }
      await sendMessage(chatId, msg);
    }
    return res.status(200).send('ok');
  }

  // ── /stop ─────────────────────────────────────────────────────
  if (text === '/stop') {
    await sbDelete(`user_telegram?user_id=eq.${userId}`);
    await sendMessage(chatId, `👋 Уведомления отключены. Чтобы снова подключиться — открой приложение.`);
    return res.status(200).send('ok');
  }

  // ── Неизвестная команда ───────────────────────────────────────
  await sendMessage(chatId,
    `Команды:\n/today — платежи сегодня\n/week — платежи на 7 дней\n/loans — активные займы\n/stop — отключить уведомления`
  );
  return res.status(200).send('ok');
}

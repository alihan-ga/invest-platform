// Vercel Serverless Function — Telegram Bot Webhook
// Деплоится автоматически вместе с сайтом на Vercel
// URL будет: https://ваш-сайт.vercel.app/api/telegram

const SUPABASE_URL = 'https://afnxgnoqkxtyrcwhgbyv.supabase.co';
const BOT_TOKEN    = '8447689900:AAEKt1iaGkldie1gDHLa4EewxZX6jlmHERM';

// SERVICE_ROLE_KEY — добавь в Vercel Environment Variables как SUPABASE_SERVICE_KEY
// Supabase → Settings → API → service_role
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sendMessage(chatId, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
  });
}

async function supabaseRequest(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
      ...(options.headers || {})
    }
  });
  return res.json();
}

function localDateStr(date) {
  return date.toISOString().split('T')[0];
}

function fmt(n) {
  return Math.round(n).toLocaleString('ru-RU') + ' ₸';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('Telegram webhook OK');
  }

  const update = req.body;
  const message = update.message;
  if (!message || !message.text) {
    return res.status(200).send('ok');
  }

  const chatId   = message.chat.id;
  const text     = message.text.trim();
  const username = message.from?.username || message.from?.first_name || 'друг';

  // /start CODE — привязка аккаунта
  if (text.startsWith('/start')) {
    const parts = text.split(' ');
    const code  = parts[1]?.toUpperCase();

    if (!code) {
      await sendMessage(chatId,
        `👋 Привет, ${username}!\n\nЯ — <b>Инвест-трекер бот</b>.\n\nЧтобы подключить уведомления, открой приложение → профиль → <b>Подключить Telegram</b>.`
      );
      return res.status(200).send('ok');
    }

    // Ищем пользователя по коду (первые 8 символов user_id без дефисов)
    const users = await supabaseRequest(
      `users_telegram_link?code=eq.${code}&select=user_id`
    );

    // Альтернативный поиск: ищем в auth.users через RPC
    // Используем простой подход: code = первые 8 символов uuid без дефисов
    // Ищем в таблице loans пользователей чей id начинается с этого кода
    const loans = await supabaseRequest(
      `loans?select=user_id&limit=1`,
      {
        headers: {
          'Range': '0-0'
        }
      }
    );

    // Поиск user_id по коду через Supabase RPC
    const rpcResult = await fetch(`${SUPABASE_URL}/rest/v1/rpc/find_user_by_code`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_code: code })
    });
    const userId = await rpcResult.json();

    if (!userId) {
      await sendMessage(chatId,
        `❌ Код не найден. Попробуй снова: открой приложение → профиль → <b>Подключить Telegram</b>.`
      );
      return res.status(200).send('ok');
    }

    // Сохраняем chat_id
    await supabaseRequest('user_telegram', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, chat_id: String(chatId) })
    });

    await sendMessage(chatId,
      `✅ <b>Готово!</b> Telegram подключён к Инвест-трекеру.\n\nТеперь каждый день в <b>9:00</b> ты будешь получать уведомления о предстоящих платежах.\n\nКоманды:\n/today — платежи сегодня\n/week — платежи на неделю\n/loans — мои займы`
    );
    return res.status(200).send('ok');
  }

  // Находим пользователя по chat_id
  const tgRows = await supabaseRequest(`user_telegram?chat_id=eq.${chatId}&select=user_id`);
  const userId = tgRows?.[0]?.user_id;

  if (!userId && text !== '/start') {
    await sendMessage(chatId,
      `👋 Привет! Сначала подключи аккаунт: открой приложение → профиль → <b>Подключить Telegram</b>.`
    );
    return res.status(200).send('ok');
  }

  // Загружаем займы пользователя
  const loanRows = await supabaseRequest(`loans?user_id=eq.${userId}&select=data`);
  const loans    = (loanRows || []).map(r => r.data).filter(Boolean);

  const today    = localDateStr(new Date());
  const todayD   = new Date();
  const weekLater = localDateStr(new Date(todayD.getTime() + 7 * 86400000));

  if (text === '/today') {
    const payments = [];
    for (const l of loans) {
      for (const p of (l.schedule || [])) {
        if (!p.paid && p.date === today && p.total > 0 && !p.is_early && !p.is_default) {
          payments.push({ name: l.name, platform: l.platform, total: p.total, body: p.body, reward: p.net_reward });
        }
      }
    }
    if (!payments.length) {
      await sendMessage(chatId, `📅 <b>Сегодня платежей нет.</b>\n\nОтдыхай! 🎉`);
    } else {
      const total = payments.reduce((s, p) => s + p.total, 0);
      let msg = `📅 <b>Платежи сегодня (${today}):</b>\n\n`;
      for (const p of payments) {
        msg += `• <b>${p.name}</b> [${p.platform}]\n  💰 ${fmt(p.total)} (тело: ${fmt(p.body)}, %: ${fmt(p.reward)})\n\n`;
      }
      msg += `<b>Итого: ${fmt(total)}</b>`;
      await sendMessage(chatId, msg);
    }
    return res.status(200).send('ok');
  }

  if (text === '/week') {
    const payments = [];
    for (const l of loans) {
      for (const p of (l.schedule || [])) {
        if (!p.paid && p.date >= today && p.date <= weekLater && p.total > 0 && !p.is_early && !p.is_default) {
          payments.push({ name: l.name, platform: l.platform, date: p.date, total: p.total });
        }
      }
    }
    payments.sort((a, b) => a.date.localeCompare(b.date));
    if (!payments.length) {
      await sendMessage(chatId, `📆 <b>На этой неделе платежей нет.</b>`);
    } else {
      const total = payments.reduce((s, p) => s + p.total, 0);
      let msg = `📆 <b>Платежи на 7 дней:</b>\n\n`;
      for (const p of payments) {
        msg += `• ${p.date} — <b>${p.name}</b> [${p.platform}]: ${fmt(p.total)}\n`;
      }
      msg += `\n<b>Итого: ${fmt(total)}</b>`;
      await sendMessage(chatId, msg);
    }
    return res.status(200).send('ok');
  }

  if (text === '/loans') {
    const active = loans.filter(l => !l.default_info && l.schedule?.some(p => !p.paid && p.total > 0));
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

  if (text === '/stop') {
    await supabaseRequest(`user_telegram?user_id=eq.${userId}`, { method: 'DELETE' });
    await sendMessage(chatId, `👋 Уведомления отключены. Чтобы снова подключиться — открой приложение.`);
    return res.status(200).send('ok');
  }

  // Неизвестная команда
  await sendMessage(chatId,
    `Команды:\n/today — платежи сегодня\n/week — платежи на 7 дней\n/loans — мои займы\n/stop — отключить уведомления`
  );
  return res.status(200).send('ok');
}

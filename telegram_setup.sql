-- ================================================================
-- Шаг 1: Таблица для хранения Telegram chat_id пользователей
-- ================================================================
CREATE TABLE IF NOT EXISTS user_telegram (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  connected_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_telegram ENABLE ROW LEVEL SECURITY;

-- Пользователь может управлять только своей записью
CREATE POLICY "Users manage own telegram" ON user_telegram
  FOR ALL USING (auth.uid() = user_id);

-- ================================================================
-- Шаг 2: SQL-функция для поиска user_id по коду привязки
-- Код = первые 8 символов UUID без дефисов (верхний регистр)
-- ================================================================
CREATE OR REPLACE FUNCTION find_user_by_code(p_code TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE UPPER(REPLACE(id::text, '-', '')) LIKE (p_code || '%')
  LIMIT 1;
  RETURN v_user_id;
END;
$$;

-- Даём право вызывать функцию анонимно (webhook её вызывает с service_role key)
GRANT EXECUTE ON FUNCTION find_user_by_code(TEXT) TO service_role;

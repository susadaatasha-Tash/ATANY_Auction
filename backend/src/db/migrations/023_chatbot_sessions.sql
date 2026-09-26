-- 023_chatbot_sessions.sql
-- Chatbot conversation persistence for the Admin Chatbot Logs page (/admin/chatbot).
-- One session holds MANY messages (1 session per conversation, not per message).
-- Guests store user_id = NULL (no fake accounts); mode keeps customer/seller contexts apart.

CREATE TABLE IF NOT EXISTS public.chatbot_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  mode TEXT NOT NULL DEFAULT 'customer',
  topic TEXT,
  resolved BOOLEAN NOT NULL DEFAULT true,
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chatbot_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.chatbot_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chatbot_sessions_user ON public.chatbot_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_chatbot_sessions_last_active ON public.chatbot_sessions(last_active DESC);
CREATE INDEX IF NOT EXISTS idx_chatbot_messages_session ON public.chatbot_messages(session_id, created_at);

ALTER TABLE public.chatbot_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chatbot_messages ENABLE ROW LEVEL SECURITY;

-- Admin-only access (mirrors audit_logs_select_admin). No customer-facing policies:
-- customers never read these tables directly; the backend service_role writes/reads them.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'chatbot_sessions_select_admin' AND tablename = 'chatbot_sessions'
  ) THEN
    CREATE POLICY "chatbot_sessions_select_admin" ON public.chatbot_sessions
      FOR SELECT USING (public.is_admin());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'chatbot_sessions_admin_write' AND tablename = 'chatbot_sessions'
  ) THEN
    CREATE POLICY "chatbot_sessions_admin_write" ON public.chatbot_sessions
      FOR ALL USING (public.is_admin());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'chatbot_messages_select_admin' AND tablename = 'chatbot_messages'
  ) THEN
    CREATE POLICY "chatbot_messages_select_admin" ON public.chatbot_messages
      FOR SELECT USING (public.is_admin());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'chatbot_messages_admin_write' AND tablename = 'chatbot_messages'
  ) THEN
    CREATE POLICY "chatbot_messages_admin_write" ON public.chatbot_messages
      FOR ALL USING (public.is_admin());
  END IF;
END $$;

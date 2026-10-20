-- 024_chatbot_sessions_realtime.sql
-- Realtime auto-update for the Admin Chatbot Logs page (/admin/chatbot).
-- Adds public.chatbot_sessions to the supabase_realtime publication so INSERT
-- (new conversation) and UPDATE (new turn: message_count/last_active/resolved)
-- events reach subscribed admin browsers. No schema, RLS, or policy changes:
-- existing admin-only RLS on chatbot_sessions stays intact.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'chatbot_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chatbot_sessions;
  END IF;
END $$;

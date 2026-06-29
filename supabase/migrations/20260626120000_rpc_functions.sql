-- Create tables if they don't exist
CREATE TABLE IF NOT EXISTS public.user_plans (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  plan text NOT NULL DEFAULT 'free',
  stripe_customer_id text,
  stripe_subscription_id text,
  subscription_status text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.usage_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  tool_id text NOT NULL,
  pages int NOT NULL DEFAULT 0,
  ip_address text,
  month text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Add missing columns if they don't exist
ALTER TABLE public.usage_logs ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE public.usage_logs ADD COLUMN IF NOT EXISTS tool_id TEXT;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_usage_logs_user_month ON public.usage_logs(user_id, month);
CREATE INDEX IF NOT EXISTS idx_usage_logs_ip_month ON public.usage_logs(ip_address, month);
CREATE INDEX IF NOT EXISTS idx_usage_logs_user_tool_month ON public.usage_logs(user_id, tool_id, month);

-- RPC 1: check_execution_context
CREATE OR REPLACE FUNCTION public.check_execution_context(
  p_user_id uuid, p_ip_address text, p_month text
) RETURNS TABLE(plan text, pages_used bigint, ip_pages_used bigint) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    (SELECT up.plan FROM public.user_plans up WHERE up.user_id = p_user_id LIMIT 1),
    (SELECT COALESCE(SUM(ul.pages), 0) FROM public.usage_logs ul WHERE ul.user_id = p_user_id AND ul.month = p_month),
    (SELECT COALESCE(SUM(ul.pages), 0) FROM public.usage_logs ul WHERE ul.ip_address = p_ip_address AND ul.month = p_month);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC 2: get_usage_summary
CREATE OR REPLACE FUNCTION public.get_usage_summary(p_user_id uuid, p_month text)
RETURNS TABLE(tool_id text, total_pages bigint) AS $$
BEGIN
  RETURN QUERY
  SELECT ul.tool_id, SUM(ul.pages)::bigint
  FROM public.usage_logs ul
  WHERE ul.user_id = p_user_id AND ul.month = p_month
  GROUP BY ul.tool_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC 3: increment_usage
CREATE OR REPLACE FUNCTION public.increment_usage(
  p_user_id uuid, p_tool_id text, p_pages int, p_ip_address text, p_month text
) RETURNS void AS $$
BEGIN
  INSERT INTO public.usage_logs (user_id, tool_id, pages, ip_address, month)
  VALUES (p_user_id, p_tool_id, p_pages, p_ip_address, p_month);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

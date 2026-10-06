BEGIN;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh_key text NOT NULL,
  auth_key text NOT NULL,
  expiration_time bigint,
  user_agent text,
  is_active boolean NOT NULL DEFAULT true,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT push_subscriptions_endpoint_not_blank CHECK (btrim(endpoint) <> ''),
  CONSTRAINT push_subscriptions_p256dh_not_blank CHECK (btrim(p256dh_key) <> ''),
  CONSTRAINT push_subscriptions_auth_not_blank CHECK (btrim(auth_key) <> '')
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_active_idx
  ON push_subscriptions (user_id, is_active);

DROP TRIGGER IF EXISTS push_subscriptions_set_updated_at ON push_subscriptions;
CREATE TRIGGER push_subscriptions_set_updated_at
BEFORE UPDATE ON push_subscriptions
FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();

CREATE TABLE IF NOT EXISTS notification_preferences (
  event_type text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_type, user_id),
  CONSTRAINT notification_preferences_event_valid CHECK (
    event_type IN ('order_new','order_close','bon_new','bon_close','report_new','kvar_check')
  )
);

DROP TRIGGER IF EXISTS notification_preferences_set_updated_at ON notification_preferences;
CREATE TRIGGER notification_preferences_set_updated_at
BEFORE UPDATE ON notification_preferences
FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();

INSERT INTO notification_preferences (event_type,user_id,enabled)
SELECT event_type,users.id,true
FROM unnest(ARRAY['order_new','order_close','bon_new','bon_close','report_new','kvar_check']) AS event_type
CROSS JOIN users
WHERE users.is_active AND users.login_enabled AND lower(btrim(users.role))='admin'
ON CONFLICT (event_type,user_id) DO NOTHING;

COMMIT;

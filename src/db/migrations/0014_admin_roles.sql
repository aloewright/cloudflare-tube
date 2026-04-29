-- ALO-205: persisted admin role table.
--
-- Replaces the ADMIN_EMAILS env-var allow-list with a proper users/roles join
-- so admin status survives email changes, can be granted/revoked at runtime,
-- and is auditable via created_at + granted_by_user_id. ADMIN_EMAILS is kept
-- as a one-time bootstrap fallback so a fresh deploy still has at least one
-- admin who can grant the role to others.

CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'moderator')),
  granted_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, role),
  FOREIGN KEY (user_id) REFERENCES user(id),
  FOREIGN KEY (granted_by_user_id) REFERENCES user(id)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role);

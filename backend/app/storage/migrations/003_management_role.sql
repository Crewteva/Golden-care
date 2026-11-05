-- Owner and General manager become one role: Management (الإدارة).
-- People who held either role keep their access under the new role.

INSERT INTO roles (code, kind, name_ar, name_en, requires_mfa, sort_order)
VALUES ('management', 'staff', 'الإدارة', 'Management', true, 1)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code)
SELECT DISTINCT 'management', permission_code FROM role_permissions WHERE role_code IN ('owner', 'director')
ON CONFLICT DO NOTHING;

INSERT INTO user_roles (user_id, role_code, branch_id, granted_by, granted_at)
SELECT DISTINCT ON (user_id, branch_id) user_id, 'management', branch_id, granted_by, granted_at
FROM user_roles WHERE role_code IN ('owner', 'director')
ORDER BY user_id, branch_id, granted_at
ON CONFLICT DO NOTHING;

UPDATE delegations SET role_code = 'management' WHERE role_code IN ('owner', 'director');
UPDATE sessions SET active_role = 'management' WHERE active_role IN ('owner', 'director');

DELETE FROM user_roles WHERE role_code IN ('owner', 'director');
DELETE FROM role_permissions WHERE role_code IN ('owner', 'director');
DELETE FROM roles WHERE code IN ('owner', 'director');

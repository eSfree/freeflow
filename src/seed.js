const path = require('path');
const { migrate, db } = require('./db/connection');
const { createUser, findUserByEmail, countUsers } = require('./auth/users');
const { reschedule } = require('./scheduling/cpm');

function seed() {
  migrate();
  if (countUsers() > 0) {
    console.log('Database already seeded (users exist). Skipping demo seed.');
    return;
  }
  console.log('Seeding demo data...');

  // Users
  const admin = createUser({ email: 'admin@projectflow.test', password: 'admin123', full_name: 'Demo Admin', role: 'admin' });
  const memberUser = createUser({ email: 'member@projectflow.test', password: 'member123', full_name: 'Demo Member', role: 'member' });

  // Team members (linked to users for member role)
  const insMember = db.prepare('INSERT INTO team_members (user_id, full_name, email, phone, position, salary, joined_at) VALUES (?,?,?,?,?,?,?)');
  const m1 = insMember.run(memberUser.id, 'Demo Member', 'member@projectflow.test', '081200000001', 'Developer', 8000000, '2025-01-15').lastInsertRowid;
  const m2 = insMember.run(null, 'Alice Designer', 'alice@projectflow.test', '081200000002', 'UI/UX Designer', 7500000, '2025-02-01').lastInsertRowid;
  const m3 = insMember.run(null, 'Bob Tester', 'bob@projectflow.test', '081200000003', 'QA Engineer', 6500000, '2025-03-10').lastInsertRowid;

  // Project matching the mandatory CPM test case (Mon-Fri, no holidays)
  const start = '2026-10-05'; // a Monday
  const pid = db.prepare('INSERT INTO projects (name, organization, description, start_date, target_end_date, status, created_by) VALUES (?,?,?,?,?,?,?)')
    .run('Website Redesign', 'Acme Corp', 'Complete redesign of the corporate website with new branding.', start, '2026-10-30', 'active', admin.id).lastInsertRowid;
  db.prepare('INSERT INTO project_calendars (project_id, workweek, weekend_days) VALUES (?,?,?)').run(pid, '1,2,3,4,5', '0,6');

  // A holiday that affects scheduling
  db.prepare('INSERT INTO holidays (project_id, date, name, kind) VALUES (?,?,?,?)').run(pid, '2026-10-14', 'Mid-week Holiday', 'special');

  // Tasks (durations in workdays)
  const insT = db.prepare('INSERT INTO tasks (project_id, name, description, start_date, duration, priority, status, progress) VALUES (?,?,?,?,?,?,?,?)');
  const t1 = insT.run(pid, 'T1 Analysis', 'Requirements analysis', start, 3, 'high', 'completed', 100).lastInsertRowid;
  const t2 = insT.run(pid, 'T2 Database Design', 'Schema design', start, 2, 'medium', 'completed', 100).lastInsertRowid;
  const t3 = insT.run(pid, 'T3 UI Design', 'Mockups and UI', start, 3, 'medium', 'in_progress', 60).lastInsertRowid;
  const t4 = insT.run(pid, 'T4 Programming', 'Frontend + backend build', null, 5, 'high', 'not_started', 0).lastInsertRowid;
  const t5 = insT.run(pid, 'T5 Testing', 'QA and UAT', null, 2, 'medium', 'not_started', 0).lastInsertRowid;

  // Dependencies
  const insD = db.prepare('INSERT INTO task_dependencies (predecessor_id, successor_id, type, lag) VALUES (?,?,?,?)');
  insD.run(t1, t2, 'FS', 0);
  insD.run(t1, t3, 'FS', 0);
  insD.run(t2, t4, 'FS', 0);
  insD.run(t3, t4, 'FS', 0);
  insD.run(t4, t5, 'FS', 0);

  // Assignments
  const insA = db.prepare('INSERT INTO task_assignments (task_id, member_id, role, allocation_pct) VALUES (?,?,?,?)');
  insA.run(t1, m1, 'Analyst', 50);
  insA.run(t2, m1, 'Architect', 50);
  insA.run(t3, m2, 'Designer', 100);
  insA.run(t4, m1, 'Developer', 80);
  insA.run(t5, m3, 'Tester', 100);

  // Leave for Alice during T3
  db.prepare('INSERT INTO member_leaves (member_id, start_date, end_date, type, notes, status) VALUES (?,?,?,?,?,?)')
    .run(m2, '2026-10-08', '2026-10-09', 'annual', 'Planned leave', 'approved');

  // Second, simpler project
  const pid2 = db.prepare('INSERT INTO projects (name, organization, description, start_date, target_end_date, status, created_by) VALUES (?,?,?,?,?,?,?)')
    .run('Mobile App MVP', 'Beta Inc', 'First release of the mobile application.', '2026-11-02', '2026-12-20', 'planning', admin.id).lastInsertRowid;
  db.prepare('INSERT INTO project_calendars (project_id, workweek, weekend_days) VALUES (?,?,?)').run(pid2, '1,2,3,4,5', '0,6');

  // Compute schedules
  reschedule(pid);
  reschedule(pid2);

  console.log('Seed complete.');
  console.log('  Admin login:  admin@projectflow.test / admin123');
  console.log('  Member login: member@projectflow.test / member123');
}

if (require.main === module) seed();
module.exports = { seed };

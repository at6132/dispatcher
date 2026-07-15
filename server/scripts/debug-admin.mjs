import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 15 });
try {
  const challenges = await sql`
    select id, short_code, status, ip, approved_by_chat_id, expires_at, created_at, session_issued_at
    from admin_login_challenges
    order by created_at desc
    limit 10
  `;
  console.log('=== challenges ===');
  console.log(JSON.stringify(challenges, null, 2));

  const security = await sql`
    select at, kind, severity, ip, detail_json
    from security_events
    where kind like 'admin%' or kind like 'telegram%'
    order by at desc
    limit 15
  `;
  console.log('=== security ===');
  console.log(JSON.stringify(security, null, 2));
} finally {
  await sql.end({ timeout: 2 });
}

import { HttpError,database,requireSession,text } from "../lib/core.js";
import { NOTIFICATION_EVENTS,pushConfigured,sendTestNotification } from "../lib/push.js";

const EVENT_KEYS=new Set(NOTIFICATION_EVENTS.map(event=>event.key));

function subscriptionInput(body){
  const source=body.subscription||{};
  const endpoint=text(source.endpoint,5000);
  const p256dh=text(source.keys?.p256dh,1000);
  const auth=text(source.keys?.auth,1000);
  if(!endpoint||!/^https:\/\//i.test(endpoint)||!p256dh||!auth)throw new HttpError(400,"Subscription notifikasi tidak valid.");
  const expirationTime=source.expirationTime!==null&&source.expirationTime!==undefined&&Number.isFinite(Number(source.expirationTime))?Number(source.expirationTime):null;
  return{endpoint,p256dh,auth,expirationTime};
}

async function settings(request,env,body){
  const profile=await requireSession(request,env,body),sql=database(env);
  const [deviceRows,myPreferenceRows]=await Promise.all([
    sql`SELECT count(*)::integer AS count FROM push_subscriptions WHERE user_id=${profile.id} AND is_active`,
    sql`SELECT event_type FROM notification_preferences WHERE user_id=${profile.id} AND enabled ORDER BY event_type`,
  ]);
  const result={
    status:"success",configured:pushConfigured(env),publicKey:env.VAPID_PUBLIC_KEY||"",
    deviceCount:Number(deviceRows[0]?.count||0),events:NOTIFICATION_EVENTS,
    myEvents:myPreferenceRows.map(row=>row.event_type),isAdmin:String(profile.role).toLowerCase()==="admin",
  };
  if(result.isAdmin){
    const [users,preferences]=await Promise.all([
      sql`SELECT users.id,users.full_name,users.role,users.department,count(subscriptions.id)::integer AS device_count
          FROM users LEFT JOIN push_subscriptions subscriptions ON subscriptions.user_id=users.id AND subscriptions.is_active
          WHERE users.is_active AND users.login_enabled
          GROUP BY users.id,users.full_name,users.role,users.department
          ORDER BY users.full_name`,
      sql`SELECT event_type,user_id FROM notification_preferences WHERE enabled ORDER BY event_type,user_id`,
    ]);
    result.users=users.map(user=>({id:user.id,nama:user.full_name,role:user.role,bagian:user.department||"",deviceCount:Number(user.device_count||0)}));
    result.selections=Object.fromEntries(NOTIFICATION_EVENTS.map(event=>[
      event.key,preferences.filter(item=>item.event_type===event.key).map(item=>String(item.user_id)),
    ]));
  }
  return result;
}

async function subscribe(request,env,body){
  const profile=await requireSession(request,env,body),value=subscriptionInput(body),sql=database(env);
  await sql`
    INSERT INTO push_subscriptions(user_id,endpoint,p256dh_key,auth_key,expiration_time,user_agent,is_active,last_error)
    VALUES(${profile.id},${value.endpoint},${value.p256dh},${value.auth},${value.expirationTime},${text(request.headers.get("User-Agent"),1000)},true,NULL)
    ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,p256dh_key=excluded.p256dh_key,
      auth_key=excluded.auth_key,expiration_time=excluded.expiration_time,user_agent=excluded.user_agent,is_active=true,last_error=NULL
  `;
  return{status:"success",message:"Notifikasi perangkat berhasil diaktifkan."};
}

async function unsubscribe(request,env,body){
  const profile=await requireSession(request,env,body),endpoint=text(body.endpoint,5000),sql=database(env);
  if(endpoint)await sql`UPDATE push_subscriptions SET is_active=false WHERE user_id=${profile.id} AND endpoint=${endpoint}`;
  else await sql`UPDATE push_subscriptions SET is_active=false WHERE user_id=${profile.id}`;
  return{status:"success",message:"Notifikasi perangkat dinonaktifkan."};
}

async function saveRecipients(request,env,body){
  const profile=await requireSession(request,env,body,["Admin"]),sql=database(env),source=body.selections||{};
  const users=await sql`SELECT id::text AS id FROM users WHERE is_active AND login_enabled`;
  const allowedUsers=new Set(users.map(user=>user.id)),rows=[];
  NOTIFICATION_EVENTS.forEach(event=>{
    const ids=Array.isArray(source[event.key])?source[event.key]:[];
    [...new Set(ids.map(String))].forEach(userId=>{if(allowedUsers.has(userId))rows.push({eventType:event.key,userId});});
  });
  const queries=[sql`DELETE FROM notification_preferences`];
  rows.forEach(row=>queries.push(sql`
    INSERT INTO notification_preferences(event_type,user_id,enabled,updated_by)
    VALUES(${row.eventType},${row.userId},true,${profile.id})
  `));
  await sql.transaction(queries);
  return{status:"success",message:`Pengaturan ${rows.length} penerima notifikasi berhasil disimpan.`,data:{recipientRules:rows.length}};
}

async function testPush(request,env,body){
  const profile=await requireSession(request,env,body);
  const result=await sendTestNotification(env,profile.id);
  if(!result.configured)throw new HttpError(503,"Kunci Web Push belum dikonfigurasi pada Worker.");
  if(!result.sent)throw new HttpError(409,"Belum ada perangkat aktif untuk akun ini.");
  return{status:"success",message:"Notifikasi percobaan berhasil dikirim.",data:result};
}

export async function handleNotifications({request,env,resource,body}){
  if(resource!=="notifications")return null;
  const action=text(body.action,50)||"getSettings";
  if(action==="getSettings")return settings(request,env,body);
  if(action==="subscribe")return subscribe(request,env,body);
  if(action==="unsubscribe")return unsubscribe(request,env,body);
  if(action==="saveRecipients")return saveRecipients(request,env,body);
  if(action==="test")return testPush(request,env,body);
  throw new HttpError(400,"Aksi notifikasi tidak dikenal.");
}

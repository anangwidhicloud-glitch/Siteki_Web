import webpush from "web-push";
import { database } from "./core.js";

export const NOTIFICATION_EVENTS = [
  {key:"order_new",label:"Order baru",description:"Order kerja baru dibuat"},
  {key:"order_close",label:"Order Close",description:"Order kerja diselesaikan"},
  {key:"bon_new",label:"Bon baru",description:"Bon Pesan baru dibuat"},
  {key:"bon_close",label:"Bon Close",description:"Seluruh barang dalam bon sudah Close"},
  {key:"report_new",label:"Laporan baru",description:"Laporan kerja baru disimpan"},
  {key:"kvar_check",label:"Pengecekan kVAr",description:"Pemeriksaan meter kVAr baru disimpan"},
];

const EVENT_KEYS=new Set(NOTIFICATION_EVENTS.map(event=>event.key));

export function pushConfigured(env){
  return Boolean(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY&&env.VAPID_SUBJECT);
}

function configure(env){
  if(!pushConfigured(env))return false;
  webpush.setVapidDetails(env.VAPID_SUBJECT,env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_KEY);
  return true;
}

async function updateDeliveryState(sql,successEndpoints,failedEndpoints){
  if(successEndpoints.length)await sql.query(
    `UPDATE push_subscriptions SET is_active=true,last_success_at=now(),last_error=NULL WHERE endpoint=ANY($1::text[])`,
    [successEndpoints]
  );
  if(failedEndpoints.length)await sql.query(
    `UPDATE push_subscriptions SET is_active=false,last_error='Subscription browser tidak berlaku lagi' WHERE endpoint=ANY($1::text[])`,
    [failedEndpoints]
  );
}

async function deliver(env,subscriptions,payload){
  if(!subscriptions.length||!configure(env))return{sent:0,failed:0,configured:pushConfigured(env)};
  const encoded=JSON.stringify(payload);
  const results=await Promise.allSettled(subscriptions.map(subscription=>webpush.sendNotification({
    endpoint:subscription.endpoint,
    expirationTime:subscription.expiration_time?Number(subscription.expiration_time):null,
    keys:{p256dh:subscription.p256dh_key,auth:subscription.auth_key},
  },encoded,{TTL:3600,urgency:"normal"})));
  const successEndpoints=[],failedEndpoints=[];
  results.forEach((result,index)=>{
    if(result.status==="fulfilled")successEndpoints.push(subscriptions[index].endpoint);
    else if([404,410].includes(Number(result.reason?.statusCode)))failedEndpoints.push(subscriptions[index].endpoint);
    else console.error("Push SiTeki gagal",result.reason?.statusCode||"",result.reason?.message||result.reason);
  });
  await updateDeliveryState(database(env),successEndpoints,failedEndpoints);
  return{sent:successEndpoints.length,failed:results.length-successEndpoints.length,configured:true};
}

export async function sendSystemNotification(env,event){
  if(!EVENT_KEYS.has(event.type))throw new Error(`Jenis notifikasi ${event.type} tidak dikenal.`);
  const sql=database(env);
  const subscriptions=await sql`
    SELECT subscriptions.endpoint,subscriptions.p256dh_key,subscriptions.auth_key,subscriptions.expiration_time
    FROM notification_preferences preferences
    JOIN users ON users.id=preferences.user_id AND users.is_active AND users.login_enabled
    JOIN push_subscriptions subscriptions ON subscriptions.user_id=preferences.user_id AND subscriptions.is_active
    WHERE preferences.event_type=${event.type} AND preferences.enabled
  `;
  return deliver(env,subscriptions,{
    title:event.title||"SiTeki",
    body:event.body||"Ada data baru di SiTeki.",
    icon:"./siteki-icon.svg",
    badge:"./siteki-icon.svg",
    tag:`siteki-${event.type}-${event.entityId||Date.now()}`,
    url:event.url||"./",
    eventType:event.type,
  });
}

export async function sendTestNotification(env,userId){
  const sql=database(env);
  const subscriptions=await sql`
    SELECT endpoint,p256dh_key,auth_key,expiration_time
    FROM push_subscriptions WHERE user_id=${userId} AND is_active
  `;
  return deliver(env,subscriptions,{
    title:"Notifikasi SiTeki aktif",
    body:"Perangkat ini siap menerima pemberitahuan meskipun situs sedang tidak dibuka.",
    icon:"./siteki-icon.svg",badge:"./siteki-icon.svg",tag:`siteki-test-${Date.now()}`,url:"./?open=settings",
  });
}

export function queueSystemNotification(executionCtx,promise){
  const safe=Promise.resolve(promise).catch(error=>console.error("Notifikasi SiTeki gagal diproses",error?.stack||error));
  if(executionCtx?.waitUntil)executionCtx.waitUntil(safe);
  return safe;
}

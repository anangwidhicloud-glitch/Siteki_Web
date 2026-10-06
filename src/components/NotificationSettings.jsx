import React,{useEffect,useMemo,useState} from "react";
import { AlertTriangle,Bell,Check,Send,ShieldCheck,Smartphone } from "lucide-react";
import { apiPost,asArray,ENDPOINTS,isSuccess } from "../lib/api";
import { useRemoteData } from "../hooks/useRemoteData";

function publicKeyBytes(value){
  const padding="=".repeat((4-value.length%4)%4),base64=(value+padding).replace(/-/g,"+").replace(/_/g,"/");
  const raw=atob(base64);return Uint8Array.from([...raw].map(character=>character.charCodeAt(0)));
}

async function serviceWorkerRegistration(){
  const url=new URL(`${import.meta.env.BASE_URL}sw.js`,window.location.href);
  return navigator.serviceWorker.register(url.href,{scope:new URL(import.meta.env.BASE_URL,window.location.href).pathname});
}

export function NotificationSettings({session,notify}){
  const supported=typeof window!=="undefined"&&"serviceWorker" in navigator&&"PushManager" in window&&"Notification" in window;
  const [currentSubscription,setCurrentSubscription]=useState(null),[busy,setBusy]=useState("");
  const [selections,setSelections]=useState({});
  const remote=useRemoteData(()=>apiPost(ENDPOINTS.notifications,{action:"getSettings",token:session.token},{timeout:90000}),[session.token]);
  const events=asArray(remote.data?.events),users=asArray(remote.data?.users),isAdmin=Boolean(remote.data?.isAdmin);
  useEffect(()=>{if(remote.data?.selections)setSelections(remote.data.selections);},[remote.data]);
  useEffect(()=>{
    if(!supported)return;
    navigator.serviceWorker.getRegistration().then(registration=>registration?.pushManager.getSubscription()).then(value=>setCurrentSubscription(value||null)).catch(()=>{});
  },[supported]);
  const selectedTotal=useMemo(()=>events.reduce((total,event)=>total+asArray(selections[event.key]).length,0),[events,selections]);
  const activate=async()=>{
    if(!supported)return notify("Browser ini belum mendukung Web Push.");
    if(!remote.data?.configured||!remote.data?.publicKey)return notify("Kunci Web Push belum aktif pada server.");
    setBusy("activate");
    try{
      const permission=await Notification.requestPermission();
      if(permission!=="granted")throw new Error("Izin notifikasi belum diberikan pada browser.");
      const registration=await serviceWorkerRegistration();
      let subscription=await registration.pushManager.getSubscription();
      if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:publicKeyBytes(remote.data.publicKey)});
      const result=await apiPost(ENDPOINTS.notifications,{action:"subscribe",token:session.token,subscription:subscription.toJSON()},{timeout:90000});
      if(!isSuccess(result))throw new Error(result?.message||"Perangkat gagal diaktifkan.");
      setCurrentSubscription(subscription);notify(result.message);await remote.reload();
    }catch(error){notify(error?.message||"Notifikasi perangkat gagal diaktifkan.");}
    finally{setBusy("");}
  };
  const deactivate=async()=>{
    if(!currentSubscription)return;
    setBusy("deactivate");
    try{
      const endpoint=currentSubscription.endpoint;
      const result=await apiPost(ENDPOINTS.notifications,{action:"unsubscribe",token:session.token,endpoint},{timeout:90000});
      if(!isSuccess(result))throw new Error(result?.message||"Notifikasi gagal dinonaktifkan.");
      await currentSubscription.unsubscribe();setCurrentSubscription(null);notify(result.message);await remote.reload();
    }catch(error){notify(error?.message||"Notifikasi gagal dinonaktifkan.");}
    finally{setBusy("");}
  };
  const test=async()=>{
    setBusy("test");
    try{const result=await apiPost(ENDPOINTS.notifications,{action:"test",token:session.token},{timeout:90000});if(!isSuccess(result))throw new Error(result?.message||"Notifikasi percobaan gagal.");notify(result.message);}
    catch(error){notify(error?.message||"Notifikasi percobaan gagal.");}
    finally{setBusy("");}
  };
  const toggle=(eventKey,userId)=>setSelections(current=>{const values=new Set(asArray(current[eventKey]).map(String));values.has(String(userId))?values.delete(String(userId)):values.add(String(userId));return{...current,[eventKey]:[...values]};});
  const toggleEvent=eventKey=>setSelections(current=>{const currentIds=new Set(asArray(current[eventKey]).map(String)),all=users.length>0&&users.every(user=>currentIds.has(String(user.id)));return{...current,[eventKey]:all?[]:users.map(user=>String(user.id))};});
  const save=async()=>{
    setBusy("save");
    try{const result=await apiPost(ENDPOINTS.notifications,{action:"saveRecipients",token:session.token,selections},{timeout:120000});if(!isSuccess(result))throw new Error(result?.message||"Penerima gagal disimpan.");notify(result.message);await remote.reload();}
    catch(error){notify(error?.message||"Penerima notifikasi gagal disimpan.");}
    finally{setBusy("");}
  };
  return <section className="push-settings">
    <div className="push-settings-heading"><span className="icon-box mint"><Bell size={20}/></span><div><p className="eyebrow">Web Push</p><h3>Notifikasi perangkat</h3><small>Terima pemberitahuan sistem meskipun situs sedang tidak dibuka.</small></div></div>
    <div className={`push-device-card ${currentSubscription?"active":""}`}><span><Smartphone size={21}/></span><div><b>{currentSubscription?"Perangkat ini aktif":"Aktifkan perangkat ini"}</b><small>{!supported?"Browser tidak mendukung Web Push.":currentSubscription?`${Number(remote.data?.deviceCount||1)} perangkat terhubung ke akun ini.`:"Browser akan meminta izin notifikasi satu kali."}</small></div><div className="push-device-actions">{currentSubscription?<><button type="button" className="secondary" disabled={!!busy} onClick={test}><Send size={15}/>{busy==="test"?"Mengirim…":"Tes"}</button><button type="button" className="secondary" disabled={!!busy} onClick={deactivate}>Nonaktifkan</button></>:<button type="button" className="primary" disabled={!!busy||!supported||remote.loading} onClick={activate}><Bell size={15}/>{busy==="activate"?"Mengaktifkan…":"Aktifkan notifikasi"}</button>}</div></div>
    {!remote.data?.configured&&!remote.loading&&<div className="push-warning"><AlertTriangle size={16}/><span>Kunci VAPID belum tersambung ke Worker. Pengaturan penerima dapat disimpan, tetapi push belum dapat dikirim.</span></div>}
    {isAdmin&&<div className="push-admin-settings"><div className="push-admin-head"><div><p className="eyebrow">Khusus Admin</p><h3>Pilih penerima</h3><small>{selectedTotal} aturan penerima aktif. User dengan 0 perangkat perlu mengaktifkan notifikasi pada HP atau PC-nya.</small></div><button type="button" className="primary" disabled={!!busy||remote.loading} onClick={save}><Check size={16}/>{busy==="save"?"Menyimpan…":"Simpan penerima"}</button></div>
      {remote.loading?<div className="remote-state"><span className="spinner dark"/>Memuat pengaturan…</div>:remote.error?<div className="remote-error"><AlertTriangle size={16}/>{remote.error}</div>:<div className="push-recipient-table"><table><thead><tr><th>Nama user</th>{events.map(event=>{const ids=new Set(asArray(selections[event.key]).map(String)),all=users.length>0&&users.every(user=>ids.has(String(user.id)));return <th key={event.key}><button type="button" className={all?"checked":""} onClick={()=>toggleEvent(event.key)} title={event.description}><span>{all&&<Check size={11}/>}</span>{event.label}</button></th>})}</tr></thead><tbody>{users.map(user=><tr key={user.id}><td><b>{user.nama}</b><small>{[user.role,user.bagian].filter(Boolean).join(" · ")} · {user.deviceCount} perangkat</small></td>{events.map(event=>{const checked=asArray(selections[event.key]).map(String).includes(String(user.id));return <td key={event.key}><label title={`${event.label} untuk ${user.nama}`}><input type="checkbox" checked={checked} onChange={()=>toggle(event.key,user.id)}/><span>{checked&&<Check size={12}/>}</span></label></td>})}</tr>)}</tbody></table></div>}
      <p className="push-security-note"><ShieldCheck size={15}/> Hanya Admin yang dapat mengubah penerima. Setiap user tetap mengendalikan izin pada perangkatnya sendiri.</p>
    </div>}
  </section>;
}

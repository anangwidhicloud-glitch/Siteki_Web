self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));

self.addEventListener("push",event=>{
  let data={};
  try{data=event.data?.json?.()||{};}catch{data={body:event.data?.text?.()||"Ada pembaruan di SiTeki."};}
  const icon=new URL("siteki-icon.svg",self.registration.scope).href;
  event.waitUntil(self.registration.showNotification(data.title||"SiTeki",{
    body:data.body||"Ada data baru di SiTeki.",
    icon,badge:icon,tag:data.tag||`siteki-${Date.now()}`,renotify:true,
    data:{url:data.url||"./",eventType:data.eventType||""},
  }));
});

self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const target=new URL(event.notification.data?.url||"./",self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(async clients=>{
    for(const client of clients){
      if(new URL(client.url).origin===new URL(target).origin){await client.navigate(target);return client.focus();}
    }
    return self.clients.openWindow(target);
  }));
});

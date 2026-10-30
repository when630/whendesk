const {contextBridge,ipcRenderer}=require('electron');
const methods=new Set(['state','mutate','command.query','command.run','command.refresh','shell','preferences.get','preferences.set','app.info','data.export','data.exportIcs','data.restore','data.importLegacy','data.openFolder','note.attachFile','note.openAttachment','note.openExternal','note.export','media.state','media.control','update.state','update.check','update.install','window.minimize','window.close','app.quit']);
const events=new Set(['command.more','navigate','media.changed','state.changed','shell.changed','update.changed']);
async function request(method,payload){if(!methods.has(method))throw new Error('허용하지 않는 요청입니다.');return ipcRenderer.invoke('desk:call',method,payload);}
contextBridge.exposeInMainWorld('desk',Object.freeze({
 request,
 async call(method,payload){const result=await request(method,payload);if(!result?.ok)throw new Error(result?.error||'요청에 실패했습니다.');return result.value;},
 on(event,callback){if(!events.has(event)||typeof callback!=='function')return ()=>{};const listener=(_event,payload)=>callback(payload);ipcRenderer.on(event,listener);return ()=>ipcRenderer.removeListener(event,listener);},
}));

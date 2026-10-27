(() => {
  'use strict';
  const $=(id)=>document.getElementById(id);
  if(!$('moment-dialog'))return;
  const MAX_BYTES=24*1024*1024;
  const formats=new Set(['audio/mp4','audio/webm','audio/ogg','audio/mpeg','audio/wav','audio/aac','video/mp4','video/webm','video/quicktime']);
  const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  const dateLabel=(value)=>new Intl.DateTimeFormat(undefined,{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(value+'T12:00:00'));
  const time=(ms)=>`${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;
  const message=(words)=>$('moment-feedback').textContent=words||'';
  const json=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  let options,kind='audio',mode='capture',blob=null,blobUrl=null,durationMs=0,requestId=null,pendingId=null,page=null;
  let stream=null,recorder=null,chunks=[],chunkBytes=0,timer=null,activeSince=0,activeElapsed=0,acquiring=false,saving=false,finishing=false,lastElapsed=0,generation=0,editDirty=false,stopNote='';
  const recording=()=>recorder&&recorder.state!=='inactive';
  const elapsed=()=>activeElapsed+(recording()&&recorder.state!=='paused'?performance.now()-activeSince:0);
  const maxMs=()=>kind==='video'?180000:600000;
  async function api(path,init={}){
    const response=await options.apiFetch(path,init),data=await response.json().catch(()=>({}));
    if(!response.ok){const error=new Error(data.error||'Couldn’t finish that. Please try again.');error.newUpload=data.newUpload;throw error;}
    return data;
  }
  function setPrivacy(scope){$('moment-privacy').textContent=scope==='shared'?'♡ Our Journal · both of you can open this moment':'⌑ My Journal · only you can open this moment';}
  function stopTracks(){
    if(timer){clearInterval(timer);timer=null;}
    if(stream){stream.getTracks().forEach((track)=>{track.onended=null;track.stop();});stream=null;}
    $('moment-live').srcObject=null;$('moment-live').hidden=true;
  }
  function clearPlayers(id){const host=$(id);host.querySelectorAll('audio,video').forEach((node)=>{node.pause();node.removeAttribute('src');node.load();});host.replaceChildren();}
  function releaseBlob(){clearPlayers('moment-preview');if(blobUrl)URL.revokeObjectURL(blobUrl);blob=null;blobUrl=null;durationMs=0;requestId=null;pendingId=null;}
  function playback(hostId,type,url){
    clearPlayers(hostId);const player=document.createElement(type==='video'?'video':'audio');player.controls=true;player.preload='metadata';player.playsInline=true;player.src=url;
    player.addEventListener('error',()=>message('This recording couldn’t play here. Reload it, or try a browser that supports its original format.'));
    $(hostId).append(player);return player;
  }
  function showCopyLink(){
    $('moment-preview').querySelector('.moment-copy-link')?.remove();if(!blobUrl)return;
    const link=document.createElement('a');link.className='moment-copy-link';link.textContent='Keep a copy on this device ↗';link.href=blobUrl;
    const extensions={'audio/mp4':'m4a','video/mp4':'mp4','audio/webm':'webm','video/webm':'webm','video/quicktime':'mov','audio/ogg':'ogg','audio/mpeg':'mp3','audio/wav':'wav','audio/aac':'aac'};
    link.download=`closr-moment-${$('moment-date').value||today()}.${extensions[blob.type]||'webm'}`;$('moment-preview').append(link);
  }
  function update(){
    const live=recording(),hasBlob=Boolean(blob),paused=live&&recorder.state==='paused';
    $('moment-modes').disabled=live||finishing||acquiring||saving||hasBlob;
    document.querySelectorAll('[data-moment-kind]').forEach((node)=>node.setAttribute('aria-pressed',String(node.dataset.momentKind===kind)));
    $('moment-start').hidden=live||hasBlob;$('moment-start').disabled=finishing||acquiring||saving||!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder;
    $('moment-start').textContent=acquiring?(kind==='video'?'Opening camera…':'Opening microphone…'):'● Start recording';
    $('moment-stop').hidden=!live;$('moment-pause').hidden=!live;$('moment-pause').textContent=paused?'Resume':'Pause';
    $('moment-again').hidden=!hasBlob||live;$('moment-again').disabled=saving||acquiring||!window.MediaRecorder||!navigator.mediaDevices?.getUserMedia;
    $('moment-file-label').hidden=live||finishing||saving||acquiring;$('moment-file').disabled=saving;
    $('moment-file').accept=kind==='video'?'video/*':'audio/*';
    $('moment-fields').disabled=live||finishing||acquiring||saving;
    $('moment-idle-art').hidden=hasBlob||(live&&kind==='video');
    $('moment-preview').hidden=!hasBlob||live;
    $('moment-clock').hidden=hasBlob&&!live;$('moment-record-dot').hidden=!live;
    $('moment-stage').classList.toggle('is-recording',Boolean(live&&!paused));$('moment-stage').classList.toggle('is-paused',Boolean(paused));
    $('moment-save').disabled=saving||finishing||acquiring||live||(mode==='capture'&&(!hasBlob||blob.size>MAX_BYTES));
    $('moment-save').textContent=saving?'Saving your moment…':mode==='edit'?'Save changes':options?.scope==='shared'?'Save to our diary':'Save to my diary';
    $('moment-discard').disabled=saving;$('moment-close').disabled=saving;
    $('moment-limit').textContent=`Up to ${kind==='video'?'3':'10'} minutes · 24 MB. Keep Closr open while recording. Record when everyone is comfortable.`;
    if(mode==='capture'&&!live&&!acquiring&&!hasBlob&&!window.MediaRecorder)message('This browser can’t record directly. You can choose an existing recording below.');
  }
  async function cleanPending(id){if(id)try{await api(`/api/journal/recordings/${id}`,{method:'DELETE'});}catch{/* Saved entries are kept; expired unfinished uploads are cleaned on the next save. */}}
  function open(newOptions){
    if(!newOptions.canWrite){window.showToast?.('Connect your partner for Our Journal, or record privately in My Journal.');return;}
    ++generation;options=newOptions;if(!options.storageConfigured){window.showToast?.('Recording storage isn’t connected yet.');return;}
    mode='capture';page=null;kind='audio';editDirty=false;releaseBlob();clearPlayers('moment-saved-media');message('');
    $('moment-capture').hidden=false;$('moment-form').hidden=false;$('moment-saved-media').hidden=true;$('moment-view-story').hidden=true;
    $('moment-heading').textContent='Record a moment.';$('moment-title').value='';$('moment-note').value='';$('moment-date').value=today();$('moment-elapsed').textContent='00:00';
    $('moment-discard').textContent='Discard';setPrivacy(options.scope);update();$('moment-dialog').showModal();
  }
  function chooseMime(){
    const choices=kind==='video'?['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4','video/webm;codecs=vp8,opus','video/webm']:
      ['audio/mp4','audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'];
    return choices.find((type)=>MediaRecorder.isTypeSupported(type))||'';
  }
  async function start(){
    if(acquiring||saving||finishing||recording())return;
    const thisGeneration=++generation;acquiring=true;message('');update();
    let acquired;
    try{
      acquired=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:kind==='video'?{facingMode:'user',width:{ideal:960},height:{ideal:540},frameRate:{ideal:24,max:30}}:false});
      if(generation!==thisGeneration||!$('moment-dialog').open){acquired.getTracks().forEach((track)=>track.stop());return;}
      const mimeType=chooseMime(),config={audioBitsPerSecond:64000,...(kind==='video'?{videoBitsPerSecond:900000}:{}),...(mimeType?{mimeType}:{})};
      const next=new MediaRecorder(acquired,config),base=next.mimeType.split(';')[0].toLowerCase();
      if(!formats.has(base)||!base.startsWith(kind+'/'))throw new Error('This browser’s recording format isn’t supported. Choose a saved MP4 or audio recording instead.');
      const oldPending=pendingId;releaseBlob();cleanPending(oldPending);stream=acquired;recorder=next;chunks=[];chunkBytes=0;activeElapsed=0;lastElapsed=0;activeSince=performance.now();stopNote='';
      recorder.ondataavailable=(event)=>{if(event.data.size){chunks.push(event.data);chunkBytes+=event.data.size;if(chunkBytes>MAX_BYTES-512*1024&&recording())stop('The size limit is close. Your moment has been stopped for preview.');}};
      recorder.onerror=()=>stop('Recording was interrupted. Preview what was captured.');
      recorder.onstop=()=>{
        const data=new Blob(chunks,{type:base});chunks=[];stopTracks();finishing=false;
        if(generation!==thisGeneration)return;
        if(!data.size){message('No sound or video was captured. Try again or choose a saved recording.');update();return;}
        blob=data;blobUrl=URL.createObjectURL(blob);durationMs=Math.max(1,Math.min(maxMs(),Math.round(Math.max(activeElapsed,lastElapsed))));requestId=crypto.randomUUID();pendingId=null;
        playback('moment-preview',kind,blobUrl);showCopyLink();
        message(blob.size>MAX_BYTES?'This clip is over 24 MB. Keep a copy on your device, then record a shorter moment.':stopNote||'Your moment is ready. Play it back, add a name, and save when you’re happy.');update();
      };
      acquired.getTracks().forEach((track)=>track.onended=()=>{if(recording())stop('The microphone or camera stopped. Your captured moment is ready to preview.');});
      if(kind==='video'){$('moment-live').srcObject=acquired;$('moment-live').hidden=false;$('moment-live').play().catch(()=>{});}
      recorder.start(1000);timer=setInterval(()=>{const ms=elapsed();lastElapsed=ms;$('moment-elapsed').textContent=time(ms);if(ms>=maxMs())stop('Your clip reached the time limit and is ready to preview.');},250);
    }catch(error){acquired?.getTracks().forEach((track)=>track.stop());if(generation!==thisGeneration)return;stopTracks();const errors={NotAllowedError:'Microphone or camera access wasn’t allowed. Enable it for Closr in your browser settings, or choose an existing recording.',NotFoundError:'No microphone or camera was found. You can choose an existing recording.',NotReadableError:'The microphone or camera is in use elsewhere. Close that recording and try again.'};message(errors[error.name]||error.message||'Couldn’t start recording. Try choosing an existing recording.');}
    finally{if(generation===thisGeneration){acquiring=false;update();}}
  }
  function stop(note=''){
    if(!recording())return;activeElapsed=elapsed();stopNote=note;finishing=true;try{recorder.stop();}catch{finishing=false;stopTracks();message('Recording stopped unexpectedly. Try choosing a saved clip.');}update();
  }
  $('moment-start').addEventListener('click',start);$('moment-again').addEventListener('click',start);
  $('moment-stop').addEventListener('click',()=>stop());
  $('moment-pause').addEventListener('click',()=>{
    if(!recording())return;try{if(recorder.state==='paused'){activeSince=performance.now();recorder.resume();}else{activeElapsed=elapsed();recorder.pause();}update();}catch{message('Pausing isn’t available in this browser. Stop to keep the current moment.');}
  });
  document.querySelectorAll('[data-moment-kind]').forEach((node)=>node.addEventListener('click',()=>{if(blob||recording()||acquiring||saving)return;kind=node.dataset.momentKind;$('moment-idle-art').querySelector('span').textContent=kind==='video'?'▷':'♩';message('');update();}));
  function fileType(file){
    let type=file.type.split(';')[0].toLowerCase();type=({'audio/x-m4a':'audio/mp4','audio/x-wav':'audio/wav','audio/mp3':'audio/mpeg'})[type]||type;
    if(!type||type==='application/octet-stream'){const ext=file.name.split('.').pop().toLowerCase();type=({m4a:'audio/mp4',mp3:'audio/mpeg',wav:'audio/wav',aac:'audio/aac',ogg:'audio/ogg',mp4:'video/mp4',mov:'video/quicktime',webm:kind+'/webm'})[ext]||'';}
    return type;
  }
  async function fileDuration(file,type){
    const url=URL.createObjectURL(file),media=document.createElement(type.startsWith('video/')?'video':'audio');
    try{return await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('Couldn’t read this clip’s length. Try an MP4 video or M4A/MP3 audio file.')),10000);
      media.preload='metadata';media.onloadedmetadata=()=>{clearTimeout(timeout);Number.isFinite(media.duration)&&media.duration>0?resolve(Math.round(media.duration*1000)):reject(new Error('The clip’s length could not be read. Try MP4, M4A or MP3.'));};
      media.onerror=()=>{clearTimeout(timeout);reject(new Error('This clip can’t be opened here. Try MP4 video or M4A/MP3 audio.'));};media.src=url;
    });}finally{media.removeAttribute('src');media.load();URL.revokeObjectURL(url);}
  }
  $('moment-file').addEventListener('change',async(event)=>{
    const file=event.target.files?.[0];event.target.value='';if(!file||saving||recording())return;
    const thisGeneration=++generation;acquiring=true;message('Opening your recording…');update();
    try{
      const type=fileType(file);if(!formats.has(type)||!type.startsWith(kind+'/'))throw new Error(`Choose ${kind==='video'?'an MP4, MOV or WebM video':'an M4A, MP3, WAV, AAC, Ogg or WebM audio recording'}.`);
      if(file.size>MAX_BYTES||file.size<16)throw new Error('Choose a recording up to 24 MB.');
      const length=await fileDuration(file,type);if(length>maxMs())throw new Error(`Choose a clip up to ${kind==='video'?'3':'10'} minutes long.`);
      if(generation!==thisGeneration||!$('moment-dialog').open)return;
      const oldPending=pendingId;releaseBlob();cleanPending(oldPending);blob=new Blob([file],{type});blobUrl=URL.createObjectURL(blob);durationMs=length;requestId=crypto.randomUUID();pendingId=null;
      playback('moment-preview',kind,blobUrl);showCopyLink();message('Your recording is ready to preview. Add a name and save it to your diary.');
    }catch(error){if(generation===thisGeneration)message(error.message);}
    finally{if(generation===thisGeneration){acquiring=false;update();}}
  });
  function entryView(){
    mode='view';editDirty=false;$('moment-heading').textContent=page.title;setPrivacy(page.scope);
    $('moment-capture').hidden=true;$('moment-form').hidden=true;$('moment-view-story').hidden=false;$('moment-saved-media').hidden=false;
    $('moment-view-date').textContent=dateLabel(page.dateFrom);$('moment-view-note').textContent=page.description;$('moment-view-note').hidden=!page.description;
  }
  async function loadEntry(id){
    const viewGeneration=generation;const [entry,content]=await Promise.all([api(`/api/journal/pages/${id}`),api(`/api/journal/recordings/page/${id}`)]);
    if(viewGeneration!==generation||!$('moment-dialog').open)return;kind=content.recording.kind;page=entry.page;entryView();playback('moment-saved-media',content.recording.kind,content.recording.url);message('');
  }
  async function openEntry(id,newOptions){
    if(recording()||saving||finishing)return;++generation;page=null;options=newOptions;mode='view';releaseBlob();stopTracks();clearPlayers('moment-saved-media');message('Opening your moment…');
    $('moment-heading').textContent='A little moment.';$('moment-capture').hidden=true;$('moment-form').hidden=true;$('moment-view-story').hidden=true;$('moment-saved-media').hidden=true;setPrivacy(options.scope);
    if(!$('moment-dialog').open)$('moment-dialog').showModal();
    try{await loadEntry(id);}catch(error){message(error.message);}
  }
  $('moment-refresh').addEventListener('click',async()=>{if(!page)return;message('Reloading your recording…');try{await loadEntry(page.id);}catch(error){message(error.message);}});
  $('moment-edit').addEventListener('click',()=>{
    if(!page)return;mode='edit';editDirty=false;$('moment-view-story').hidden=true;$('moment-form').hidden=false;
    $('moment-title').value=page.title;$('moment-date').value=page.dateFrom;$('moment-note').value=page.description;$('moment-discard').textContent='Cancel edits';update();
  });
  $('moment-form').addEventListener('input',()=>{if(mode==='edit')editDirty=true;});
  $('moment-form').addEventListener('submit',async(event)=>{
    event.preventDefault();if(saving||acquiring||recording()||(mode==='capture'&&!blob))return;
    let savedPageId=null;saving=true;message(mode==='edit'?'Saving your changes…':'Saving the original recording to your diary…');update();
    try{
      const title=$('moment-title').value.trim()||(kind==='video'?'A video moment':'A voice moment'),date=$('moment-date').value,note=$('moment-note').value;
      if(mode==='edit'){
        const payload={scope:page.scope,kind:page.kind,title,dateFrom:date,dateTo:date,description:note,feeling:page.feeling,folderId:page.folderId,hasCanvas:page.hasCanvas,design:JSON.parse(JSON.stringify(page.design)),revision:page.revision};
        // Any optional canvas words should keep the same heading/story metadata.
        payload.design.nodes.forEach((node)=>{if(node.role==='title')node.text=title;if(node.role==='story')node.text=note;if(node.role==='date')node.text=dateLabel(date);});
        const result=await api(`/api/journal/pages/${page.id}`,json('PUT',payload));page=result.page;entryView();message('Your entry is saved.');await options.onSaved?.();
      }else{
        const prepared=await api('/api/journal/recordings',json('POST',{id:requestId,scope:options.scope,folderId:options.folderId||null,kind,contentType:blob.type,bytes:blob.size,durationMs,title,date,note}));
        pendingId=prepared.id;let pageId=prepared.pageId;
        if(!prepared.alreadySaved){message('Uploading your moment… Keep this page open.');const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),175000);try{const saved=await api(prepared.uploadPath,{method:'PUT',headers:{'Content-Type':blob.type},body:blob,signal:controller.signal});pageId=saved.pageId;}finally{clearTimeout(timeout);}}
        savedPageId=pageId;releaseBlob();await options.onSaved?.();await loadEntry(pageId);message('Saved in your diary. Come back and replay it whenever you like.');
      }
    }catch(error){if(error.newUpload){requestId=crypto.randomUUID();pendingId=null;}message(savedPageId?'Your moment was saved, but playback couldn’t load. Close this window and reopen the entry in your journal.':error.message||'Couldn’t save yet. Your preview is still here.');}
    finally{saving=false;update();}
  });
  function close(){
    if(saving||finishing)return;
    if(recording()){stop('Recording stopped. Preview your moment before leaving.');return;}
    if((blob||editDirty)&&!window.confirm(mode==='edit'?'Leave without saving your changes?':'Discard this unsaved recording? Keep a copy first if you want to save it on your device.'))return;
    const pending=pendingId;++generation;acquiring=false;stopTracks();releaseBlob();clearPlayers('moment-saved-media');editDirty=false;page=null;$('moment-dialog').close();cleanPending(pending);options?.onSaved?.();
  }
  $('moment-close').addEventListener('click',close);
  $('moment-discard').addEventListener('click',()=>{if(mode==='edit'){entryView();message('');}else close();});
  $('moment-dialog').addEventListener('cancel',(event)=>{event.preventDefault();close();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&recording())stop('Closr left the screen, so recording stopped. Your moment is ready to preview.');});
  window.addEventListener('pagehide',()=>{if(recording())stop();stopTracks();});
  window.addEventListener('beforeunload',(event)=>{if(recording()||finishing||acquiring||saving||blob||editDirty){event.preventDefault();event.returnValue='';}});
  window.ClosrMoments={open,openEntry};
})();

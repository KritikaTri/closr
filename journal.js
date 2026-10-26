(() => {
  'use strict';
  if (!document.body.dataset.journalStudio) return;
  const scope = document.body.dataset.journalStudio;
  const $ = (id) => document.getElementById(id);
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const fontFamily = { serif: 'Georgia, serif', sans: '"DM Sans", sans-serif', mono: '"Courier New", monospace', hand: '"Bradley Hand", "Segoe Print", cursive' };
  const today = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`; };
  const localDate = (value) => new Date(`${value}T12:00:00`);
  const prettyDate = (value, options = {}) => !value || Number.isNaN(localDate(value).getTime()) ? 'Choose a date' : new Intl.DateTimeFormat(undefined, { month:'short', day:'numeric', year:'numeric', ...options }).format(localDate(value));
  const el = (tag, className, words) => { const node = document.createElement(tag); if (className) node.className = className; if (words !== undefined) node.textContent = words; return node; };
  const button = (label, className, action) => { const node = el('button', className, label); node.type='button'; if (action) node.addEventListener('click', action); return node; };
  const dialogOpen = (id) => { if (!$(id).open) $(id).showModal(); };
  const dialogClose = (id) => $(id).close();
  let ctx, ready = false, busyLibrary = false, folders = [], records = [], view = 'pages', folderId = null, hasMore = false, canWrite = false, aiConfigured = false, photosConfigured = false;
  let draft = null, dirty = false, saving = false, uploading = false, selectedId = null, zoom = 1, history = [], redo = [], gesture = null, currentTemplate = 'postcards', dateRecord = null, folderEdit = null;
  let calendarDate = today(), calendarMonth = localDate(today()), polishSource = null, suggestion = null;
  const media = new Map();
  const newUploads = new Set();
  async function cleanUploads(keep = new Set()) { for (const id of [...newUploads]) { if (keep.has(id)) {newUploads.delete(id);continue;} try {await api(`/api/journal/uploads/${id}`,{method:'DELETE'});newUploads.delete(id);media.delete(id);} catch { /* Retry cleanup on the next save or explicit discard. */ } } }
  async function api(path, options = {}) {
    if (!ctx) throw new Error('Sign in to open your journal.');
    const response = await ctx.apiFetch(path, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.error || 'Couldn’t finish that. Please try again.'); error.conflict = data.conflict; throw error; }
    return data;
  }
  const json = (method, body) => ({ method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  const feedback = (id, words) => { $(id).textContent = words || ''; };
  const notify = (words) => window.showToast ? window.showToast(words) : feedback('studio-loading', words);
  const selected = () => draft?.design.nodes.find((node) => node.id === selectedId);
  function saveState() {
    if (!draft) return;
    history.push(copy(draft)); if (history.length > 60) history.shift(); redo = [];
  }
  function changed(render = true) {
    dirty = true; feedback('editor-save-state','Unsaved changes');
    $('editor-undo').disabled = history.length === 0; $('editor-redo').disabled = redo.length === 0;
    if (render) renderCanvas();
  }
  function emptyDesign() { return { v:1, paper:'#fbf7ef', pattern:'plain', nodes:[] }; }
  function newDraft(kind='page') { return { scope, kind, title:'', dateFrom:today(), dateTo:today(), description:'', feeling:'', folderId, hasCanvas:kind === 'page', revision:1, design:emptyDesign() }; }
  function makeText(words, x=70, y=70, w=660, h=110, size=46, font='serif') { return {id:crypto.randomUUID(),type:'text',x,y,w,h,rotation:0,text:words,font,fontSize:size,color:'#59634d'}; }
  function makePhoto(mediaId=null, caption='') { return {id:crypto.randomUUID(),type:'image',mediaId,caption,x:100,y:220,w:280,h:320,rotation:0,frame:'postcard',cropX:50,cropY:50,font:'hand',fontSize:18,color:'#7c806f'}; }
  async function refreshLibrary(append=false) {
    if (busyLibrary) return;
    busyLibrary = true; $('studio-loading').hidden = false; feedback('studio-loading','Opening your journal…');
    try {
      const params = new URLSearchParams({scope,view,offset:String(append ? records.length : 0)}); if (folderId) params.set('folder',folderId);
      const data = await api(`/api/journal?${params}`);
      folders=data.folders; records=append ? records.concat(data.pages) : data.pages; hasMore=data.hasMore; canWrite=data.canWrite; aiConfigured=data.aiConfigured; photosConfigured=data.photoStorageConfigured;
      $('new-folder').disabled=!canWrite; $('new-page').disabled=!canWrite; $('new-date').disabled=!canWrite;
      $('studio-notice').hidden=scope !== 'shared' || canWrite;
      if (scope === 'shared' && !canWrite) feedback('studio-notice','Connect your partner to create shared pages. My Journal is private and ready to use on your own.');
      renderFolders(); renderLibrary(); updateAiAvailability(); $('studio-loading').hidden=true;
    } catch (error) { feedback('studio-loading',error.message); }
    finally { busyLibrary=false; }
  }
  function renderFolders() {
    const list=$('studio-folders'); list.replaceChildren();
    const all=button('All memories','studio-folder'+(!folderId?' active':''),()=>{folderId=null;refreshLibrary();}); all.setAttribute('aria-pressed',String(!folderId)); list.append(all);
    folders.forEach((folder)=>{
      const wrap=el('span','studio-folder-wrap');
      const item=button(`▱ ${folder.name}`,'studio-folder'+(folder.id===folderId?' active':''),()=>{folderId=folder.id;refreshLibrary();}); item.setAttribute('aria-pressed',String(folder.id===folderId));
      wrap.append(item);
      if(folder.id===folderId && canWrite){const rename=button('✎','studio-folder-rename',()=>openFolder(folder));rename.setAttribute('aria-label',`Rename ${folder.name}`);wrap.append(rename);}
      list.append(wrap);
    });
  }
  function renderLibrary() {
    const grid=$('studio-grid'); grid.replaceChildren(); grid.classList.toggle('dates-grid',view==='dates');
    const query=$('studio-search').value.trim().toLocaleLowerCase();
    const shown=records.filter((page)=>`${page.title} ${page.description}`.toLocaleLowerCase().includes(query));
    $('studio-load-more').hidden=!hasMore;
    if(!shown.length){
      const empty=el('div','studio-empty'); empty.append(el('span','empty-icon',view==='dates'?'◷':'✿'),el('h3','',query?'A little more searching?':view==='trash'?'Nothing in your trash':view==='dates'?'Days you’ll want to remember':'Your story starts with a page'),el('p','',query?'No matches in the pages loaded here.':view==='dates'?'Save a date and its story. Make a journal page whenever you feel like it.':view==='trash'?'Pages moved here can be restored.':'A trip, an ordinary Tuesday, a moment you want to keep.'));
      if(view!=='trash' && !query && canWrite) empty.append(button(view==='dates'?'＋ Add a date':'＋ Create your first page','studio-secondary',()=>view==='dates'?openDate():openEditor()));
      grid.append(empty);return;
    }
    shown.forEach((page)=>{
      if(view==='dates'){
        const card=el('article','studio-date-card'),badge=el('div','studio-date-badge'),date=localDate(page.dateFrom); badge.append(el('strong','',date.getDate()),el('span','',new Intl.DateTimeFormat(undefined,{month:'short'}).format(date)));
        const content=el('div','studio-date-copy');content.append(el('h3','',page.title),el('p','',page.description));
        const actions=el('div','studio-date-actions');actions.append(button(page.hasCanvas?'Open journal page ↗':'Journal this day ↗','studio-secondary',()=>loadEditor(page.id)),button('Edit date','studio-text-button',()=>loadDate(page.id)),button('Move to trash','studio-text-button',()=>trashPage(page)));
        content.append(actions);card.append(badge,content);grid.append(card);return;
      }
      const card=el('article','studio-page-card'),open=button('','studio-card-open',()=>view==='trash'?restorePage(page):loadEditor(page.id));
      open.setAttribute('aria-label',`${view==='trash'?'Restore':'Open'} ${page.title}`);
      const preview=el('div','studio-card-preview');preview.style.backgroundColor=page.design.paper;
      if(page.cover){const photo=el('img');photo.src=page.cover;photo.alt='';photo.loading='lazy';preview.append(photo);}else{const word=page.design.nodes.find((node)=>node.type==='text'&&node.text.trim())?.text || page.title;preview.append(el('span','preview-word',word));}
      const content=el('div','studio-card-copy');content.append(el('small','',prettyDate(page.dateFrom)+(page.dateTo!==page.dateFrom?` – ${prettyDate(page.dateTo)}`:'')),el('h3','',page.title),el('p','',page.description));
      const meta=el('div','studio-card-meta');const folder=folders.find((item)=>item.id===page.folderId);meta.append(el('span','',folder?`▱ ${folder.name}`:scope==='private'?'⌑ Only you':'♡ Shared'),el('span','',page.photoCount?`${page.photoCount} photo${page.photoCount===1?'':'s'}`:'A little story'));
      content.append(meta);open.append(preview,content);card.append(open);
      if(view!=='trash'){const remove=button('⌫','studio-card-trash',()=>trashPage(page));remove.setAttribute('aria-label',`Move ${page.title} to trash`);card.append(remove);}
      grid.append(card);
    });
  }
  async function trashPage(page) { try{await api(`/api/journal/pages/${page.id}/trash`,json('POST',{revision:page.revision}));notify('Moved to trash. You can restore it there.');await refreshLibrary();}catch(error){notify(error.message);} }
  async function restorePage(page) {try{await api(`/api/journal/pages/${page.id}/restore`,json('POST',{revision:page.revision}));notify('Page restored.');await refreshLibrary();}catch(error){notify(error.message);} }
  function openFolder(folder=null){folderEdit=folder;$('folder-dialog-title').textContent=folder?'Rename folder':'Create a folder';$('folder-form').querySelector('[type=submit]').textContent=folder?'Save name':'Create folder';$('folder-name').value=folder?.name||'';feedback('folder-message','');dialogOpen('folder-dialog');$('folder-name').focus();}
  $('folder-form').addEventListener('submit',async(event)=>{event.preventDefault();const submit=event.currentTarget.querySelector('[type=submit]');submit.disabled=true;try{const result=await api(folderEdit?`/api/journal/folders/${folderEdit.id}`:'/api/journal/folders',json(folderEdit?'PATCH':'POST',{scope,name:$('folder-name').value.trim()}));folderId=result.folder.id;dialogClose('folder-dialog');await refreshLibrary();}catch(error){feedback('folder-message',error.message);}finally{submit.disabled=false;}});
  function renderCalendar(){
    const year=calendarMonth.getFullYear(),month=calendarMonth.getMonth(),days=new Date(year,month+1,0).getDate(),offset=(new Date(year,month,1).getDay()+6)%7;
    feedback('calendar-month',new Intl.DateTimeFormat(undefined,{month:'long',year:'numeric'}).format(calendarMonth));const grid=$('calendar-days');grid.replaceChildren();
    for(let i=0;i<offset;i++)grid.append(el('span'));
    for(let day=1;day<=days;day++){const value=`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;const node=button(String(day),(value===calendarDate?'selected ':'')+(value===today()?'today':''),()=>{calendarDate=value;$('studio-date-value').value=value;renderCalendar();});node.setAttribute('aria-label',prettyDate(value,{weekday:'long'}));node.setAttribute('aria-pressed',String(value===calendarDate));grid.append(node);}
  }
  function openDate(page=null){if(!canWrite)return;dateRecord=page?copy(page):newDraft('date');calendarDate=dateRecord.dateFrom;calendarMonth=localDate(calendarDate);$('studio-date-value').value=calendarDate;$('studio-date-title').value=dateRecord.title;$('studio-date-description').value=dateRecord.description;$('journal-this-day').checked=false;feedback('date-message','');renderCalendar();dialogOpen('date-dialog');}
  async function loadDate(id){try{const data=await api(`/api/journal/pages/${id}`);data.assets.forEach((asset)=>media.set(asset.id,asset.url));openDate(data.page);}catch(error){notify(error.message);}}
  $('calendar-prev').addEventListener('click',()=>{calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()-1,1);renderCalendar();});
  $('calendar-next').addEventListener('click',()=>{calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()+1,1);renderCalendar();});
  $('studio-date-value').addEventListener('change',()=>{if(!$('studio-date-value').value)return;calendarDate=$('studio-date-value').value;calendarMonth=localDate(calendarDate);renderCalendar();});
  $('studio-date-form').addEventListener('submit',async(event)=>{
    event.preventDefault();const submit=event.currentTarget.querySelector('[type=submit]');submit.disabled=true;
    try{const description=$('studio-date-description').value.trim();const title=$('studio-date-title').value.trim()||Array.from(description.split(/[.!?\n]/u)[0]).slice(0,100).join('')||prettyDate(calendarDate);const value={...copy(dateRecord),title,description,dateFrom:$('studio-date-value').value,dateTo:$('studio-date-value').value};
      const result=await persist(value);dialogClose('date-dialog');await refreshLibrary();if($('journal-this-day').checked)openEditor(result.page);else notify('Your important date is saved.');
    }catch(error){feedback('date-message',error.message);}finally{submit.disabled=false;}
  });
  async function persist(value,asCopy=false){const payload={scope:value.scope,kind:value.kind,title:value.title.trim()||'A little memory',dateFrom:value.dateFrom,dateTo:value.dateTo,description:value.description,feeling:value.feeling||'',folderId:value.folderId||null,hasCanvas:value.hasCanvas,design:value.design,revision:value.revision};return api(value.id&&!asCopy?`/api/journal/pages/${value.id}`:'/api/journal/pages',json(value.id&&!asCopy?'PUT':'POST',payload));}
  function openEditor(page=null){
    if(!canWrite){notify('Connect your partner to edit Our Journal. My Journal is ready now.');return;}
    draft=page?copy(page):newDraft();draft.hasCanvas=true;draft.design ||= emptyDesign();selectedId=null;history=[];redo=[];dirty=!page||!page.hasCanvas;currentTemplate='postcards';
    fillDetails();feedback('editor-message','');feedback('photo-upload-state','');$('editor-save-copy').hidden=true;feedback('editor-save-state',dirty?'Unsaved changes':'Saved');$('editor-privacy').textContent=scope==='private'?'⌑ Only you can see this page':'♡ Shared with your partner';
    $('editor-export').hidden=Boolean(window.Capacitor?.isNativePlatform?.());$('open-gallery').hidden=!window.CLOSER_NATIVE_PHOTOS?.available?.();dialogOpen('journal-editor');showPanel('design');renderCanvas();resizeCanvas();
  }
  async function loadEditor(id){try{const data=await api(`/api/journal/pages/${id}`);data.assets.forEach((asset)=>media.set(asset.id,asset.url));openEditor(data.page);}catch(error){notify(error.message);}}
  function fillDetails(){if(!draft)return;$('editor-title').value=draft.title;$('editor-date-from').value=draft.dateFrom;$('editor-date-to').value=draft.dateTo;$('editor-description').value=draft.description;$('editor-feeling').value=draft.feeling||'';$('editor-folder').replaceChildren(new Option('No folder',''),...folders.map((folder)=>new Option(folder.name,folder.id)));$('editor-folder').value=draft.folderId||'';$('editor-paper').value=draft.design.paper;$('editor-pattern').value=draft.design.pattern;feedback('editor-heading',draft.title||'A little memory');feedback('editor-date-label',prettyDate(draft.dateFrom)+(draft.dateTo!==draft.dateFrom?` – ${prettyDate(draft.dateTo)}`:''));}
  function showPanel(name){document.querySelectorAll('[data-editor-panel]').forEach((node)=>{const active=node.dataset.editorPanel===name;node.classList.toggle('active',active);node.setAttribute('aria-pressed',String(active));});document.querySelectorAll('[data-tool-panel]').forEach((node)=>node.hidden=node.dataset.toolPanel!==name);}
  function resizeCanvas(){if(!$('journal-editor').open)return;const stage=$('editor-page-scroll');const scale=$('editor-zoom').value==='fit'?Math.min(1,Math.max(.15,(stage.clientWidth-55)/800),Math.max(.15,(stage.clientHeight-35)/1000)):Number($('editor-zoom').value);zoom=scale;$('journal-canvas').style.transform=`scale(${scale})`;$('editor-page-size').style.width=`${800*scale}px`;$('editor-page-size').style.height=`${1000*scale}px`;}
  function renderCanvas(){
    if(!draft)return;const canvas=$('journal-canvas');canvas.replaceChildren();canvas.style.backgroundColor=draft.design.paper;canvas.className=`journal-canvas pattern-${draft.design.pattern}`;
    if(!draft.design.nodes.length){const empty=el('div','canvas-empty');empty.append(el('strong','','A little space for your story.'),el('span','','Choose a template, add photos, or start with a few words.'));canvas.append(empty);}
    draft.design.nodes.forEach((node)=>{
      const item=el('div',`canvas-element ${node.type==='image'?`frame-${node.frame}`:''}${node.id===selectedId?' selected':''}`);item.dataset.elementId=node.id;item.tabIndex=0;item.setAttribute('role','group');item.setAttribute('aria-label',node.type==='image'?`Photo frame${node.caption?`: ${node.caption}`:''}`:node.type==='shape'?`${node.shape} shape`:node.text||'Text');
      Object.assign(item.style,{left:`${node.x}px`,top:`${node.y}px`,width:`${node.w}px`,height:`${node.h}px`,transform:`rotate(${node.rotation}deg)`});
      if(node.type==='image'){
        const frame=el('div','canvas-photo');if(node.mediaId&&media.has(node.mediaId)){const image=el('img');image.src=media.get(node.mediaId);image.alt=node.caption||'Journal photo';image.draggable=false;image.style.objectPosition=`${node.cropX}% ${node.cropY}%`;frame.append(image);}else frame.append(el('div','canvas-placeholder','＋ your photo'));
        item.append(frame);if(node.caption){const caption=el('div','canvas-caption',node.caption);caption.style.fontFamily=fontFamily[node.font||'serif'];caption.style.fontSize=`${node.fontSize||18}px`;caption.style.color=node.color||'#7c806f';item.append(caption);}
      }else if(node.type==='shape'){const shape=el('div','canvas-shape');shape.style.background=node.color;if(node.shape==='line'){shape.style.height='3px';shape.style.marginTop=`${node.h/2}px`;}if(node.shape==='ellipse')shape.style.borderRadius='50%';item.append(shape);}
      else{const words=el('div','canvas-text',node.text);Object.assign(words.style,{fontFamily:fontFamily[node.font],fontSize:`${node.fontSize}px`,color:node.color,height:'100%'});item.append(words);}
      const handle=button('','canvas-resize');handle.setAttribute('aria-label','Resize this element');handle.tabIndex=-1;item.append(handle);canvas.append(item);
    });
    $('editor-undo').disabled=!history.length;$('editor-redo').disabled=!redo.length;renderInspector();renderPhotoTray();
  }
  function selectElement(id){selectedId=id;document.querySelectorAll('[data-element-id]').forEach((node)=>node.classList.toggle('selected',node.dataset.elementId===id));renderInspector();}
  function renderInspector(){
    const node=selected();$('inspector-empty').hidden=Boolean(node);$('inspector-controls').hidden=!node;if(!node)return;
    const photo=node.type==='image',shape=node.type==='shape';
    ['inspector-font-label','inspector-size-label','inspector-color-label'].forEach((id)=>$(id).hidden=shape&&id!=='inspector-color-label');
    $('inspector-text-label').hidden=photo||shape;$('inspector-caption-label').hidden=!photo;['inspector-frame-label','inspector-crop-x-label','inspector-crop-y-label'].forEach((id)=>$(id).hidden=!photo);
    $('element-text').value=node.text||'';$('element-caption').value=node.caption||'';$('element-font').value=node.font||'serif';$('element-font-size').value=node.fontSize||18;$('element-color').value=node.color||'#7c806f';$('element-rotation').value=node.rotation;$('element-frame').value=node.frame||'postcard';$('element-crop-x').value=node.cropX??50;$('element-crop-y').value=node.cropY??50;
  }
  function renderPhotoTray(){const list=$('editor-photo-tray');list.replaceChildren();const used=new Set();draft.design.nodes.filter((node)=>node.type==='image'&&node.mediaId).forEach((node)=>{if(used.has(node.mediaId))return;used.add(node.mediaId);const preview=button('','',()=>{selectElement(node.id);$('journal-canvas').querySelector(`[data-element-id="${node.id}"]`)?.focus();});preview.setAttribute('aria-label',node.caption||'Select photo');const image=el('img');image.src=media.get(node.mediaId)||'';image.alt='';preview.append(image);list.append(preview);});}
  function photoPositions(count,style){
    if(style==='editorial'&&count===1)return[{x:65,y:240,w:670,h:510,rotation:0,frame:'arch'}];
    if(count===1)return[{x:155,y:230,w:490,h:540,rotation:-3,frame:style==='film'?'film':'postcard'}];
    if(count===2)return[{x:65,y:255,w:320,h:420,rotation:-5,frame:style==='film'?'film':'postcard'},{x:420,y:360,w:300,h:390,rotation:5,frame:style==='film'?'film':'postcard'}];
    if(count===3&&style!=='film')return[{x:65,y:225,w:375,h:505,rotation:-4,frame:'postcard'},{x:470,y:240,w:250,h:300,rotation:5,frame:style==='editorial'?'arch':'postcard'},{x:455,y:580,w:270,h:300,rotation:-3,frame:'postcard'}];
    const cols=count<=4?2:count<=9?3:4,rows=Math.ceil(count/cols),gap=24,width=(670-(cols-1)*gap)/cols,height=Math.min(width*1.2,(670-(rows-1)*gap)/rows);
    return Array.from({length:count},(_,i)=>({x:65+(i%cols)*(width+gap),y:230+Math.floor(i/cols)*(height+gap),w:width,h:height,rotation:style==='editorial'||style==='film'?0:(i%2===0?-2:2),frame:style==='film'?'film':style==='editorial'?'rounded':'postcard'}));
  }
  function arrangePhotos(style=currentTemplate,remember=true){const photos=draft.design.nodes.filter((node)=>node.type==='image');if(!photos.length){feedback('photo-upload-state','Choose a few photos first, or add a template with empty frames.');return;}if(remember)saveState();const positions=photoPositions(photos.length,style);photos.forEach((node,i)=>Object.assign(node,positions[i]));changed();}
  function applyTemplate(name){
    if(!draft)return;saveState();currentTemplate=name;const photos=draft.design.nodes.filter((node)=>node.type==='image'&&node.mediaId);
    if(name==='blank'){draft.design=emptyDesign();changed();return;}
    const words=makeText(draft.title||'A day to remember',65,60,670,110,48,name==='film'?'mono':'serif');
    const subtitle=makeText(prettyDate(draft.dateFrom),70,175,650,40,17,'mono');subtitle.color='#9b9f89';
    const count=Math.max(photos.length,name==='film'?4:name==='editorial'?2:3);while(photos.length<count)photos.push(makePhoto());
    draft.design={v:1,paper:name==='editorial'?'#eef0e5':name==='film'?'#f5f0e6':'#fbf7ef',pattern:name==='postcards'?'dots':'plain',nodes:[words,subtitle,...photos]};
    if(name==='postcards')draft.design.nodes.push({...makeText('✧',690,55,65,70,56),type:'sticker',color:'#b6a387',rotation:7});
    arrangePhotos(name,false);fillDetails();selectedId=null;changed();
  }
  function addNode(node){if(draft.design.nodes.length>=80){feedback('editor-message','This page has 80 elements. Start another page for more.');return;}saveState();draft.design.nodes.push(node);selectedId=node.id;changed();}
  function updateElement(field,value){const node=selected();if(!node)return;saveState();node[field]=value;changed(false);renderCanvasPreservingInput();}
  function renderCanvasPreservingInput(){const focus=document.activeElement,id=focus?.id,start=focus?.selectionStart,end=focus?.selectionEnd;renderCanvas();if(id){const target=$(id);target?.focus();if(typeof start==='number'&&target?.setSelectionRange)try{target.setSelectionRange(start,end);}catch{}}}
  $('journal-canvas').addEventListener('pointerdown',(event)=>{
    if(event.button!==0)return;const item=event.target.closest('[data-element-id]');if(!item){selectElement(null);return;}event.preventDefault();selectElement(item.dataset.elementId);const node=selected();saveState();gesture={id:node.id,startX:event.clientX,startY:event.clientY,x:node.x,y:node.y,w:node.w,h:node.h,resize:Boolean(event.target.closest('.canvas-resize')),moved:false,pointerId:event.pointerId};item.setPointerCapture(event.pointerId);
  });
  $('journal-canvas').addEventListener('pointermove',(event)=>{if(!gesture||event.pointerId!==gesture.pointerId)return;const node=selected();if(!node)return;const dx=(event.clientX-gesture.startX)/zoom,dy=(event.clientY-gesture.startY)/zoom;if(Math.abs(dx)+Math.abs(dy)<2)return;gesture.moved=true;const snap=(value)=>Math.round(value/5)*5;if(gesture.resize){node.w=Math.max(40,Math.min(800-node.x,snap(gesture.w+dx)));node.h=Math.max(25,Math.min(1000-node.y,snap(gesture.h+dy)));}else{node.x=Math.max(0,Math.min(800-node.w,snap(gesture.x+dx)));node.y=Math.max(0,Math.min(1000-node.h,snap(gesture.y+dy)));}const item=event.currentTarget.querySelector(`[data-element-id="${node.id}"]`);Object.assign(item.style,{left:`${node.x}px`,top:`${node.y}px`,width:`${node.w}px`,height:`${node.h}px`});changed(false);});
  function finishGesture(){if(!gesture)return;if(!gesture.moved)history.pop();gesture=null;$('editor-undo').disabled=!history.length;renderInspector();}
  $('journal-canvas').addEventListener('pointerup',finishGesture);$('journal-canvas').addEventListener('pointercancel',finishGesture);
  $('journal-canvas').addEventListener('keydown',(event)=>{const node=selected();if(!node)return;const step=event.shiftKey?10:1;if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();saveState();node.x=Math.max(0,Math.min(800-node.w,node.x+(event.key==='ArrowRight'?step:event.key==='ArrowLeft'?-step:0)));node.y=Math.max(0,Math.min(1000-node.h,node.y+(event.key==='ArrowDown'?step:event.key==='ArrowUp'?-step:0)));changed();$('journal-canvas').querySelector(`[data-element-id="${node.id}"]`)?.focus();}if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();removeSelected();}});
  async function compressedPhoto(file){if(file.size>35*1024*1024)throw new Error('Choose photos smaller than 35 MB each.');const source=URL.createObjectURL(file);try{const image=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('This photo format can’t be opened here. Export it as JPEG or PNG.'));image.src=source;});const scale=Math.min(1,1400/image.width,1400/image.height);const canvas=document.createElement('canvas');canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);let blob=await new Promise((resolve)=>canvas.toBlob(resolve,'image/jpeg',.8));if(blob.size>1_258_291)blob=await new Promise((resolve)=>canvas.toBlob(resolve,'image/jpeg',.58));if(!blob||blob.size>1_258_291)throw new Error('This photo is too large after compression. Try a smaller image.');return blob;}finally{URL.revokeObjectURL(source);}}
  async function importPhotos(files,loadFile=async(file)=>file){
    if(!files.length)return;if(!photosConfigured){feedback('photo-upload-state','Photo storage isn’t connected yet.');return;}if(uploading)return;
    const filled=draft.design.nodes.filter((node)=>node.type==='image'&&node.mediaId).length;if(filled+files.length>12){feedback('photo-upload-state','Use up to 12 photos on a page. Choose fewer, or create another page.');return;}
    uploading=true;$('editor-save').disabled=true;saveState();let added=0;
    try{for(const source of files){feedback('photo-upload-state',`Adding photo ${added+1} of ${files.length}…`);const file=await loadFile(source);const blob=await compressedPhoto(file);const response=await ctx.apiFetch(`/api/couple/media?scope=${scope}`,{method:'POST',headers:{'Content-Type':'image/jpeg'},body:blob});const result=await response.json();if(!response.ok)throw new Error(result.error||'Couldn’t upload that photo.');const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});media.set(result.mediaId,dataUrl);newUploads.add(result.mediaId);const empty=draft.design.nodes.find((node)=>node.type==='image'&&!node.mediaId);if(empty)empty.mediaId=result.mediaId;else draft.design.nodes.push(makePhoto(result.mediaId));added++;changed();}arrangePhotos(currentTemplate,false);feedback('photo-upload-state',`${added} photo${added===1?'':'s'} added. Select a frame to write its caption.`);}catch(error){feedback('photo-upload-state',`${added?`${added} added. `:''}${error.message}`);}finally{uploading=false;$('editor-save').disabled=false;}
  }
  $('editor-photos').addEventListener('change',async(event)=>{const files=Array.from(event.target.files||[]);event.target.value='';await importPhotos(files);});

  let galleryItems=[],gallerySelected=new Set();
  function renderGallery(){
    const list=$('gallery-preview-grid');list.replaceChildren();
    galleryItems.forEach((item)=>{const node=button('','gallery-choice'+(gallerySelected.has(item.id)?' chosen':''),()=>{if(gallerySelected.has(item.id))gallerySelected.delete(item.id);else{const used=draft.design.nodes.filter((node)=>node.type==='image'&&node.mediaId).length;if(gallerySelected.size+used>=12){feedback('gallery-message','A page can hold up to 12 photos.');return;}gallerySelected.add(item.id);}renderGallery();});node.setAttribute('aria-label',(item.favourite?'Favourite photo, ':'Photo, ')+prettyDate(item.date));node.setAttribute('aria-pressed',String(gallerySelected.has(item.id)));if(item.thumbnail){const image=el('img');image.src=item.thumbnail;image.alt='';node.append(image);}else node.append(el('span','','▣'));if(item.favourite)node.append(el('span','gallery-heart','♡'));node.append(el('span','gallery-tick',gallerySelected.has(item.id)?'✓':''));list.append(node);});
    $('gallery-import').disabled=!gallerySelected.size;$('gallery-import').textContent=gallerySelected.size?'Add '+gallerySelected.size+' selected photo'+(gallerySelected.size===1?'':'s'):'Add selected photos';
  }
  $('open-gallery').addEventListener('click',()=>{$('gallery-from').value=draft.dateFrom;$('gallery-to').value=draft.dateTo;$('gallery-favourites').checked=false;galleryItems=[];gallerySelected.clear();renderGallery();$('gallery-selection-tools').hidden=true;feedback('gallery-message','Your phone may ask for photo access. Limited access works with the photos you allow.');dialogOpen('gallery-dialog');});
  $('gallery-preview').addEventListener('click',async()=>{
    if(!$('gallery-from').value||!$('gallery-to').value||$('gallery-to').value<$('gallery-from').value){feedback('gallery-message','Choose a valid start and end date.');return;}
    $('gallery-preview').disabled=true;feedback('gallery-message','Finding photos on your phone…');
    try{const result=await window.CLOSER_NATIVE_PHOTOS.preview({from:$('gallery-from').value,to:$('gallery-to').value,favouritesOnly:$('gallery-favourites').checked});galleryItems=result.items;gallerySelected.clear();renderGallery();$('gallery-selection-tools').hidden=!galleryItems.length;feedback('gallery-message',(result.limited?'Photo access is limited to the images you allowed. ':'')+(galleryItems.length?'Choose the photos you want on your page.':'No permitted photos matched these dates.')+(result.hasMore?' Showing the first 48; narrow the dates to find the rest.':''));}catch(error){feedback('gallery-message',error.message||'Couldn’t open the gallery. Use Choose photos instead.');}finally{$('gallery-preview').disabled=false;}
  });
  $('gallery-clear').addEventListener('click',()=>{gallerySelected.clear();renderGallery();});
  $('gallery-quick-select').addEventListener('click',()=>{const available=12-draft.design.nodes.filter((node)=>node.type==='image'&&node.mediaId).length;gallerySelected=new Set([...galleryItems].sort((a,b)=>Number(b.favourite)-Number(a.favourite)||(b.width*b.height)-(a.width*a.height)).slice(0,available).map((item)=>item.id));renderGallery();feedback('gallery-message','Selected by favourite and image resolution, without AI. Review the selection before adding.');});
  $('gallery-import').addEventListener('click',async()=>{const ids=[...gallerySelected];if(!ids.length)return;dialogClose('gallery-dialog');await importPhotos(ids,async(id)=>{const result=await window.CLOSER_NATIVE_PHOTOS.read(id);const encoded=result.dataUrl.split(',')[1],binary=atob(encoded),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return new File([bytes],'journal-photo.jpg',{type:'image/jpeg'});});galleryItems=[];gallerySelected.clear();});
  function removeSelected(){if(!selected())return;saveState();draft.design.nodes=draft.design.nodes.filter((node)=>node.id!==selectedId);selectedId=null;changed();}
  $('element-remove').addEventListener('click',removeSelected);
  $('element-duplicate').addEventListener('click',()=>{const node=selected();if(!node)return;const clone=copy(node);clone.id=crypto.randomUUID();clone.x=Math.min(800-clone.w,clone.x+20);clone.y=Math.min(1000-clone.h,clone.y+20);addNode(clone);});
  $('element-front').addEventListener('click',()=>{const node=selected();if(!node)return;saveState();const index=draft.design.nodes.indexOf(node);draft.design.nodes.splice(index,1);draft.design.nodes.splice(Math.min(index+1,draft.design.nodes.length),0,node);changed();});
  $('element-back').addEventListener('click',()=>{const node=selected();if(!node)return;saveState();const index=draft.design.nodes.indexOf(node);draft.design.nodes.splice(index,1);draft.design.nodes.splice(Math.max(0,index-1),0,node);changed();});
  [['element-text','text'],['element-caption','caption'],['element-font','font'],['element-color','color'],['element-frame','frame']].forEach(([id,field])=>$(id).addEventListener(id.includes('text')||id.includes('caption')?'input':'change',()=>updateElement(field,$(id).value)));
  [['element-font-size','fontSize'],['element-rotation','rotation'],['element-crop-x','cropX'],['element-crop-y','cropY']].forEach(([id,field])=>$(id).addEventListener('input',()=>updateElement(field,Number($(id).value))));
  document.querySelectorAll('[data-template]').forEach((node)=>node.addEventListener('click',()=>applyTemplate(node.dataset.template)));
  document.querySelectorAll('[data-editor-panel]').forEach((node)=>node.addEventListener('click',()=>showPanel(node.dataset.editorPanel)));
  document.querySelectorAll('[data-add-text]').forEach((node)=>node.addEventListener('click',()=>addNode(makeText(node.dataset.addText==='heading'?'A little heading':'Write your story here…',75,120,650,node.dataset.addText==='heading'?100:220,node.dataset.addText==='heading'?44:24))));
  document.querySelectorAll('[data-sticker]').forEach((node)=>node.addEventListener('click',()=>addNode({...makeText(node.dataset.sticker,610,90,95,100,70),type:'sticker',color:'#b7a18b',rotation:-8})));
  document.querySelectorAll('[data-shape]').forEach((node)=>node.addEventListener('click',()=>addNode({...makeText('',80,200,300,node.dataset.shape==='line'?20:160,16),type:'shape',shape:node.dataset.shape,color:'#dce4cc'})));
  $('editor-arrange').addEventListener('click',()=>arrangePhotos());
  $('editor-paper').addEventListener('input',()=>{saveState();draft.design.paper=$('editor-paper').value;changed();});$('editor-pattern').addEventListener('change',()=>{saveState();draft.design.pattern=$('editor-pattern').value;changed();});
  [['editor-title','title'],['editor-date-from','dateFrom'],['editor-date-to','dateTo'],['editor-description','description'],['editor-feeling','feeling'],['editor-folder','folderId']].forEach(([id,field])=>$(id).addEventListener(id==='editor-title'||id==='editor-description'?'input':'change',()=>{saveState();draft[field]=$(id).value||((field==='folderId')?null:'');if(field==='dateFrom'&&draft.dateTo<draft.dateFrom){draft.dateTo=draft.dateFrom;$('editor-date-to').value=draft.dateTo;}feedback('editor-heading',draft.title||'A little memory');feedback('editor-date-label',prettyDate(draft.dateFrom)+(draft.dateFrom!==draft.dateTo?` – ${prettyDate(draft.dateTo)}`:''));changed(false);}));
  $('editor-add-story').addEventListener('click',()=>addNode(makeText(draft.description||'Your story goes here…',70,700,660,230,22)));
  $('editor-undo').addEventListener('click',()=>{if(!history.length)return;redo.push(copy(draft));draft=history.pop();selectedId=null;fillDetails();changed();});$('editor-redo').addEventListener('click',()=>{if(!redo.length)return;history.push(copy(draft));draft=redo.pop();selectedId=null;fillDetails();changed();});
  async function savePage(asCopy=false){if(saving||uploading)return;if(!draft.dateFrom||!draft.dateTo||draft.dateTo<draft.dateFrom){feedback('editor-message','Choose a start date and an end date on or after it.');showPanel('details');return;}saving=true;$('editor-save').disabled=true;feedback('editor-save-state','Saving…');feedback('editor-message','');try{const response=await persist(draft,asCopy);draft={...draft,...response.page};dirty=false;const kept=new Set(draft.design.nodes.filter((node)=>node.type==='image'&&node.mediaId).map((node)=>node.mediaId));await cleanUploads(kept);feedback('editor-save-state','Saved');$('editor-save-copy').hidden=true;fillDetails();await refreshLibrary();}catch(error){feedback('editor-message',error.message);feedback('editor-save-state','Not saved');if(error.conflict)$('editor-save-copy').hidden=false;}finally{saving=false;$('editor-save').disabled=false;}}
  $('editor-save').addEventListener('click',()=>savePage());$('editor-save-copy').addEventListener('click',()=>savePage(true));
  function leaveEditor(event){if(saving||uploading){event?.preventDefault();feedback('editor-message','Let the current save or upload finish first.');return;}if(dirty&&!window.confirm('Leave without saving your latest changes?')){event?.preventDefault();return;}dirty=false;draft=null;selectedId=null;cleanUploads();dialogClose('journal-editor');}
  $('editor-back').addEventListener('click',leaveEditor);$('journal-editor').addEventListener('cancel',(event)=>{event.preventDefault();leaveEditor(event);});window.addEventListener('beforeunload',(event)=>{if(dirty||uploading||saving){event.preventDefault();event.returnValue='';}});
  function updateAiAvailability(){['polish-date','polish-page'].forEach((id)=>$(id).disabled=!aiConfigured);const note=aiConfigured?'A preview appears before anything changes.':'AI writing isn’t connected yet. Your own words work beautifully, too.';feedback('date-ai-note',note);feedback('page-ai-note',note);$('editor-photos').disabled=!photosConfigured;}
  function openPolish(source){polishSource=source;suggestion=null;$('polish-result').hidden=true;feedback('polish-message','');dialogOpen('polish-dialog');}
  $('polish-date').addEventListener('click',()=>openPolish('date'));$('polish-page').addEventListener('click',()=>openPolish('page'));
  $('polish-generate').addEventListener('click',async()=>{$('polish-generate').disabled=true;feedback('polish-message','Finding a gentler shape for your words…');const node=selected();const title=polishSource==='date'?$('studio-date-title').value:draft.title;const description=polishSource==='date'?$('studio-date-description').value:node?.type==='text'?node.text:draft.description;try{const result=await api('/api/journal/polish',json('POST',{title,description,tone:$('polish-tone').value}));suggestion={...result.suggestion,nodeId:polishSource==='page'&&node?.type==='text'?node.id:null};feedback('polish-result-title',suggestion.title);feedback('polish-result-description',suggestion.description);$('polish-result').hidden=false;feedback('polish-message','Your original stays until you choose Use these words.');}catch(error){feedback('polish-message',error.message);}finally{$('polish-generate').disabled=false;}});
  $('polish-apply').addEventListener('click',()=>{if(!suggestion)return;if(polishSource==='date'){$('studio-date-title').value=suggestion.title;$('studio-date-description').value=suggestion.description;}else{saveState();if(suggestion.nodeId){const node=draft.design.nodes.find((node)=>node.id===suggestion.nodeId);if(node)node.text=suggestion.description;}else{draft.title=suggestion.title;draft.description=suggestion.description;}fillDetails();changed();}dialogClose('polish-dialog');});
  async function mediaData(id){if(media.get(id)?.startsWith('data:'))return media.get(id);const data=await api(`/api/journal/media/${id}`);media.set(id,data.dataUrl);return data.dataUrl;}
  function wrapText(context,words,x,y,width,size,maxHeight){context.textBaseline='top';const lines=[];String(words).split('\n').forEach((paragraph)=>{let line='';for(const word of paragraph.split(' ')){if(context.measureText(line+(line?' ':'')+word).width>width&&line){lines.push(line);line=word;}else line+=(line?' ':'')+word;}lines.push(line);});for(let i=0;i<lines.length&&i*size*1.45<maxHeight;i++)context.fillText(lines[i],x,y+i*size*1.45,width);}
  $('editor-export').addEventListener('click',async()=>{
    if(!draft||uploading)return;const target=$('editor-export');target.disabled=true;feedback('editor-message','Preparing your page…');
    try{const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=2000;const c=canvas.getContext('2d');c.scale(2,2);c.fillStyle=draft.design.paper;c.fillRect(0,0,800,1000);if(draft.design.pattern==='lined'){c.strokeStyle='#89977233';for(let y=60;y<1000;y+=37){c.beginPath();c.moveTo(0,y);c.lineTo(800,y);c.stroke();}}if(draft.design.pattern==='dots'){c.fillStyle='#98a28155';for(let x=0;x<800;x+=20)for(let y=0;y<1000;y+=20){c.beginPath();c.arc(x,y,.8,0,Math.PI*2);c.fill();}}
      for(const node of draft.design.nodes){c.save();c.translate(node.x+node.w/2,node.y+node.h/2);c.rotate(node.rotation*Math.PI/180);c.translate(-node.w/2,-node.h/2);
        if(node.type==='image'){const framed=['postcard','film'].includes(node.frame),pad=framed?12:0,bottom=framed?58:0;c.fillStyle=node.frame==='film'?'#30362e':'#ffffff';if(framed)c.fillRect(0,0,node.w,node.h);c.save();if(node.frame==='circle'){c.beginPath();c.ellipse(node.w/2,node.h/2,node.w/2,node.h/2,0,0,Math.PI*2);c.clip();}else if(node.frame==='arch'){c.beginPath();c.roundRect(0,0,node.w,node.h,[node.w/2,node.w/2,8,8]);c.clip();}else if(node.frame==='rounded'){c.beginPath();c.roundRect(0,0,node.w,node.h,28);c.clip();}
          if(node.mediaId){const src=await mediaData(node.mediaId);const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=src;});const w=node.w-pad*2,h=node.h-pad-bottom,scale=Math.max(w/image.width,h/image.height),sw=w/scale,sh=h/scale,sx=(image.width-sw)*node.cropX/100,sy=(image.height-sh)*node.cropY/100;c.drawImage(image,sx,sy,sw,sh,pad,pad,w,h);}else{c.fillStyle='#e4e9d9';c.fillRect(pad,pad,node.w-pad*2,node.h-pad-bottom);}c.restore();if(node.caption){c.fillStyle=node.color||'#7c806f';c.font=`${node.fontSize||18}px ${fontFamily[node.font||'serif']}`;c.textAlign='center';wrapText(c,node.caption,node.w/2,node.h-44,node.w-28,node.fontSize||18,43);c.textAlign='left';}
        }else if(node.type==='shape'){c.fillStyle=node.color;if(node.shape==='ellipse'){c.beginPath();c.ellipse(node.w/2,node.h/2,node.w/2,node.h/2,0,0,Math.PI*2);c.fill();}else c.fillRect(0,node.shape==='line'?node.h/2:0,node.w,node.shape==='line'?3:node.h);}else{c.fillStyle=node.color;c.font=`${node.fontSize}px ${fontFamily[node.font]}`;wrapText(c,node.text,0,0,node.w,node.fontSize,node.h);}c.restore();}
      const blob=await new Promise((resolve)=>canvas.toBlob(resolve,'image/png'));const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`${(draft.title||'closr-memory').replace(/[^\p{L}\p{N} -]/gu,'').slice(0,60)}.png`;link.click();setTimeout(()=>URL.revokeObjectURL(url),30_000);feedback('editor-message','');
    }catch{feedback('editor-message','Couldn’t download this page right now. Your editable page is safe; try again after saving.');}finally{target.disabled=false;}
  });
  $('studio-reflect').addEventListener('click',()=>dialogOpen('reflection-dialog'));
  $('studio-reflection-run').addEventListener('click',async()=>{const now=new Date(),start=new Date(now.getFullYear(),now.getMonth(),$('studio-reflection-period').value==='month'?1:now.getDate()-6);const from=`${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-${String(start.getDate()).padStart(2,'0')}`;$('studio-reflection-run').disabled=true;try{const data=await api(`/api/journal/reflection?${new URLSearchParams({from,to:today()})}`);feedback('studio-reflection-result',data.count?`You kept ${data.count} private page${data.count===1?'':'s'} in this period.${data.feelings.length?` Feelings you recorded: ${data.feelings.map((item)=>`${item.feeling.toLowerCase()} (${item.count})`).join(', ')}.`:''}${data.excerpts.length?`\n\nFrom your own words:\n${data.excerpts.map((item)=>`“${item.description}”`).join('\n\n')}`:''}\n\nA factual recap of your entries, without AI interpretation.`:'No private entries in this period yet. There’s no pressure to write every day.');}catch(error){feedback('studio-reflection-result',error.message);}finally{$('studio-reflection-run').disabled=false;}});
  document.querySelectorAll('[data-close-studio]').forEach((node)=>node.addEventListener('click',()=>dialogClose(node.dataset.closeStudio)));
  document.querySelectorAll('[data-studio-view]').forEach((node)=>node.addEventListener('click',()=>{if(busyLibrary)return;view=node.dataset.studioView;document.querySelectorAll('[data-studio-view]').forEach((item)=>{const active=item===node;item.classList.toggle('active',active);item.setAttribute('aria-pressed',String(active));});refreshLibrary();}));
  $('studio-search').addEventListener('input',renderLibrary);$('studio-load-more').addEventListener('click',()=>refreshLibrary(true));$('new-folder').addEventListener('click',()=>openFolder());$('new-page').addEventListener('click',()=>openEditor());$('new-date').addEventListener('click',()=>openDate());$('editor-zoom').addEventListener('change',resizeCanvas);new ResizeObserver(resizeCanvas).observe($('editor-page-scroll'));
  function init(context){ctx=context;if(ready)return;ready=true;if(scope==='shared'){document.title='Our Journal — Closr';feedback('studio-title','Our Journal ♡');feedback('studio-subtitle','A place for the days, trips and little things you keep together.');feedback('studio-privacy','Shared · both of you');$('studio-reflect').hidden=true;feedback('studio-eyebrow','LITTLE PIECES OF YOUR LIFE, TOGETHER');$('studio-shared-notes').hidden=!ctx.hasPartner;document.querySelector('[data-studio-view="pages"]').textContent='Our pages';}document.querySelectorAll('.studio-scope a').forEach((node)=>node.classList.toggle('active',node.getAttribute('href')===(scope==='private'?'memories.html':'our-journal.html')));const crumb=document.querySelector('.breadcrumb strong');if(crumb)crumb.textContent=scope==='private'?'My Journal':'Our Journal';refreshLibrary();}
  window.ClosrJournal={init};
  window.addEventListener('closr:ready',(event)=>init(event.detail));if(window.CLOSER_JOURNAL_CONTEXT)init(window.CLOSER_JOURNAL_CONTEXT);
})();

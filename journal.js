(() => {
  'use strict';
  if (!document.body.dataset.journalStudio) return;
  const scope = document.body.dataset.journalStudio;
  const MAX_PHOTOS = 100, MAX_ELEMENTS = 300;
  const validDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value+'T12:00:00Z')) && new Date(value+'T12:00:00Z').toISOString().slice(0,10) === value;
  let frameTargetId = null, dateMode = 'day', rangeStart = '', rangeEnd = '', rangeMonth, rangePickingEnd = false, rangeHover = null, rangeDrag = false;
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
  const revokeMedia = (id) => { const url=media.get(id);if(url?.startsWith('blob:'))URL.revokeObjectURL(url);media.delete(id); };
  const newUploads = new Set();
  async function cleanUploads(keep = new Set()) { for (const id of [...newUploads]) { if (keep.has(id)) {newUploads.delete(id);continue;} try {await api(`/api/journal/uploads/${id}`,{method:'DELETE'});newUploads.delete(id);revokeMedia(id);} catch { /* Retry cleanup on the next save or explicit discard. */ } } }
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
  function setEditorBusy(value){
    document.querySelector('#journal-editor .editor-layout').inert=value;
    ['editor-back','editor-save','editor-save-copy'].forEach((id)=>$(id).disabled=value);
    $('editor-undo').disabled=value||!history.length;$('editor-redo').disabled=value||!redo.length;
  }
  function saveState() {
    if (!draft) return;
    history.push(copy(draft)); if (history.length > 60) history.shift(); redo = [];
  }
  function changed(render = true) {
    dirty = true; feedback('editor-save-state','Unsaved changes');
    $('editor-undo').disabled = uploading||saving||history.length === 0; $('editor-redo').disabled = uploading||saving||redo.length === 0;
    if (render) renderCanvas();
  }
  function emptyDesign() { return { v:1, paper:'#fbf7ef', pattern:'plain', nodes:[] }; }
  function newDraft(kind='page') { return { scope, kind, title:'', dateFrom:today(), dateTo:today(), description:'', feeling:'', folderId, hasCanvas:kind === 'page', revision:1, creationId:crypto.randomUUID(), design:emptyDesign() }; }
  function makeText(words, x=70, y=70, w=660, h=110, size=46, font='serif') { return {id:crypto.randomUUID(),type:'text',x,y,w,h,rotation:0,text:words,font,fontSize:size,color:'#59634d'}; }
  function makePhoto(mediaId=null, caption='') { return {id:crypto.randomUUID(),type:'image',mediaId,caption,x:100,y:220,w:280,h:320,rotation:0,frame:'postcard',cropX:50,cropY:50,font:'hand',fontSize:18,color:'#7c806f',photoDate:null}; }
  async function refreshLibrary(append=false) {
    if (busyLibrary) return;
    busyLibrary = true; $('studio-loading').hidden = false; feedback('studio-loading','Opening your journal…');
    try {
      const params = new URLSearchParams({scope,view,offset:String(append ? records.length : 0)}); if (folderId) params.set('folder',folderId);
      const data = await api(`/api/journal?${params}`);
      folders=data.folders; records=append ? records.concat(data.pages) : data.pages; hasMore=data.hasMore; canWrite=data.canWrite; aiConfigured=data.aiConfigured; photosConfigured=data.photoStorageConfigured;
      $('new-recording').disabled=!canWrite;$('new-folder').disabled=!canWrite; $('new-page').disabled=!canWrite; $('new-date').disabled=!canWrite;
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
      const card=el('article','studio-page-card'),open=button('','studio-card-open',()=>view==='trash'?restorePage(page):page.recording?openRecordingEntry(page.id):loadEditor(page.id));
      open.setAttribute('aria-label',`${view==='trash'?'Restore':'Open'} ${page.title}`);
      const preview=el('div','studio-card-preview');preview.style.backgroundColor=page.design.paper;
      if(page.recording){preview.classList.add('studio-recording-cover');preview.append(el('span','moment-cover-icon',page.recording.kind==='video'?'▷':'♩'),el('span','moment-cover-label',page.recording.kind==='video'?'A video moment':'A voice moment'));}else if(page.cover){const photo=el('img');photo.src=page.cover;photo.alt='';photo.loading='lazy';preview.append(photo);}else{const word=page.design.nodes.find((node)=>node.type==='text'&&node.text.trim())?.text || page.title;preview.append(el('span','preview-word',word));}
      const content=el('div','studio-card-copy');content.append(el('small','',prettyDate(page.dateFrom)+(page.dateTo!==page.dateFrom?` – ${prettyDate(page.dateTo)}`:'')),el('h3','',page.title),el('p','',page.description));
      const meta=el('div','studio-card-meta');const folder=folders.find((item)=>item.id===page.folderId);meta.append(el('span','',folder?`▱ ${folder.name}`:scope==='private'?'⌑ Only you':'♡ Shared'),el('span','',page.recording?(page.recording.kind==='video'?'Video · ':'Voice · ')+`${Math.floor(page.recording.durationMs/60000)}:${String(Math.floor(page.recording.durationMs/1000)%60).padStart(2,'0')}`:page.photoCount?`${page.photoCount} photo${page.photoCount===1?'':'s'}`:'A little story'));
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
  async function persist(value,asCopy=false){const payload={scope:value.scope,kind:value.kind,title:value.title.trim()||'A little memory',dateFrom:value.dateFrom,dateTo:value.dateTo,description:value.description,feeling:value.feeling||'',folderId:value.folderId||null,hasCanvas:value.hasCanvas,design:value.design,revision:value.revision,...(value.creationId&&!value.id&&!asCopy?{creationId:value.creationId}:{})};return api(value.id&&!asCopy?`/api/journal/pages/${value.id}`:'/api/journal/pages',json(value.id&&!asCopy?'PUT':'POST',payload));}
  function openEditor(page=null){
    if(!canWrite){notify('Connect your partner to edit Our Journal. My Journal is ready now.');return;}
    draft=page?copy(page):newDraft();draft.hasCanvas=true;draft.design ||= emptyDesign();selectedId=null;history=[];redo=[];dirty=!page||!page.hasCanvas;currentTemplate='postcards';dateMode=draft.dateFrom===draft.dateTo?'day':'period';
    fillDetails();feedback('editor-message','');feedback('photo-upload-state','');$('editor-save-copy').hidden=true;feedback('editor-save-state',dirty?'Unsaved changes':'Saved');$('editor-privacy').textContent=scope==='private'?'⌑ Only you can see this page':'♡ Shared with your partner';
    $('editor-export').hidden=Boolean(window.Capacitor?.isNativePlatform?.());$('open-gallery').hidden=!window.CLOSER_NATIVE_PHOTOS?.available?.();dialogOpen('journal-editor');showPanel('design');renderCanvas();resizeCanvas();
  }
  async function loadEditor(id){try{const data=await api(`/api/journal/pages/${id}`);data.assets.forEach((asset)=>media.set(asset.id,asset.url));openEditor(data.page);}catch(error){notify(error.message);}}
  function fillDetails(){if(!draft)return;$('editor-title').value=draft.title;$('editor-date-from').value=draft.dateFrom;$('editor-date-to').value=draft.dateTo;$('editor-description').value=draft.description;$('editor-feeling').value=draft.feeling||'';$('editor-paper').value=draft.design.paper;$('editor-pattern').value=draft.design.pattern;feedback('editor-heading',draft.title||'A little memory');feedback('editor-date-label',prettyDate(draft.dateFrom)+(draft.dateTo!==draft.dateFrom?` – ${prettyDate(draft.dateTo)}`:''));updateDateMode();}
  function showPanel(name){document.querySelectorAll('[data-editor-panel]').forEach((node)=>{const active=node.dataset.editorPanel===name;node.classList.toggle('active',active);node.setAttribute('aria-pressed',String(active));});document.querySelectorAll('[data-tool-panel]').forEach((node)=>node.hidden=node.dataset.toolPanel!==name);}
  function resizeCanvas(){if(!$('journal-editor').open)return;const stage=$('editor-page-scroll');const scale=$('editor-zoom').value==='fit'?Math.min(1,Math.max(.15,(stage.clientWidth-55)/800),Math.max(.15,(stage.clientHeight-35)/1000)):Number($('editor-zoom').value);zoom=scale;$('journal-canvas').style.transform=`scale(${scale})`;$('editor-page-size').style.width=`${800*scale}px`;$('editor-page-size').style.height=`${1000*scale}px`;}
  function inlineWords(node, field, className, placeholder) {
    const words=el('div',className,node[field]||'');
    words.contentEditable='true';words.spellcheck=true;words.dataset.editField=field;
    words.dataset.placeholder=placeholder;words.setAttribute('role','textbox');
    words.setAttribute('aria-label',field==='caption'?'Photo caption':node.role==='title'?'Memory heading':node.role==='story'?'Memory story':'Page text');
    words.setAttribute('aria-multiline','true');words.style.fontFamily=fontFamily[node.font||'serif'];
    words.style.fontSize=`${node.fontSize||18}px`;words.style.color=node.color||'#7c806f';
    return words;
  }
  function renderCanvas(){
    if(!draft)return;
    const canvas=$('journal-canvas');canvas.replaceChildren();canvas.style.backgroundColor=draft.design.paper;canvas.className=`journal-canvas pattern-${draft.design.pattern}`;
    if(!draft.design.nodes.length){const empty=el('div','canvas-empty');empty.append(el('strong','','A little space for your story.'),el('span','','Choose a template, tap a frame, and write on the page.'));canvas.append(empty);}
    draft.design.nodes.forEach((node)=>{
      const item=el('div',`canvas-element ${node.type==='image'?`frame-${node.frame}`:''}${node.id===selectedId?' selected':''}`);
      item.dataset.elementId=node.id;item.tabIndex=0;item.setAttribute('role','group');
      item.setAttribute('aria-label',node.type==='image'?`Photo frame${node.caption?`: ${node.caption}`:''}`:node.type==='shape'?`${node.shape} shape`:node.text||'Text');
      Object.assign(item.style,{left:`${node.x}px`,top:`${node.y}px`,width:`${node.w}px`,height:`${node.h}px`,transform:`rotate(${node.rotation}deg)`});
      if(node.type==='image'){
        const frame=el('div','canvas-photo');
        if(node.mediaId&&media.has(node.mediaId)){const image=el('img');image.src=media.get(node.mediaId);image.alt=node.caption||'Journal photo';image.draggable=false;image.decoding='async';image.loading='lazy';image.style.objectPosition=`${node.cropX}% ${node.cropY}%`;frame.append(image);}
        else {const add=button('＋ your photo','canvas-placeholder',()=>chooseFramePhoto(node.id));add.setAttribute('aria-label','Add a photo to this frame');frame.append(add);}
        item.append(frame);
        if(node.frame==='postcard'||node.frame==='film')item.append(inlineWords(node,'caption','canvas-caption','Add a caption…'));
      }else if(node.type==='shape'){
        const shape=el('div','canvas-shape');shape.style.background=node.color;
        if(node.shape==='line'){shape.style.height='3px';shape.style.marginTop=`${node.h/2}px`;}
        if(node.shape==='ellipse')shape.style.borderRadius='50%';item.append(shape);
      }else if(node.type==='text'){
        item.append(inlineWords(node,'text','canvas-text',node.role==='title'?'Give this memory a name…':'Write your story here…'));
        const move=button('⠿','canvas-text-move');move.setAttribute('aria-label','Drag to move text');item.append(move);
      }else{const words=el('div','canvas-text',node.text);Object.assign(words.style,{fontFamily:fontFamily[node.font],fontSize:`${node.fontSize}px`,color:node.color,height:'100%'});item.append(words);}
      const handle=button('','canvas-resize');handle.setAttribute('aria-label','Resize this element');handle.tabIndex=-1;item.append(handle);canvas.append(item);
    });
    $('editor-undo').disabled=uploading||saving||!history.length;$('editor-redo').disabled=uploading||saving||!redo.length;renderInspector();renderPhotoTray();
  }
  function selectElement(id){selectedId=id;document.querySelectorAll('[data-element-id]').forEach((node)=>node.classList.toggle('selected',node.dataset.elementId===id));renderInspector();}
  function renderInspector(){
    const node=selected();$('inspector-empty').hidden=Boolean(node);$('inspector-controls').hidden=!node;if(!node)return;
    const photo=node.type==='image',shape=node.type==='shape',captioned=photo&&['postcard','film'].includes(node.frame);
    ['inspector-font-label','inspector-size-label','inspector-color-label'].forEach((id)=>$(id).hidden=(shape&&id!=='inspector-color-label')||(photo&&!captioned));
    $('inspector-text-label').hidden=photo||shape;$('inspector-caption-label').hidden=!captioned;$('element-replace').hidden=!photo;$('inspector-photo-date-label').hidden=!photo;
    ['inspector-frame-label','inspector-crop-x-label','inspector-crop-y-label'].forEach((id)=>$(id).hidden=!photo);
    $('element-text').value=node.text||'';$('element-caption').value=node.caption||'';$('element-photo-date').value=node.photoDate||'';
    $('element-font').value=node.font||'serif';$('element-font-size').value=node.fontSize||18;$('element-color').value=node.color||'#7c806f';$('element-rotation').value=node.rotation;
    const frameSelect=$('element-frame');frameSelect.querySelector('[data-legacy]')?.remove();
    if(photo&&!['postcard','plain'].includes(node.frame)){const legacy=new Option('Existing frame',node.frame);legacy.dataset.legacy='true';frameSelect.append(legacy);}
    frameSelect.value=node.frame||'postcard';$('element-crop-x').value=node.cropX??50;$('element-crop-y').value=node.cropY??50;
  }
  function renderPhotoTray(){
    const list=$('editor-photo-tray');list.replaceChildren();const used=new Set();
    draft.design.nodes.filter((node)=>node.type==='image'&&node.mediaId).forEach((node)=>{
      if(used.has(node.mediaId))return;used.add(node.mediaId);const preview=button('','',()=>{selectElement(node.id);$('journal-canvas').querySelector(`[data-element-id="${node.id}"]`)?.scrollIntoView({block:'nearest',inline:'nearest'});});
      preview.setAttribute('aria-label',node.caption||'Select photo');const image=el('img');image.src=media.get(node.mediaId)||'';image.alt='';image.loading='lazy';preview.append(image);list.append(preview);
    });
  }
  function chooseFramePhoto(id){if(uploading||saving)return;frameTargetId=id;selectElement(id);$('frame-photo-input').click();}
  $('frame-photo-input').addEventListener('change',async(event)=>{const file=event.target.files?.[0],id=frameTargetId;event.target.value='';frameTargetId=null;if(file)await importPhotos([file],undefined,id);});
  $('element-replace').addEventListener('click',()=>{if(selected()?.type==='image')chooseFramePhoto(selectedId);});
  $('element-photo-date').addEventListener('change',()=>updateElement('photoDate',$('element-photo-date').value||null));
  const canvas=$('journal-canvas');
  canvas.addEventListener('focusin',(event)=>{
    const words=event.target.closest('[contenteditable="true"]');if(!words)return;
    selectElement(words.closest('[data-element-id]').dataset.elementId);saveState();
  });
  canvas.addEventListener('input',(event)=>{
    const words=event.target.closest('[contenteditable="true"]');if(!words||!draft)return;
    const node=draft.design.nodes.find((item)=>item.id===words.closest('[data-element-id]').dataset.elementId);if(!node)return;
    const field=words.dataset.editField,limit=field==='caption'?300:node.role==='title'?120:3000;
    const value=words.innerText.replace(/\r/g,'').slice(0,limit);node[field]=value;
    if(words.innerText.length>limit)words.textContent=value;
    if(node.role==='title'){draft.title=value;$('editor-title').value=value;feedback('editor-heading',value||'A little memory');}
    if(node.role==='story'){draft.description=value;$('editor-description').value=value;}
    const inspector=$(field==='caption'?'element-caption':'element-text');inspector.value=value;changed(false);
  });
  canvas.addEventListener('paste',(event)=>{
    if(!event.target.closest('[contenteditable="true"]'))return;event.preventDefault();
    const text=event.clipboardData?.getData('text/plain')||'';document.execCommand('insertText',false,text);
  });
  function photoPositions(count,style){
    // Dense pages use a grid; all sizes stay positive even at the 100-photo limit.
    if(style==='heart'||style==='monument'){
      const points=[];
      const inside=(x,y)=>style==='heart'?Math.pow(x*x+y*y-1,3)-x*x*y*y*y<=0:(Math.abs(x)<=.88&&y>-.95&&y<.8&&(Math.abs(x)>.38||y>.34));
      const candidates=(density)=>{const result=[];for(let row=0;row<density;row++)for(let col=0;col<density;col++){const x=-1.2+(col+.5)*2.4/density,y=1.2-(row+.5)*2.4/density;if(inside(x,y))result.push({x,y});}return result;};
      let density=3;while(candidates(density).length<count)density++;
      const cells=candidates(density);for(let i=0;i<count;i++)points.push(cells[Math.floor(i*cells.length/count)]);
      const cell=580/density,size=Math.min(185,cell*.94);
      return points.map((point)=>({x:400+point.x*245-size/2,y:540-point.y*245-size*.55,w:size,h:size*1.1,rotation:0,frame:count>16?'plain':'postcard'}));
    }
    if(style==='timeline'){
      const cols=Math.ceil(Math.sqrt(count)),rows=Math.ceil(count/cols),gap=12,w=(670-(cols-1)*gap)/cols,h=Math.min(w*1.15,(650-(rows-1)*gap)/rows);
      return Array.from({length:count},(_,i)=>({x:65+Math.floor(i/rows)*(w+gap),y:230+(i%rows)*(h+gap),w,h,rotation:0,frame:count>16?'plain':'postcard'}));
    }
    if(count===1&&style!=='grid')return[{x:155,y:230,w:490,h:540,rotation:style==='editorial'?0:-3,frame:style==='editorial'?'plain':'postcard'}];
    if(count===2&&style!=='grid')return[{x:65,y:255,w:320,h:420,rotation:-5,frame:'postcard'},{x:420,y:360,w:300,h:390,rotation:5,frame:'postcard'}];
    if(count===3&&style!=='grid'&&style!=='film')return[{x:65,y:225,w:375,h:505,rotation:-4,frame:'postcard'},{x:470,y:240,w:250,h:300,rotation:5,frame:'postcard'},{x:455,y:580,w:270,h:300,rotation:-3,frame:'postcard'}];
    const cols=Math.ceil(Math.sqrt(count)),rows=Math.ceil(count/cols),gap=count>25?8:16,width=(670-(cols-1)*gap)/cols,height=Math.min(width*1.2,(650-(rows-1)*gap)/rows);
    return Array.from({length:count},(_,i)=>({x:65+(i%cols)*(width+gap),y:230+Math.floor(i/cols)*(height+gap),w:width,h:height,rotation:count>9||style==='grid'||style==='editorial'||style==='film'?0:(i%2===0?-2:2),frame:count>16||style==='editorial'?'plain':'postcard'}));
  }
  function arrangePhotos(style=currentTemplate,remember=true){if(!draft||saving)return;const photos=draft.design.nodes.filter((node)=>node.type==='image');if(!photos.length){feedback('photo-upload-state','Choose a few photos first, or add a template with empty frames.');return;}if(remember)saveState();const positions=photoPositions(photos.length,style);photos.forEach((node,i)=>Object.assign(node,positions[i]));changed();}
  function applyTemplate(name){
    if(!draft||uploading||saving)return;saveState();currentTemplate=name;const photos=draft.design.nodes.filter((node)=>node.type==='image'&&node.mediaId);
    if(name==='blank'){draft.design=emptyDesign();changed();return;}
    const words={...makeText(draft.title,65,60,670,110,48,name==='film'?'mono':'serif'),role:'title'};
    const subtitle={...makeText(prettyDate(draft.dateFrom)+(draft.dateFrom!==draft.dateTo?' – '+prettyDate(draft.dateTo):''),70,175,650,40,17,'mono'),role:'date'};subtitle.color='#9b9f89';
    const count=Math.max(photos.length,name==='film'?4:name==='editorial'?2:3);while(photos.length<count)photos.push(makePhoto());
    draft.design={v:1,paper:name==='editorial'?'#eef0e5':name==='film'?'#f5f0e6':'#fbf7ef',pattern:name==='postcards'?'dots':'plain',nodes:[words,subtitle,...photos]};
    if(name==='postcards')draft.design.nodes.push({...makeText('✧',690,55,65,70,56),type:'sticker',color:'#b6a387',rotation:7});
    arrangePhotos(name,false);fillDetails();selectedId=null;changed();
  }
  function addNode(node){if(!draft||uploading||saving)return false;if(draft.design.nodes.length>=MAX_ELEMENTS){feedback('editor-message','This page has 300 elements. Start another page for more.');return false;}saveState();draft.design.nodes.push(node);selectedId=node.id;changed();return true;}
  function updateElement(field,value){const node=selected();if(!node||uploading||saving)return;saveState();node[field]=value;if(node.role==='title'&&field==='text'){draft.title=value.slice(0,120);node.text=draft.title;fillDetails();}if(node.role==='story'&&field==='text'){draft.description=value;fillDetails();}changed(false);renderCanvasPreservingInput();}
  function renderCanvasPreservingInput(){const focus=document.activeElement,id=focus?.id,start=focus?.selectionStart,end=focus?.selectionEnd;renderCanvas();if(id){const target=$(id);target?.focus();if(typeof start==='number'&&target?.setSelectionRange)try{target.setSelectionRange(start,end);}catch{}}}
  canvas.addEventListener('pointerdown',(event)=>{
    if(uploading||saving||event.button!==0||event.target.closest('[contenteditable="true"],.canvas-placeholder'))return;
    const item=event.target.closest('[data-element-id]');if(!item){selectElement(null);return;}
    event.preventDefault();selectElement(item.dataset.elementId);const node=selected();saveState();
    gesture={id:node.id,startX:event.clientX,startY:event.clientY,x:node.x,y:node.y,w:node.w,h:node.h,resize:Boolean(event.target.closest('.canvas-resize')),moved:false,pointerId:event.pointerId};item.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove',(event)=>{
    if(!gesture||event.pointerId!==gesture.pointerId)return;const node=draft?.design.nodes.find((item)=>item.id===gesture.id);if(!node)return;
    const dx=(event.clientX-gesture.startX)/zoom,dy=(event.clientY-gesture.startY)/zoom;
    if(Math.abs(dx)+Math.abs(dy)<4)return;
    const item=event.currentTarget.querySelector(`[data-element-id="${node.id}"]`);
    if(!gesture.moved&&!gesture.resize&&node.type==='image'){draft.design.nodes=draft.design.nodes.filter((entry)=>entry.id!==node.id);draft.design.nodes.push(node);item.style.zIndex='1';}
    gesture.moved=true;const snap=(value)=>Math.round(value/5)*5;
    if(gesture.resize){node.w=Math.max(40,Math.min(800-node.x,snap(gesture.w+dx)));node.h=Math.max(25,Math.min(1000-node.y,snap(gesture.h+dy)));}
    else{node.x=Math.max(0,Math.min(800-node.w,snap(gesture.x+dx)));node.y=Math.max(0,Math.min(1000-node.h,snap(gesture.y+dy)));}
    Object.assign(item.style,{left:`${node.x}px`,top:`${node.y}px`,width:`${node.w}px`,height:`${node.h}px`});changed(false);
  });
  function finishGesture(){if(!gesture)return;const moved=gesture.moved;if(!moved)history.pop();gesture=null;$('editor-undo').disabled=!history.length;if(moved)renderCanvas();else renderInspector();}
  canvas.addEventListener('pointerup',finishGesture);canvas.addEventListener('pointercancel',finishGesture);
  canvas.addEventListener('keydown',(event)=>{
    if(event.target.closest('[contenteditable="true"]')){if(event.key==='Escape')event.target.blur();return;}
    const node=selected();if(!node)return;const step=event.shiftKey?10:1;
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();saveState();node.x=Math.max(0,Math.min(800-node.w,node.x+(event.key==='ArrowRight'?step:event.key==='ArrowLeft'?-step:0)));node.y=Math.max(0,Math.min(1000-node.h,node.y+(event.key==='ArrowDown'?step:event.key==='ArrowUp'?-step:0)));changed();canvas.querySelector(`[data-element-id="${node.id}"]`)?.focus();}
    if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();removeSelected();}
  });
  async function compressedPhoto(file){if(file.size>35*1024*1024)throw new Error('Choose photos smaller than 35 MB each.');const source=URL.createObjectURL(file);try{const image=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('This photo format can’t be opened here. Export it as JPEG or PNG.'));image.src=source;});const scale=Math.min(1,1400/image.width,1400/image.height);const canvas=document.createElement('canvas');canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);let blob=await new Promise((resolve)=>canvas.toBlob(resolve,'image/jpeg',.8));if(blob.size>1_258_291)blob=await new Promise((resolve)=>canvas.toBlob(resolve,'image/jpeg',.58));if(!blob||blob.size>1_258_291)throw new Error('This photo is too large after compression. Try a smaller image.');return blob;}finally{URL.revokeObjectURL(source);}}
  async function photoCaptureDate(file){
    // Read only the JPEG DateTimeOriginal / DateTimeDigitized tags, locally. GPS is never read.
    try{
      const data=new DataView(await file.slice(0,262144).arrayBuffer());if(data.byteLength<4||data.getUint16(0)!==0xffd8)return null;
      let pos=2;
      while(pos+4<data.byteLength){if(data.getUint8(pos)!==255)break;const marker=data.getUint8(pos+1),length=data.getUint16(pos+2);if(length<2||pos+2+length>data.byteLength)break;
        if(marker===225&&data.getUint32(pos+4)===0x45786966&&data.getUint16(pos+8)===0){
          const base=pos+10,limit=pos+2+length;if(base+8>limit)return null;
          const little=data.getUint16(base)===0x4949;if(!little&&data.getUint16(base)!==0x4d4d)return null;
          const u16=(offset)=>{if(offset<base||offset+2>limit)throw new Error();return data.getUint16(offset,little);};
          const u32=(offset)=>{if(offset<base||offset+4>limit)throw new Error();return data.getUint32(offset,little);};
          const scan=(offset,nested=false)=>{const count=Math.min(u16(offset),256);let fallback=null;for(let i=0;i<count;i++){const item=offset+2+i*12;if(item+12>limit)break;const tag=u16(item),type=u16(item+2),count=u32(item+4),value=u32(item+8);
            if(tag===0x8769&&!nested){const found=scan(base+value,true);if(found)return found;}
            if([0x9003,0x9004,0x0132].includes(tag)&&type===2&&count>=19&&count<=64){const start=count<=4?item+8:base+value;if(start<base||start+19>limit)continue;let raw='';for(let j=0;j<19;j++)raw+=String.fromCharCode(data.getUint8(start+j));const match=raw.match(/^(\d{4}):(\d{2}):(\d{2}) /);const result=match?`${match[1]}-${match[2]}-${match[3]}`:null;if(validDate(result)){if(tag===0x9003)return result;fallback=result;}}
          }return fallback;};
          if(u16(base+2)!==42)return null;return scan(base+u32(base+4));
        }
        if(marker===218||marker===217)break;pos+=2+length;
      }
    }catch{/* Unsupported or absent metadata must ask for a date, never guess the upload day. */}return null;
  }
  async function importPhotos(files,loadFile=async(file)=>file,targetId=null){
    if(!files.length||!draft)return;
    if(!photosConfigured){feedback('photo-upload-state','Photo storage isn’t connected yet.');return;}if(uploading||saving)return;
    const target=targetId?draft.design.nodes.find((node)=>node.id===targetId&&node.type==='image'):null;
    const filled=draft.design.nodes.filter((node)=>node.type==='image'&&node.mediaId).length;
    if(filled+files.length-(target?.mediaId?1:0)>MAX_PHOTOS){feedback('photo-upload-state','Use up to 100 photos on a page, or split a trip into daily pages.');showPanel('photos');return;}
    const empty=draft.design.nodes.filter((node)=>node.type==='image'&&!node.mediaId).length;
    if(draft.design.nodes.length+Math.max(0,files.length-empty-(target?.mediaId?1:0))>MAX_ELEMENTS){feedback('photo-upload-state','This page is full. Remove a few elements or start another page.');return;}
    uploading=true;setEditorBusy(true);saveState();let added=0;
    try{
      for(const source of files){
        feedback('photo-upload-state',`Adding photo ${added+1} of ${files.length}…`);feedback('editor-save-state',`Adding photo ${added+1} of ${files.length}…`);
        const loaded=await loadFile(source),file=loaded.file||loaded,date=validDate(loaded.date)?loaded.date:await photoCaptureDate(file);
        const blob=await compressedPhoto(file);
        const response=await ctx.apiFetch(`/api/couple/media?scope=${scope}`,{method:'POST',headers:{'Content-Type':'image/jpeg'},body:blob});const result=await response.json();if(!response.ok)throw new Error(result.error||'Couldn’t upload that photo.');
        media.set(result.mediaId,URL.createObjectURL(blob));newUploads.add(result.mediaId);
        let node=target||draft.design.nodes.find((node)=>node.type==='image'&&!node.mediaId);
        if(node){node.mediaId=result.mediaId;node.photoDate=date;}
        else{node=makePhoto(result.mediaId);node.photoDate=date;const index=filled+added;node.x=70+(index%6)*35;node.y=240+(index%8)*30;draft.design.nodes.push(node);}
        selectedId=node.id;added++;changed(false);
      }
      if(!target&&filled===0)arrangePhotos(currentTemplate,false);else renderCanvas();
      feedback('photo-upload-state',`${added} photo${added===1?'':'s'} added. Tap beneath a postcard to write a caption.`);
    }catch(error){renderCanvas();feedback('photo-upload-state',`${added?`${added} added. `:''}${error.message}`);showPanel('photos');}
    finally{uploading=false;setEditorBusy(false);feedback('editor-save-state',dirty?'Unsaved changes':'Saved');}
  }
  $('editor-photos').addEventListener('change',async(event)=>{const files=Array.from(event.target.files||[]);event.target.value='';await importPhotos(files);});
  const dropZone=$('editor-page-scroll');
  dropZone.addEventListener('dragover',(event)=>{if(event.dataTransfer?.types.includes('Files')){event.preventDefault();dropZone.classList.add('photo-drop-active');}});
  dropZone.addEventListener('dragleave',()=>dropZone.classList.remove('photo-drop-active'));
  dropZone.addEventListener('drop',async(event)=>{event.preventDefault();dropZone.classList.remove('photo-drop-active');const files=Array.from(event.dataTransfer?.files||[]);if(files.length)await importPhotos(files);});

  let galleryItems=[],gallerySelected=new Set();
  function renderGallery(){
    const list=$('gallery-preview-grid');list.replaceChildren();
    galleryItems.forEach((item)=>{const node=button('','gallery-choice'+(gallerySelected.has(item.id)?' chosen':''),()=>{if(gallerySelected.has(item.id))gallerySelected.delete(item.id);else{const used=draft.design.nodes.filter((node)=>node.type==='image'&&node.mediaId).length;if(gallerySelected.size+used>=MAX_PHOTOS){feedback('gallery-message','A page can hold up to 100 photos.');return;}gallerySelected.add(item.id);}renderGallery();});node.setAttribute('aria-label',(item.favourite?'Favourite photo, ':'Photo, ')+prettyDate(item.date));node.setAttribute('aria-pressed',String(gallerySelected.has(item.id)));if(item.thumbnail){const image=el('img');image.src=item.thumbnail;image.alt='';node.append(image);}else node.append(el('span','','▣'));if(item.favourite)node.append(el('span','gallery-heart','♡'));node.append(el('span','gallery-tick',gallerySelected.has(item.id)?'✓':''));list.append(node);});
    $('gallery-import').disabled=!gallerySelected.size;$('gallery-import').textContent=gallerySelected.size?'Add '+gallerySelected.size+' selected photo'+(gallerySelected.size===1?'':'s'):'Add selected photos';
  }
  $('open-gallery').addEventListener('click',()=>{$('gallery-from').value=draft.dateFrom;$('gallery-to').value=draft.dateTo;$('gallery-favourites').checked=false;galleryItems=[];gallerySelected.clear();renderGallery();$('gallery-selection-tools').hidden=true;feedback('gallery-message','Your phone may ask for photo access. Limited access works with the photos you allow.');dialogOpen('gallery-dialog');});
  $('gallery-preview').addEventListener('click',async()=>{
    if(!$('gallery-from').value||!$('gallery-to').value||$('gallery-to').value<$('gallery-from').value){feedback('gallery-message','Choose a valid start and end date.');return;}
    $('gallery-preview').disabled=true;feedback('gallery-message','Finding photos on your phone…');
    try{const result=await window.CLOSER_NATIVE_PHOTOS.preview({from:$('gallery-from').value,to:$('gallery-to').value,favouritesOnly:$('gallery-favourites').checked});galleryItems=result.items;gallerySelected.clear();renderGallery();$('gallery-selection-tools').hidden=!galleryItems.length;feedback('gallery-message',(result.limited?'Photo access is limited to the images you allowed. ':'')+(galleryItems.length?'Choose the photos you want on your page.':'No permitted photos matched these dates.')+(result.hasMore?' Showing the first 120; narrow the dates to find the rest.':''));}catch(error){feedback('gallery-message',error.message||'Couldn’t open the gallery. Use Choose photos instead.');}finally{$('gallery-preview').disabled=false;}
  });
  $('gallery-clear').addEventListener('click',()=>{gallerySelected.clear();renderGallery();});
  $('gallery-quick-select').addEventListener('click',()=>{const available=MAX_PHOTOS-draft.design.nodes.filter((node)=>node.type==='image'&&node.mediaId).length;gallerySelected=new Set([...galleryItems].sort((a,b)=>Number(b.favourite)-Number(a.favourite)||(b.width*b.height)-(a.width*a.height)).slice(0,available).map((item)=>item.id));renderGallery();feedback('gallery-message','Selected by favourite and image resolution, without AI. Review the selection before adding.');});
  $('gallery-import').addEventListener('click',async()=>{const ids=[...gallerySelected];if(!ids.length)return;dialogClose('gallery-dialog');await importPhotos(ids,async(id)=>{const result=await window.CLOSER_NATIVE_PHOTOS.read(id);const encoded=result.dataUrl.split(',')[1],binary=atob(encoded),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return {file:new File([bytes],'journal-photo.jpg',{type:'image/jpeg'}),date:galleryItems.find((item)=>item.id===id)?.date};});galleryItems=[];gallerySelected.clear();});
  function removeSelected(){if(!selected()||uploading||saving)return;saveState();draft.design.nodes=draft.design.nodes.filter((node)=>node.id!==selectedId);selectedId=null;changed();}
  $('element-remove').addEventListener('click',removeSelected);
  $('element-duplicate').addEventListener('click',()=>{const node=selected();if(!node)return;if(node.type==='image'&&draft.design.nodes.filter((item)=>item.type==='image').length>=MAX_PHOTOS){feedback('editor-message','This page already has 100 photo frames.');return;}const clone=copy(node);delete clone.role;clone.id=crypto.randomUUID();clone.x=Math.min(800-clone.w,clone.x+20);clone.y=Math.min(1000-clone.h,clone.y+20);addNode(clone);});
  $('element-front').addEventListener('click',()=>{const node=selected();if(!node)return;saveState();const index=draft.design.nodes.indexOf(node);draft.design.nodes.splice(index,1);draft.design.nodes.splice(Math.min(index+1,draft.design.nodes.length),0,node);changed();});
  $('element-back').addEventListener('click',()=>{const node=selected();if(!node)return;saveState();const index=draft.design.nodes.indexOf(node);draft.design.nodes.splice(index,1);draft.design.nodes.splice(Math.max(0,index-1),0,node);changed();});
  [['element-text','text'],['element-caption','caption'],['element-font','font'],['element-color','color'],['element-frame','frame']].forEach(([id,field])=>$(id).addEventListener(id.includes('text')||id.includes('caption')?'input':'change',()=>updateElement(field,$(id).value)));
  [['element-font-size','fontSize'],['element-rotation','rotation'],['element-crop-x','cropX'],['element-crop-y','cropY']].forEach(([id,field])=>$(id).addEventListener('input',()=>updateElement(field,Number($(id).value))));
  document.querySelectorAll('[data-template]').forEach((node)=>node.addEventListener('click',()=>applyTemplate(node.dataset.template)));
  document.querySelectorAll('[data-editor-panel]').forEach((node)=>node.addEventListener('click',()=>showPanel(node.dataset.editorPanel)));
  function focusWords(id){requestAnimationFrame(()=>{const node=canvas.querySelector(`[data-element-id="${id}"] [contenteditable="true"]`);if(!node)return;node.scrollIntoView({block:'nearest',inline:'nearest'});node.focus();});}
  function addMemoryWords(role){
    const existing=draft.design.nodes.find((node)=>node.role===role);
    if(existing){selectElement(existing.id);focusWords(existing.id);return;}
    const node={...makeText(role==='title'?draft.title:draft.description,65,role==='title'?60:draft.design.nodes.some((item)=>item.type==='image')?900:240,670,role==='title'?110:draft.design.nodes.some((item)=>item.type==='image')?85:600,role==='title'?46:22),role};
    if(addNode(node))focusWords(node.id);
  }
  document.querySelectorAll('[data-add-text]').forEach((node)=>node.addEventListener('click',()=>addMemoryWords(node.dataset.addText==='heading'?'title':'story')));
  document.querySelectorAll('[data-sticker]').forEach((node)=>node.addEventListener('click',()=>addNode({...makeText(node.dataset.sticker,610,90,95,100,70),type:'sticker',color:'#b7a18b',rotation:-8})));
  document.querySelectorAll('[data-shape]').forEach((node)=>node.addEventListener('click',()=>addNode({...makeText('',80,200,300,node.dataset.shape==='line'?20:160,16),type:'shape',shape:node.dataset.shape,color:'#dce4cc'})));
  $('editor-arrange').addEventListener('click',()=>arrangePhotos());
  $('editor-paper').addEventListener('input',()=>{saveState();draft.design.paper=$('editor-paper').value;changed();});$('editor-pattern').addEventListener('change',()=>{saveState();draft.design.pattern=$('editor-pattern').value;changed();});
  function syncMemoryWords(){
    draft.design.nodes.forEach((node)=>{if(node.role==='title')node.text=draft.title;if(node.role==='story')node.text=draft.description;if(node.role==='date')node.text=prettyDate(draft.dateFrom)+(draft.dateFrom!==draft.dateTo?' – '+prettyDate(draft.dateTo):'');});
  }
  [['editor-title','title'],['editor-description','description'],['editor-feeling','feeling']].forEach(([id,field])=>$(id).addEventListener(field==='feeling'?'change':'input',()=>{
    saveState();draft[field]=$(id).value;syncMemoryWords();feedback('editor-heading',draft.title||'A little memory');changed();
  }));
  $('editor-add-story').addEventListener('click',()=>addMemoryWords('story'));
  function updateDateMode(){
    document.querySelectorAll('[data-date-mode]').forEach((node)=>node.setAttribute('aria-pressed',String(node.dataset.dateMode===dateMode)));
    feedback('editor-choose-dates',dateMode==='day'?prettyDate(draft.dateFrom):`${prettyDate(draft.dateFrom)} – ${prettyDate(draft.dateTo)}`);
  }
  document.querySelectorAll('[data-date-mode]').forEach((node)=>node.addEventListener('click',()=>{
    dateMode=node.dataset.dateMode;
    if(dateMode==='day'&&draft.dateTo!==draft.dateFrom){saveState();draft.dateTo=draft.dateFrom;syncMemoryWords();changed();}
    fillDetails();openRangePicker();
  }));
  function openRangePicker(){
    rangeStart=draft.dateFrom;rangeEnd=dateMode==='day'?rangeStart:draft.dateTo;
    rangeMonth=localDate(rangeStart);rangePickingEnd=false;rangeHover=null;rangeDrag=false;
    $('range-start').value=rangeStart;$('range-end').value=rangeEnd;
    $('range-end-label').hidden=dateMode==='day';$('range-start-label').firstChild.textContent=dateMode==='day'?'Day':'Start day';
    feedback('editor-date-instructions',dateMode==='day'?'Choose one day.':'Choose the first and last day, or drag across the dates. Use the arrows for another month.');
    renderRangeCalendar();dialogOpen('editor-dates-dialog');
  }
  $('editor-choose-dates').addEventListener('click',openRangePicker);
  function rangeValues(){return [rangeStart,rangeHover||rangeEnd||rangeStart].sort();}
  function paintRange(){
    const [from,to]=rangeValues();
    $('range-calendars').querySelectorAll('[data-range-date]').forEach((node)=>{
      const value=node.dataset.rangeDate;node.classList.toggle('in-range',dateMode==='period'&&value>from&&value<to);
      node.classList.toggle('selected',value===from||value===to);node.setAttribute('aria-pressed',String(value===from||value===to));
    });
    feedback('range-feedback',dateMode==='day'?prettyDate(rangeStart):`${prettyDate(from)} – ${prettyDate(to)}`);
  }
  function renderRangeCalendar(){
    const root=$('range-calendars');root.replaceChildren();$('range-month').value=`${rangeMonth.getFullYear()}-${String(rangeMonth.getMonth()+1).padStart(2,'0')}`;
    const count=dateMode==='day'?1:2;root.classList.toggle('single-calendar',count===1);
    for(let m=0;m<count;m++){
      const date=new Date(rangeMonth.getFullYear(),rangeMonth.getMonth()+m,1),year=date.getFullYear(),month=date.getMonth();
      const block=el('section','studio-calendar');block.append(el('h3','range-month-name',new Intl.DateTimeFormat(undefined,{month:'long',year:'numeric'}).format(date)));
      const weekdays=el('div','calendar-weekdays');['M','T','W','T','F','S','S'].forEach((name)=>weekdays.append(el('span','',name)));block.append(weekdays);
      const grid=el('div','calendar-days');grid.setAttribute('role','group');grid.setAttribute('aria-label',`Dates in ${new Intl.DateTimeFormat(undefined,{month:'long',year:'numeric'}).format(date)}`);
      const offset=(date.getDay()+6)%7,days=new Date(year,month+1,0).getDate();for(let i=0;i<offset;i++)grid.append(el('span'));
      for(let day=1;day<=days;day++){
        const value=`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        const choice=button(String(day),'',()=>{
          if(rangeDrag)return;
          if(dateMode==='day'){rangeStart=value;rangeEnd=value;}
          else if(!rangePickingEnd){rangeStart=value;rangeEnd=value;rangePickingEnd=true;}
          else{[rangeStart,rangeEnd]=[rangeStart,value].sort();rangePickingEnd=false;}
          rangeHover=null;syncRangeInputs();paintRange();
        });
        choice.dataset.rangeDate=value;choice.setAttribute('aria-label',prettyDate(value,{weekday:'long'}));grid.append(choice);
      }
      block.append(grid);root.append(block);
    }
    paintRange();
  }
  function syncRangeInputs(){$('range-start').value=rangeStart;$('range-end').value=rangeEnd;}
  let rangePointerStart=null,rangePointerMoved=false;
  $('range-calendars').addEventListener('pointerdown',(event)=>{
    const day=event.target.closest('[data-range-date]');if(!day||dateMode!=='period'||event.pointerType==='touch')return;
    rangePointerStart=day.dataset.rangeDate;rangePointerMoved=false;
  });
  $('range-calendars').addEventListener('pointerover',(event)=>{
    const day=event.target.closest('[data-range-date]');if(!day||dateMode!=='period')return;
    if(rangePointerStart&&event.buttons===1&&day.dataset.rangeDate!==rangePointerStart){rangePointerMoved=true;rangeStart=rangePointerStart;rangeHover=day.dataset.rangeDate;paintRange();}
    else if(rangePickingEnd&&!rangePointerStart){rangeHover=day.dataset.rangeDate;paintRange();}
  });
  document.addEventListener('pointerup',()=>{
    if(rangePointerStart&&rangePointerMoved){[rangeStart,rangeEnd]=[rangePointerStart,rangeHover||rangePointerStart].sort();rangePickingEnd=false;rangeHover=null;rangeDrag=true;syncRangeInputs();paintRange();setTimeout(()=>rangeDrag=false,0);}
    rangePointerStart=null;rangePointerMoved=false;
  });
  $('range-calendars').addEventListener('pointerleave',()=>{if(!rangePointerStart){rangeHover=null;paintRange();}});
  $('range-prev').addEventListener('click',()=>{rangeMonth=new Date(rangeMonth.getFullYear(),rangeMonth.getMonth()-1,1);rangeHover=null;renderRangeCalendar();});
  $('range-next').addEventListener('click',()=>{rangeMonth=new Date(rangeMonth.getFullYear(),rangeMonth.getMonth()+1,1);rangeHover=null;renderRangeCalendar();});
  $('range-month').addEventListener('change',()=>{if(/^\d{4}-\d{2}$/.test($('range-month').value)){rangeMonth=localDate($('range-month').value+'-01');renderRangeCalendar();}});
  ['range-start','range-end'].forEach((id)=>$(id).addEventListener('change',()=>{
    if(!validDate($(id).value))return;rangeStart=$('range-start').value;rangeEnd=dateMode==='day'?rangeStart:$('range-end').value||rangeStart;
    rangeHover=null;rangePickingEnd=false;rangeMonth=localDate(rangeStart);renderRangeCalendar();
  }));
  $('range-apply').addEventListener('click',()=>{
    const from=$('range-start').value,to=dateMode==='day'?from:$('range-end').value;
    if(!validDate(from)||!validDate(to)||to<from){feedback('range-feedback','Choose an end day on or after the first day.');return;}
    saveState();draft.dateFrom=from;draft.dateTo=to;syncMemoryWords();fillDetails();changed();dialogClose('editor-dates-dialog');
  });

  $('editor-custom-layout').addEventListener('click',()=>{feedback('layout-message','');dialogOpen('layout-dialog');});
  document.querySelectorAll('[data-layout-preset]').forEach((node)=>node.addEventListener('click',()=>{$('layout-prompt').value=node.dataset.layoutPreset;feedback('layout-message','');}));
  $('layout-apply').addEventListener('click',()=>{
    const idea=$('layout-prompt').value.trim().toLocaleLowerCase();
    const style=/heart|dil|दिल|♡|❤️/u.test(idea)?'heart':/monument|arch|tower|taj|महल/u.test(idea)?'monument':/timeline|chronolog|time line|समय/u.test(idea)?'timeline':/grid|tidy|square|collage/u.test(idea)?'grid':null;
    if(!style){feedback('layout-message','Choose heart, monument, grid, or timeline. Other instructions need the AI designer, which isn’t connected yet.');return;}
    if(!draft.design.nodes.some((node)=>node.type==='image')){feedback('layout-message','Add photos or a template first.');return;}
    currentTemplate=style;arrangePhotos(style);dialogClose('layout-dialog');feedback('photo-upload-state',`${style[0].toUpperCase()+style.slice(1)} layout applied. You can move every photo.`);
  });

  let tripPhotos=[],tripMode='daily',tripSaving=false,tripFolderId=null,tripFolderName=null;
  const tripStories=new Map(),tripCreated=new Map(),tripCreationIds=new Map(),tripPendingPages=new Map();
  function tripGroups(){
    const grouped=new Map();tripPhotos.forEach((photo)=>{if(!validDate(photo.date))return;if(!grouped.has(photo.date))grouped.set(photo.date,[]);grouped.get(photo.date).push(photo);});
    return [...grouped.entries()].sort(([a],[b])=>a.localeCompare(b));
  }
  function renderTripDays(){
    const root=$('trip-days');root.replaceChildren();const groups=tripGroups();
    const missing=tripPhotos.filter((photo)=>!validDate(photo.date)).length;
    const title=$('trip-title').value.trim()||'Our trip';
    $('trip-folder-label').hidden=tripMode==='whole';
    document.querySelectorAll('[data-trip-mode]').forEach((node)=>node.setAttribute('aria-pressed',String(node.dataset.tripMode===tripMode)));
    $('trip-create').textContent=tripMode==='whole'?'Use as one trip page':tripCreated.size?'Finish remaining daily pages':'Create daily pages';
    $('trip-create').disabled=(tripMode==='daily'&&Boolean(missing))||tripSaving||!tripPhotos.length;$('trip-missing-tools').hidden=!missing||tripMode==='whole';
    feedback('trip-message',missing&&tripMode==='daily'?`Choose dates for ${missing} photo${missing===1?'':'s'} before creating pages.`:tripMode==='whole'?`${tripPhotos.length} photos on one editable page.`:`${groups.length} daily page${groups.length===1?'':'s'} from ${tripPhotos.length} photos. Nothing is saved until you choose Create daily pages.`);
    if(tripMode==='whole')return;
    for(const [date,photos] of groups){
      const card=el('details','trip-day');card.open=groups.length<=3;
      const summary=el('summary','',`${prettyDate(date,{weekday:'short'})} · ${photos.length} photo${photos.length===1?'':'s'}${tripCreated.has(date)?' · saved':''}`);card.append(summary);
      const values=tripStories.get(date)||{title:`${title} · ${prettyDate(date,{year:undefined})}`,story:''};tripStories.set(date,values);
      const heading=el('label','','Page heading'),input=el('input');input.maxLength=120;input.value=values.title;input.disabled=tripCreated.has(date);input.addEventListener('input',()=>values.title=input.value);heading.append(input);
      const label=el('label','','A little story'),story=el('textarea');story.rows=2;story.maxLength=3000;story.value=values.story;story.placeholder='Places, little moments, what made this day yours…';story.disabled=tripCreated.has(date);story.addEventListener('input',()=>values.story=story.value);label.append(story);
      card.append(heading,label);root.append(card);
    }
  }
  function openTrip(){
    if(uploading||saving||tripSaving)return;
    const seen=new Set();tripPhotos=draft.design.nodes.filter((node)=>node.type==='image'&&node.mediaId&&!seen.has(node.mediaId)&&seen.add(node.mediaId)).map((node)=>({nodeId:node.id,mediaId:node.mediaId,date:node.photoDate||''}));
    if(!tripPhotos.length){showPanel('photos');feedback('photo-upload-state','Choose your trip photos first, then make one trip page or daily pages.');return;}
    tripMode='daily';tripStories.clear();tripCreated.clear();tripCreationIds.clear();tripPendingPages.clear();tripFolderId=null;tripFolderName=null;
    $('trip-missing-date').value=draft.dateFrom;$('trip-title').value=draft.title;$('trip-folder').checked=true;$('trip-template').value=['postcards','editorial','film'].includes(currentTemplate)?currentTemplate:'postcards';
    const list=$('trip-photo-dates');list.replaceChildren();
    for(const photo of tripPhotos){
      const label=el('label','trip-photo-date'),image=el('img');image.src=media.get(photo.mediaId);image.alt='Photo date preview';image.loading='lazy';
      const input=el('input');input.type='date';input.value=photo.date;input.required=true;input.setAttribute('aria-label','Date for this trip photo');input.dataset.tripPhoto=photo.nodeId;
      const note=el('small','',photo.date?'Photo date · review if needed':'Date not found · choose a day');
      input.addEventListener('change',()=>{photo.date=input.value;note.textContent=photo.date?'Your chosen date':'Date needed';renderTripDays();});label.append(image,input,note);list.append(label);
    }
    renderTripDays();dialogOpen('trip-dialog');
  }
  $('trip-fill-missing').addEventListener('click',()=>{
    const date=$('trip-missing-date').value;if(!validDate(date)){feedback('trip-message','Choose a day for the undated photos.');return;}
    for(const photo of tripPhotos){if(validDate(photo.date))continue;photo.date=date;const input=$('trip-photo-dates').querySelector(`[data-trip-photo="${photo.nodeId}"]`);if(input){input.value=date;input.nextElementSibling.textContent='Your chosen date';}}
    renderTripDays();
  });
  $('editor-trip').addEventListener('click',openTrip);
  document.querySelectorAll('[data-trip-mode]').forEach((node)=>node.addEventListener('click',()=>{if(tripSaving||tripCreated.size)return;tripMode=node.dataset.tripMode;renderTripDays();}));
  $('trip-title').addEventListener('change',()=>{if(!tripCreated.size)renderTripDays();});
  function tripDesign(date,title,story,photos,style){
    const images=photos.map((photo)=>{const original=draft.design.nodes.find((node)=>node.id===photo.nodeId);return {...copy(original),id:crypto.randomUUID(),photoDate:date};});
    const positions=photoPositions(images.length,style);images.forEach((node,i)=>Object.assign(node,positions[i]));
    const nodes=[{...makeText(title,65,60,670,110,44,style==='film'?'mono':'serif'),role:'title'},{...makeText(prettyDate(date),70,175,650,40,17,'mono'),role:'date'},...images];
    if(story)nodes.push({...makeText(story,65,895,670,85,17),role:'story'});
    return{v:1,paper:style==='editorial'?'#eef0e5':'#fbf7ef',pattern:style==='postcards'?'dots':'plain',nodes};
  }
  $('trip-dialog').addEventListener('cancel',(event)=>{if(tripSaving)event.preventDefault();});
  $('trip-create').addEventListener('click',async()=>{
    if(tripSaving||!tripPhotos.length||(tripMode==='daily'&&tripPhotos.some((photo)=>!validDate(photo.date))))return;
    const groups=tripGroups(),title=$('trip-title').value.trim()||'Our trip';
    if(tripMode==='whole'){
      saveState();draft.title=title;if(dateMode!=='period'&&groups.length){draft.dateFrom=groups[0][0];draft.dateTo=groups.at(-1)[0];}
      for(const photo of tripPhotos){const node=draft.design.nodes.find((node)=>node.id===photo.nodeId);if(node)node.photoDate=photo.date||null;}
      dateMode=draft.dateFrom===draft.dateTo?'day':'period';syncMemoryWords();fillDetails();currentTemplate=$('trip-template').value;arrangePhotos(currentTemplate,false);dialogClose('trip-dialog');return;
    }
    let tripError='';tripSaving=true;$('trip-create').disabled=true;$('editor-save').disabled=true;
    // Prevent changed dates or stories during a save, and preserve completed days on retry.
    const inputs=[...$('trip-dialog').querySelectorAll('input,textarea,select,button')];const disabled=inputs.map((node)=>node.disabled);inputs.forEach((node)=>node.disabled=true);
    try{
      if($('trip-folder').checked&&!tripFolderId){
        const name=title.slice(0,60),existing=folders.find((folder)=>folder.name.toLocaleLowerCase()===name.toLocaleLowerCase());
        if(existing){tripFolderId=existing.id;tripFolderName=existing.name;}
        else{try{const result=await api('/api/journal/folders',json('POST',{scope,name}));tripFolderId=result.folder.id;tripFolderName=result.folder.name;folders.push(result.folder);}
        catch(error){const listing=await api(`/api/journal?scope=${scope}&view=pages`);const recovered=listing.folders.find((folder)=>folder.name.toLocaleLowerCase()===name.toLocaleLowerCase());if(!recovered)throw error;tripFolderId=recovered.id;tripFolderName=recovered.name;folders=listing.folders;}}
      }
      for(const [date,photos] of groups){
        if(tripCreated.has(date))continue;
        feedback('trip-message',`Saving day ${tripCreated.size+1} of ${groups.length}…`);
        const story=tripStories.get(date),pageTitle=story?.title.trim()||`${title} · ${prettyDate(date,{year:undefined})}`;
        if(!tripCreationIds.has(date))tripCreationIds.set(date,crypto.randomUUID());
        const value={...newDraft(),creationId:tripCreationIds.get(date),title:pageTitle.slice(0,120),description:story?.story||'',dateFrom:date,dateTo:date,folderId:tripFolderId||draft.folderId||null,design:tripDesign(date,pageTitle.slice(0,120),story?.story||'',photos,$('trip-template').value)};
        if(!tripPendingPages.has(date))tripPendingPages.set(date,value);
        const result=await persist(tripPendingPages.get(date));tripCreated.set(date,result.page.id);
        photos.forEach((photo)=>newUploads.delete(photo.mediaId));
      }
      const total=tripCreated.size;await refreshLibrary();dialogClose('trip-dialog');
      notify(`${total} daily page${total===1?'':'s'} saved${tripFolderName?' in '+tripFolderName:''}. Your original page stays open.`);
    }catch(error){tripError=`${tripCreated.size} day${tripCreated.size===1?'':'s'} saved. ${error.message} You can retry the remaining days.`;}
    finally{tripSaving=false;inputs.forEach((node,i)=>node.disabled=disabled[i]);$('editor-save').disabled=false;renderTripDays();if(tripError){feedback('trip-message',tripError);$('trip-dialog').querySelectorAll('input,textarea,select,button[data-trip-mode]').forEach((node)=>node.disabled=true);}}
  });

  $('editor-undo').addEventListener('click',()=>{if(uploading||saving||!history.length)return;redo.push(copy(draft));draft=history.pop();selectedId=null;dateMode=draft.dateFrom===draft.dateTo?'day':'period';fillDetails();changed();});$('editor-redo').addEventListener('click',()=>{if(uploading||saving||!redo.length)return;history.push(copy(draft));draft=redo.pop();selectedId=null;dateMode=draft.dateFrom===draft.dateTo?'day':'period';fillDetails();changed();});
  async function savePage(asCopy=false){if(saving||uploading||tripSaving)return;if(!draft.dateFrom||!draft.dateTo||draft.dateTo<draft.dateFrom){feedback('editor-message','Choose a start date and an end date on or after it.');showPanel('details');return;}saving=true;setEditorBusy(true);feedback('editor-save-state','Saving…');feedback('editor-message','');try{const response=await persist(draft,asCopy);draft={...draft,...response.page};dirty=false;const kept=new Set(draft.design.nodes.filter((node)=>node.type==='image'&&node.mediaId).map((node)=>node.mediaId));await cleanUploads(kept);feedback('editor-save-state','Saved');$('editor-save-copy').hidden=true;fillDetails();await refreshLibrary();}catch(error){feedback('editor-message',error.message);feedback('editor-save-state','Not saved');if(error.conflict)$('editor-save-copy').hidden=false;}finally{saving=false;setEditorBusy(false);}}
  $('editor-save').addEventListener('click',()=>savePage());$('editor-save-copy').addEventListener('click',()=>savePage(true));
  function leaveEditor(event){if(saving||uploading||tripSaving){event?.preventDefault();feedback('editor-message','Let the current save or upload finish first.');return;}if(dirty&&!window.confirm('Leave without saving your latest changes?')){event?.preventDefault();return;}dirty=false;draft=null;selectedId=null;cleanUploads();dialogClose('journal-editor');}
  $('editor-back').addEventListener('click',leaveEditor);$('journal-editor').addEventListener('cancel',(event)=>{event.preventDefault();leaveEditor(event);});window.addEventListener('beforeunload',(event)=>{if(dirty||uploading||saving||tripSaving){event.preventDefault();event.returnValue='';}});
  function updateAiAvailability(){['polish-date','polish-page'].forEach((id)=>$(id).disabled=!aiConfigured);const note=aiConfigured?'A preview appears before anything changes.':'AI writing isn’t connected yet. Your own words work beautifully, too.';feedback('date-ai-note',note);feedback('page-ai-note',note);$('editor-photos').disabled=!photosConfigured;}
  function openPolish(source){polishSource=source;suggestion=null;$('polish-result').hidden=true;feedback('polish-message','');dialogOpen('polish-dialog');}
  $('polish-date').addEventListener('click',()=>openPolish('date'));$('polish-page').addEventListener('click',()=>openPolish('page'));
  $('polish-generate').addEventListener('click',async()=>{$('polish-generate').disabled=true;feedback('polish-message','Finding a gentler shape for your words…');const node=selected();const title=polishSource==='date'?$('studio-date-title').value:draft.title;const description=polishSource==='date'?$('studio-date-description').value:node?.type==='text'?node.text:draft.description;try{const result=await api('/api/journal/polish',json('POST',{title,description,tone:$('polish-tone').value}));suggestion={...result.suggestion,nodeId:polishSource==='page'&&node?.type==='text'?node.id:null};feedback('polish-result-title',suggestion.title);feedback('polish-result-description',suggestion.description);$('polish-result').hidden=false;feedback('polish-message','Your original stays until you choose Use these words.');}catch(error){feedback('polish-message',error.message);}finally{$('polish-generate').disabled=false;}});
  $('polish-apply').addEventListener('click',()=>{if(!suggestion)return;if(polishSource==='date'){$('studio-date-title').value=suggestion.title;$('studio-date-description').value=suggestion.description;}else{saveState();if(suggestion.nodeId){const node=draft.design.nodes.find((node)=>node.id===suggestion.nodeId);if(node)node.text=suggestion.description;}else{draft.title=suggestion.title;draft.description=suggestion.description;}syncMemoryWords();fillDetails();changed();}dialogClose('polish-dialog');});
  async function mediaData(id){if(media.get(id)?.startsWith('data:'))return media.get(id);if(media.get(id)?.startsWith('blob:')){const blob=await (await fetch(media.get(id))).blob();return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});}const data=await api(`/api/journal/media/${id}`);media.set(id,data.dataUrl);return data.dataUrl;}
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
  document.querySelectorAll('[data-close-studio]').forEach((node)=>node.addEventListener('click',()=>{if(node.dataset.closeStudio==='trip-dialog'&&tripSaving)return;dialogClose(node.dataset.closeStudio);}));
  document.querySelectorAll('[data-studio-view]').forEach((node)=>node.addEventListener('click',()=>{if(busyLibrary)return;view=node.dataset.studioView;document.querySelectorAll('[data-studio-view]').forEach((item)=>{const active=item===node;item.classList.toggle('active',active);item.setAttribute('aria-pressed',String(active));});refreshLibrary();}));
  $('studio-search').addEventListener('input',renderLibrary);$('studio-load-more').addEventListener('click',()=>refreshLibrary(true));$('new-folder').addEventListener('click',()=>openFolder());$('new-page').addEventListener('click',()=>openEditor());$('new-date').addEventListener('click',()=>openDate());$('editor-zoom').addEventListener('change',resizeCanvas);new ResizeObserver(resizeCanvas).observe($('editor-page-scroll'));
  function init(context){ctx=context;if(ready)return;ready=true;if(scope==='shared'){document.title='Our Journal — Closr';feedback('studio-title','Our Journal ♡');feedback('studio-subtitle','A place for the days, trips and little things you keep together.');feedback('studio-privacy','Shared · both of you');$('studio-reflect').hidden=true;feedback('studio-eyebrow','LITTLE PIECES OF YOUR LIFE, TOGETHER');$('studio-shared-notes').hidden=!ctx.hasPartner;document.querySelector('[data-studio-view="pages"]').textContent='Our pages';}document.querySelectorAll('.studio-scope a').forEach((node)=>node.classList.toggle('active',node.getAttribute('href')===(scope==='private'?'memories.html':'our-journal.html')));const crumb=document.querySelector('.breadcrumb strong');if(crumb)crumb.textContent=scope==='private'?'My Journal':'Our Journal';refreshLibrary();}
  function momentOptions(){return {scope,folderId,canWrite,storageConfigured:photosConfigured,apiFetch:(...args)=>ctx.apiFetch(...args),onSaved:()=>refreshLibrary()};}
  function openRecordingEntry(id){window.ClosrMoments?.openEntry(id,momentOptions());}
  $('new-recording').addEventListener('click',()=>window.ClosrMoments?.open(momentOptions()));
  window.ClosrJournal={init};
  window.addEventListener('closr:ready',(event)=>init(event.detail));if(window.CLOSER_JOURNAL_CONTEXT)init(window.CLOSER_JOURNAL_CONTEXT);
})();

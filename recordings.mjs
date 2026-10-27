import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const MAX_BYTES = 24 * 1024 * 1024;
const uuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const text = (v, max) => typeof v === 'string' && v.length <= max && !/[\u0000\u202a-\u202e\u2066-\u2069]/u.test(v);
const validDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v+'T00:00:00Z')) && new Date(v+'T00:00:00Z').toISOString().slice(0,10) === v;
const formats = new Set(['audio/mp4','audio/webm','audio/ogg','audio/mpeg','audio/wav','audio/aac','video/mp4','video/webm','video/quicktime']);
function signature(bytes, type) {
  if (type.endsWith('/webm')) return bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]));
  if (['audio/mp4','video/mp4','video/quicktime'].includes(type)) return bytes.toString('ascii',4,8) === 'ftyp';
  if (type === 'audio/ogg') return bytes.toString('ascii',0,4) === 'OggS';
  if (type === 'audio/wav') return bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WAVE';
  if (type === 'audio/mpeg') return bytes.toString('ascii',0,3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  if (type === 'audio/aac') return bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0;
  return false;
}
function recordingLimiter(expected, type) {
  let count = 0, head = Buffer.alloc(0), checked = false;
  return new Transform({
    transform(chunk, encoding, done) {
      count += chunk.length;
      if (count > expected || count > MAX_BYTES) { done(new Error('The recording is larger than its upload limit.')); return; }
      if (!checked) {
        head = Buffer.concat([head, chunk.subarray(0, Math.max(0, 16-head.length))]);
        if (head.length >= 16) { checked = true; if (!signature(head,type)) { done(new Error('That file is not a supported recording.')); return; } }
      }
      done(null, chunk);
    },
    flush(done) { done(count !== expected || !signature(head,type) ? new Error('The recording upload was incomplete or unsupported.') : null); },
  });
}

export function createRecordingsApi({ database, send, readJson, signedInUser, coupleForUser, allowRequest, signedMediaUrl, mediaBucket }) {
  async function scopeFor(userId, scope) {
    if (scope === 'private') return { owner: userId, couple: null };
    if (scope !== 'shared') throw new Error('Choose My Journal or Our Journal.');
    const couple = await coupleForUser(userId);
    if (!couple?.has_partner) throw new Error('Connect your partner before saving in Our Journal. My Journal is ready to use.');
    return { owner: null, couple: couple.id };
  }
  async function cleanExpired(userId) {
    const rows = (await database.query(`UPDATE journal_recordings SET status='discarded' WHERE id IN
      (SELECT id FROM journal_recordings WHERE uploaded_by=$1 AND status IN ('pending','uploading') AND expires_at<now()
       AND (lease_until IS NULL OR lease_until<now()) ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED) RETURNING object_path`,[userId])).rows;
    for (const row of rows) if(row.object_path) await mediaBucket.file(row.object_path).delete({ignoreNotFound:true}).catch(()=>{});
  }
  async function prepare(request, response, user) {
    if (!mediaBucket) { send(response,503,{error:'Recording storage isn’t connected yet.'}); return; }
    if (!allowRequest(`recording-prepare:${user.id}`,12,60_000)) { send(response,429,{error:'Wait a moment before saving another recording.'}); return; }
    let body, scope;
    try {
      body=await readJson(request);
      if (!uuid(body.id) || !['audio','video'].includes(body.kind) || !formats.has(body.contentType) || !body.contentType.startsWith(body.kind+'/') ||
          !Number.isInteger(body.bytes) || body.bytes<16 || body.bytes>MAX_BYTES || !Number.isInteger(body.durationMs) || body.durationMs<1 || body.durationMs>(body.kind==='video'?180000:600000) ||
          !text(body.title,120) || !body.title.trim() || !text(body.note,3000) || !validDate(body.date) || (body.folderId !== null && !uuid(body.folderId))) throw new Error('Check the recording, title and date. Clips can be up to 24 MB: 10 minutes of audio or 3 minutes of video.');
      scope=await scopeFor(user.id,body.scope);
    } catch(error) {send(response,400,{error:error.message});return;}
    await cleanExpired(user.id);
    const client=await database.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`recording-budget:${user.id}`]);
      const previous=(await client.query('SELECT * FROM journal_recordings WHERE id=$1 FOR UPDATE',[body.id])).rows[0];
      if(previous){
        if(previous.uploaded_by!==user.id || previous.owner_user_id!==scope.owner || previous.couple_id!==scope.couple || previous.content_type!==body.contentType || previous.byte_size!==body.bytes || previous.kind!==body.kind || previous.duration_ms!==body.durationMs){await client.query('ROLLBACK');send(response,409,{error:'Start a new recording before saving this clip.'});return;}
        if(previous.status==='ready'){await client.query('ROLLBACK');send(response,200,{id:previous.id,pageId:previous.page_id,alreadySaved:true});return;}
        if(previous.status==='discarded'){await client.query('ROLLBACK');send(response,409,{error:'This unfinished upload expired. Your recording is still here; tap Save again to start a fresh upload.',newUpload:true});return;}
        if(previous.status==='uploading' && previous.lease_until>new Date()){await client.query('ROLLBACK');send(response,409,{error:'This recording is still uploading. Wait a moment, then retry.'});return;}
      }
      if(body.folderId){const folder=await client.query('SELECT id FROM journal_folders WHERE id=$1 AND owner_user_id IS NOT DISTINCT FROM $2 AND couple_id IS NOT DISTINCT FROM $3',[body.folderId,scope.owner,scope.couple]);if(!folder.rowCount)throw new Error('Choose a folder from this journal.');}
      if(!previous){
        const quota=(await client.query(`SELECT coalesce(sum(byte_size),0)::bigint AS bytes,count(*)::int AS clips,
          count(*) FILTER(WHERE status IN ('pending','uploading') AND expires_at>now())::int AS pending
          FROM journal_recordings WHERE uploaded_by=$1 AND created_at>now()-interval '24 hours'`,[user.id])).rows[0];
        if(Number(quota.bytes)+body.bytes>200*1024*1024 || quota.clips>=40){await client.query('ROLLBACK');send(response,429,{error:'Today’s recording limit is reached: 200 MB or 40 clips. Keep a copy on your device and try again tomorrow.'});return;}
        if(quota.pending>=3){await client.query('ROLLBACK');send(response,429,{error:'Three recordings are waiting to finish uploading. Finish or discard them before starting another upload.'});return;}
        await client.query(`INSERT INTO journal_recordings(id,owner_user_id,couple_id,uploaded_by,folder_id,kind,content_type,byte_size,duration_ms,title,entry_date,note)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[body.id,scope.owner,scope.couple,user.id,body.folderId,body.kind,body.contentType,body.bytes,body.durationMs,body.title.trim(),body.date,body.note]);
      }else await client.query(`UPDATE journal_recordings SET status='pending',folder_id=$2,title=$3,entry_date=$4,note=$5,expires_at=now()+interval '30 minutes' WHERE id=$1`,[body.id,body.folderId,body.title.trim(),body.date,body.note]);
      await client.query('COMMIT');send(response,200,{id:body.id,uploadPath:`/api/journal/recordings/${body.id}/content`});
    }catch(error){await client.query('ROLLBACK');if(error.code==='23505')send(response,409,{error:'Please retry saving this recording.'});else if(error.message.startsWith('Choose a folder'))send(response,400,{error:error.message});else throw error;}
    finally{client.release();}
  }
  async function upload(request,response,user,id){
    if(!mediaBucket){send(response,503,{error:'Recording storage isn’t connected.'});return;}
    if(!allowRequest(`recording-upload:${user.id}`,8,60_000)){send(response,429,{error:'Wait a moment before retrying the upload.'});return;}
    const row=(await database.query('SELECT * FROM journal_recordings WHERE id=$1 AND uploaded_by=$2',[id,user.id])).rows[0];
    if(!row){send(response,404,{error:'Recording upload not found.'});return;}
    if(row.status==='ready'){request.resume();send(response,200,{pageId:row.page_id});return;}
    const contentType=(request.headers['content-type']||'').split(';')[0].trim().toLowerCase(),length=Number(request.headers['content-length']);
    if(contentType!==row.content_type || (request.headers['content-encoding'] && request.headers['content-encoding']!=='identity') || (request.headers['content-length'] && length!==row.byte_size)){send(response,400,{error:'The recording changed. Select the clip again.'});return;}
    if(row.upload_attempts>=5){send(response,429,{error:'This clip has reached five upload attempts. Keep a copy and try again later.'});return;}
    const token=randomUUID(),objectPath=`recordings/${id}/${token}`;
    const claim=await database.query(`UPDATE journal_recordings SET status='uploading',upload_attempts=upload_attempts+1,upload_token=$3,object_path=$4,lease_until=now()+interval '4 minutes'
      WHERE id=$1 AND uploaded_by=$2 AND expires_at>now() AND upload_attempts<5 AND (status='pending' OR (status='uploading' AND lease_until<now())) RETURNING id`,[id,user.id,token,objectPath]);
    if(!claim.rowCount){send(response,409,{error:'This upload is busy or expired. Wait a moment, then retry.'});return;}
    const file=mediaBucket.file(objectPath);let committed=false;
    if(row.object_path&&row.object_path!==objectPath){
      try{await mediaBucket.file(row.object_path).delete({ignoreNotFound:true});}
      catch{await database.query(`UPDATE journal_recordings SET status='pending',object_path=$3,upload_token=NULL,lease_until=NULL WHERE id=$1 AND upload_token=$2`,[id,token,row.object_path]);send(response,503,{error:'The previous upload couldn’t be cleaned up yet. Your preview is safe; try Save again shortly.'});return;}
    }
    try{
      await pipeline(request,recordingLimiter(row.byte_size,row.content_type),file.createWriteStream({resumable:false,validation:'crc32c',preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:row.content_type,cacheControl:'private, max-age=0, no-transform'}}),{signal:AbortSignal.timeout(170000)});
      const scope=await scopeFor(user.id,row.owner_user_id?'private':'shared');
      const client=await database.connect();
      let pageId;
      try{
        await client.query('BEGIN');
        const current=(await client.query('SELECT * FROM journal_recordings WHERE id=$1 AND uploaded_by=$2 FOR UPDATE',[id,user.id])).rows[0];
        if(!current || current.upload_token!==token || current.status!=='uploading' || current.owner_user_id!==scope.owner || current.couple_id!==scope.couple)throw new Error('This journal changed during the upload.');
        // Recheck the folder at commit time; it must still belong to this same journal.
        if(current.folder_id && !(await client.query('SELECT id FROM journal_folders WHERE id=$1 AND owner_user_id IS NOT DISTINCT FROM $2 AND couple_id IS NOT DISTINCT FROM $3',[current.folder_id,scope.owner,scope.couple])).rowCount)throw new Error('The journal folder changed during upload.');
        pageId=randomUUID();
        await client.query(`INSERT INTO journal_pages(id,owner_user_id,couple_id,created_by,folder_id,kind,title,date_from,date_to,description,has_canvas)
          VALUES($1,$2,$3,$4,$5,'page',$6,$7,$7,$8,false)`,[pageId,scope.owner,scope.couple,user.id,current.folder_id,current.title,current.entry_date,current.note]);
        await client.query(`UPDATE journal_recordings SET status='ready',page_id=$2,lease_until=NULL WHERE id=$1`,[id,pageId]);
        await client.query('COMMIT');committed=true;
      }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
      send(response,201,{pageId});
    }catch{
      if(committed)return;
      await file.delete({ignoreNotFound:true}).catch(()=>{});
      await database.query(`UPDATE journal_recordings SET status='pending',upload_token=NULL,lease_until=NULL WHERE id=$1 AND upload_token=$2 AND status='uploading'`,[id,token]);
      if(!response.destroyed)send(response,502,{error:'The recording couldn’t finish uploading. Your preview is still here; try Save again.'});
    }
  }
  async function handleApi(request,response,pathname){
    if(pathname!=='/api/journal/recordings'&&!pathname.startsWith('/api/journal/recordings/'))return false;
    const user=await signedInUser(request,response);if(!user)return true;
    if(!allowRequest(`recordings:${user.id}`,80,60_000)){send(response,429,{error:'Wait a moment, then try again.'});return true;}
    if(pathname==='/api/journal/recordings'&&request.method==='POST'){await prepare(request,response,user);return true;}
    const page=pathname.match(/^\/api\/journal\/recordings\/page\/([0-9a-f-]+)$/i);
    if(page&&uuid(page[1])&&request.method==='GET'){
      const row=(await database.query(`SELECT r.* FROM journal_recordings r JOIN journal_pages p ON p.id=r.page_id WHERE r.page_id=$1 AND r.status='ready' AND p.deleted_at IS NULL
        AND r.owner_user_id IS NOT DISTINCT FROM p.owner_user_id AND r.couple_id IS NOT DISTINCT FROM p.couple_id
        AND (p.owner_user_id=$2 OR (p.owner_user_id IS NULL AND EXISTS(SELECT 1 FROM couple_members WHERE couple_id=p.couple_id AND user_id=$2)))`,[page[1],user.id])).rows[0];
      if(!row||!mediaBucket){send(response,404,{error:'This recording isn’t available in your journal.'});return true;}
      send(response,200,{recording:{id:row.id,kind:row.kind,durationMs:row.duration_ms,bytes:row.byte_size,contentType:row.content_type,url:await signedMediaUrl(row.object_path)}});return true;
    }
    const content=pathname.match(/^\/api\/journal\/recordings\/([0-9a-f-]+)\/content$/i);
    if(content&&uuid(content[1])&&request.method==='PUT'){await upload(request,response,user,content[1]);return true;}
    const discard=pathname.match(/^\/api\/journal\/recordings\/([0-9a-f-]+)$/i);
    if(discard&&uuid(discard[1])&&request.method==='DELETE'){
      const row=(await database.query(`UPDATE journal_recordings SET status='discarded' WHERE id=$1 AND uploaded_by=$2 AND page_id IS NULL AND (status IN ('pending','discarded') OR (status='uploading' AND lease_until<now())) RETURNING object_path`,[discard[1],user.id])).rows[0];
      if(!row){send(response,409,{error:'This recording is uploading or has already been saved.'});return true;}
      if(row.object_path&&mediaBucket)await mediaBucket.file(row.object_path).delete({ignoreNotFound:true});send(response,200,{ok:true});return true;
    }
    send(response,404,{error:'Recording route not found.'});return true;
  }
  return{handleApi};
}
